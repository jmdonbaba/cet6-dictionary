(function (root) {
  'use strict';

  function create({ indexedDB, legacyStorage, prefix, onChange = () => {} }) {
    let connection = null;
    let opening = null;
    const changed = () => { try { onChange(); } catch {} };

    function transaction(db, mode, work) {
      return new Promise((resolve, reject) => {
        let tx;
        let result;
        try {
          tx = mode === 'readwrite'
            ? db.transaction('records', mode, { durability: 'strict' })
            : db.transaction('records', mode);
          tx.oncomplete = () => resolve(result);
          tx.onabort = () => reject(tx.error || new Error('页面存储事务已中止'));
          tx.onerror = () => {}; // The abort event reports request errors without an early success.
          if (mode === 'readwrite' && tx.durability !== 'strict') {
            tx.abort();
            reject(new Error('浏览器不支持可靠的页面保存'));
            return;
          }
          work(tx.objectStore('records'), value => { result = value; });
        } catch (error) {
          if (tx) { try { tx.abort(); } catch {} }
          reject(error);
        }
      });
    }

    async function migrate(db) {
      const legacy = legacyStorage();
      const entries = [];
      for (let index = 0; index < legacy.length; index++) {
        const key = legacy.key(index);
        if (!key || !key.startsWith(prefix)) continue;
        const raw = legacy.getItem(key);
        if (raw !== null) entries.push({ id: key.slice(prefix.length), raw });
      }
      if (!entries.length) return;
      await transaction(db, 'readwrite', store => {
        for (const entry of entries) {
          const request = store.get(entry.id);
          request.onsuccess = () => {
            // Tombstones also count as existing: legacy keys must not resurrect deleted pages.
            if (request.result === undefined) store.add(entry);
          };
        }
      });
    }

    function open() {
      if (connection) return Promise.resolve(connection);
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        let settled = false;
        const fail = error => { if (!settled) { settled = true; reject(error); } };
        let request;
        try { request = indexedDB.open('cet6_dictionary_saved_pages', 1); }
        catch (error) { fail(error); return; }
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('records')) {
            request.result.createObjectStore('records', { keyPath: 'id' });
          }
        };
        request.onerror = () => fail(request.error || new Error('无法打开页面存储'));
        request.onblocked = () => fail(new Error('页面存储被其他标签页占用，请关闭旧页面后重试'));
        request.onsuccess = async () => {
          const db = request.result;
          if (settled) { db.close(); return; }
          try {
            await migrate(db);
            db.onversionchange = () => { db.close(); connection = null; opening = null; };
            connection = db;
            settled = true;
            resolve(db);
          } catch (error) { db.close(); fail(error); }
        };
      }).catch(error => { opening = null; throw error; });
      return opening;
    }

    async function getEntry(id) {
      return transaction(await open(), 'readonly', (store, result) => {
        const request = store.get(id);
        request.onsuccess = () => result(request.result);
      });
    }

    return {
      ready: async () => { await open(); },
      refreshLegacy: async () => { await migrate(await open()); },
      get: async id => {
        const entry = await getEntry(id);
        return entry && !entry.deleted ? entry.raw : null;
      },
      has: async id => (await getEntry(id)) !== undefined,
      entries: async () => {
        const db = await open();
        await migrate(db); // Old-version tabs may still create legacy records after this connection opened.
        const entries = await transaction(db, 'readonly', (store, result) => {
          const request = store.getAll();
          request.onsuccess = () => result(request.result);
        });
        return entries.filter(entry => !entry.deleted).map(entry => [entry.id, entry.raw]);
      },
      addMany: async entries => {
        await transaction(await open(), 'readwrite', store => {
          for (const entry of entries) store.add({ id: entry.id, raw: entry.raw });
        });
        changed();
      },
      removeMany: async ids => {
        await transaction(await open(), 'readwrite', store => {
          for (const id of ids) store.put({ id, deleted: true });
        });
        changed();
        // This is only legacy cleanup; the durable tombstones prevent resurrection after a crash.
        try {
          const legacy = legacyStorage();
          for (const id of ids) legacy.removeItem(prefix + id);
        } catch {}
      }
    };
  }

  const api = { create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SavedPageStore = api;
})(typeof globalThis === 'object' ? globalThis : this);
