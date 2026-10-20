const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const createTestPageStore = require('./helpers/page-record-store');

const source = fs.readFileSync('index.html', 'utf8');
const prefix = 'cet6_dictionary_page_record_';

function loadHelpers(names, context) {
  const functions = names.map(name => {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(match, `${name} must exist`);
    return match[0];
  }).join('\n');
  return new Function(...Object.keys(context), `
    const PAGE_RECORD_PREFIX = '${prefix}';
    const VFAV_KEY = 'cet6_vocab_favorites';
    const KEY_STORAGE = 'cet6_api_key';
    let _pendingImport = null;
    let dataImportRunning = false;
    let _favoritesSearchCache = null;
    ${functions}
    return { ${names.join(', ')}, pendingImport: () => _pendingImport };
  `)(...Object.values(context));
}

function record(word, savedAt = 123) {
  return { savedAt, cards: [{ input: word, mode: 'original', result: {
    word, definitions: ['释义'], sentences: [{ en: 'An example.', cn: '例句。' }]
  } }] };
}

function harness(shared = new Map()) {
  let nextId = 0;
  const notices = [];
  const controls = { writes: 0, failWriteAt: 0, failWriteKey: '', discardWriteKey: '' };
  const context = {
    localStorage: {
      get length() { return shared.size; }, key: index => Array.from(shared.keys())[index] || null,
      getItem: key => shared.has(key) ? shared.get(key) : null,
      setItem: (key, value) => {
        if (++controls.writes === controls.failWriteAt || key === controls.failWriteKey) throw new Error('storage full');
        if (key === controls.discardWriteKey) return;
        shared.set(key, value);
      },
      removeItem: key => shared.delete(key)
    },
    crypto: { randomUUID: () => `imported-${++nextId}` },
    toast: message => notices.push(message)
  };
  const store = createTestPageStore(context.localStorage);
  context.getSavedPageStore = () => store;
  return { ...loadHelpers(['normalizeWordSearchCard', 'readPageRecord', 'getPageRecords', 'importPageRecords'], context),
    shared, notices, controls, context };
}

async function exportBackup(getPageRecords) {
  let blob;
  let downloads = 0;
  const notices = [];
  const { exportData } = loadHelpers(['exportData'], {
    getPageRecords, getVFavs: () => [{ word: 'favorite' }], getApiKey: () => 'test-key', fmtTime: () => 'time', Blob,
    URL: { createObjectURL: value => { blob = value; return 'blob:test'; }, revokeObjectURL: () => {} },
    document: {
      createElement: () => ({ click: () => { downloads++; } }),
      body: { appendChild: () => {}, removeChild: () => {} }
    },
    setTimeout: callback => callback(), toast: message => notices.push(message)
  });
  await exportData();
  return { data: blob && JSON.parse(await blob.text()), downloads, notices };
}

test('data export includes saved pages with complete results alongside favorites and the API key', async () => {
  const saved = { id: 'saved', ...record('aspire') };
  const output = await exportBackup(() => [saved]);
  assert.equal(output.downloads, 1);
  assert.deepEqual(output.data.pageRecords, [saved]);
  assert.equal(output.data.favorites[0].word, 'favorite');
  assert.equal(output.data.apiKey, 'test-key');
});

test('unreadable saved pages fail the backup instead of downloading a silently incomplete file', async () => {
  const output = await exportBackup(() => { throw new Error('storage disabled'); });
  assert.equal(output.downloads, 0);
  assert.match(output.notices.at(-1), /导出失败/);
});

test('malformed stored pages cannot be silently omitted from a successful backup', async () => {
  const h = harness(new Map([[prefix + 'damaged', '{bad']]));
  const output = await exportBackup(h.getPageRecords);
  assert.equal(output.downloads, 0);
  assert.match(output.notices.at(-1), /导出失败/);
  assert.equal(h.shared.get(prefix + 'damaged'), '{bad');
});

test('exported pages can be imported into a fresh browser and repeated imports do not duplicate them', async () => {
  const output = await exportBackup(() => [{ id: 'original', ...record('aspire') }]);
  const fresh = harness();
  assert.equal(await fresh.importPageRecords(output.data.pageRecords), true);
  const saved = (await fresh.getPageRecords());
  assert.equal(saved.length, 1);
  assert.equal(saved[0].cards[0].result.word, 'aspire');
  assert.deepEqual(saved[0].cards[0].result.sentences, [{ en: 'An example.', cn: '例句。' }]);
  assert.equal(await fresh.importPageRecords(output.data.pageRecords), true);
  assert.equal((await fresh.getPageRecords()).length, 1);
});

test('legacy backups without page records leave existing saved pages untouched', async () => {
  const h = harness(new Map([[prefix + 'existing', JSON.stringify({ version: 1, ...record('existing') })]]));
  const before = Array.from(h.shared);
  assert.equal(await h.importPageRecords(undefined), true);
  assert.deepEqual(Array.from(h.shared), before);
});

test('invalid backup pages are rejected before any saved records are changed', async () => {
  for (const invalid of [null, {}, [record('valid'), null], [record('valid'), { savedAt: 1, cards: [null] }],
    [{ savedAt: 1, cards: [] }], [{ savedAt: 'wrong', cards: record('bad').cards }]]) {
    const h = harness(new Map([[prefix + 'existing', JSON.stringify({ version: 1, ...record('existing') })]]));
    const before = Array.from(h.shared);
    assert.equal(await h.importPageRecords(invalid), false);
    assert.deepEqual(Array.from(h.shared), before);
    assert.match(h.notices.at(-1), /导入失败/);
  }
});

test('storage failure rolls back only new imported records and preserves existing browser data', async () => {
  const h = harness(new Map([[prefix + 'existing', JSON.stringify({ version: 1, ...record('existing') })],
    ['cet6_api_key', 'key'], ['cet6_vocab_favorites', 'favorites']]));
  const before = Array.from(h.shared);
  h.controls.failWriteAt = 2;
  assert.equal(await h.importPageRecords([record('first'), record('second')]), false);
  assert.deepEqual(Array.from(h.shared), before);
  assert.match(h.notices.at(-1), /导入失败/);
});

test('import preserves existing pages when incoming record IDs collide and strips non-card data', async () => {
  const h = harness(new Map([[prefix + 'same-id', JSON.stringify({ version: 1, ...record('existing') })]]));
  const incoming = { id: 'same-id', ...record('incoming'), apiKey: 'record-secret' };
  incoming.cards[0].apiKey = 'card-secret';
  incoming.cards[0].result.html = '<script>bad</script>';
  assert.equal(await h.importPageRecords([incoming]), true);
  assert.equal((await h.getPageRecords()).length, 2);
  assert.doesNotMatch(JSON.stringify(Array.from(h.shared)), /secret|<script>/);
});

test('merge and overwrite imports both keep existing page records and recover backup pages', async () => {
  for (const mode of ['merge', 'overwrite']) {
    const h = harness(new Map([[prefix + 'existing', JSON.stringify({ version: 1, ...record('existing') })]]));
    const { applyImport } = loadHelpers(['applyImport'], {
      ...h.context, importPageRecords: h.importPageRecords, confirm: () => true,
      getVFavs: () => [], setVFavs: () => {}, setApiKey: () => {}, mergeFavorites: (_, incoming) => incoming,
      closeModal: () => {}, renderVFavs: () => {}, updateAllVocabButtons: () => {}, initKey: () => {}
    });
    await applyImport(mode, { favorites: [], pageRecords: [record('imported')] });
    assert.equal((await h.getPageRecords()).length, 2, mode);
  }
});

test('a failed page import does not change favorites, the key or close the import dialog', async () => {
  const h = harness();
  h.controls.failWriteAt = 1;
  const { applyImport } = loadHelpers(['applyImport'], {
    ...h.context, importPageRecords: h.importPageRecords, confirm: () => true,
    setVFavs: () => assert.fail('favorites changed'), setApiKey: () => assert.fail('key changed'),
    getVFavs: () => [], mergeFavorites: (_, incoming) => incoming,
    closeModal: () => assert.fail('dialog closed'), renderVFavs: () => {}, updateAllVocabButtons: () => {}, initKey: () => {}
  });
  await applyImport('overwrite', { favorites: [], pageRecords: [record('saved')] });
  assert.equal((await h.getPageRecords()).length, 0);
});

test('canceling overwrite import does not write any saved pages', async () => {
  const h = harness();
  const { applyImport } = loadHelpers(['applyImport'], {
    ...h.context, importPageRecords: h.importPageRecords, confirm: () => false,
    setVFavs: () => assert.fail('favorites changed'), setApiKey: () => assert.fail('key changed'),
    closeModal: () => assert.fail('dialog closed'), renderVFavs: () => {}, updateAllVocabButtons: () => {}, initKey: () => {}
  });
  await applyImport('overwrite', { favorites: [], pageRecords: [record('saved')] });
  assert.equal(h.controls.writes, 0);
});

test('a favorites or key write failure rolls back the whole import without a success notice', async () => {
  for (const failure of ['favorites', 'key', 'silent favorites']) {
    const h = harness(new Map([
      ['cet6_vocab_favorites', JSON.stringify([{ word: 'existing' }])], ['cet6_api_key', 'old-key'],
      [prefix + 'existing', JSON.stringify({ version: 1, ...record('existing') })]
    ]));
    const before = Array.from(h.shared);
    if (failure === 'silent favorites') h.controls.discardWriteKey = 'cet6_vocab_favorites';
    else h.controls.failWriteKey = failure === 'key' ? 'cet6_api_key' : 'cet6_vocab_favorites';
    const { applyImport } = loadHelpers(['applyImport', 'getVFavs', 'setVFavs', 'getApiKey', 'setApiKey', 'mergeFavorites'], {
      ...h.context, importPageRecords: h.importPageRecords, confirm: () => true,
      closeModal: () => assert.fail('dialog closed after failed import'),
      renderVFavs: () => {}, updateAllVocabButtons: () => {}, initKey: () => {}
    });
    await applyImport('overwrite', { favorites: [{ word: 'incoming' }], apiKey: 'new-key', pageRecords: [record('saved')] });
    assert.deepEqual(Array.from(h.shared), before, failure);
    assert.match(h.notices.at(-1), /导入失败/, failure);
    assert.ok(h.notices.every(message => !/已覆盖导入|已合并导入/.test(message)));
  }
});

test('merge reads current favorites after waiting for durable page import', async () => {
  const h = harness(new Map([['cet6_vocab_favorites', JSON.stringify([{ word: 'original' }])]]));
  let started;
  let release;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { applyImport } = loadHelpers(['applyImport', 'mergeFavorites', 'getVFavs'], {
    ...h.context, importPageRecords: async () => { started(); await gate; return true; },
    closeModal: () => {}, renderVFavs: () => {}, updateAllVocabButtons: () => {}, initKey: () => {}
  });
  const pending = applyImport('merge', { favorites: [{ word: 'incoming' }] });
  await waiting;
  h.shared.set('cet6_vocab_favorites', JSON.stringify([{ word: 'original' }, { word: 'concurrent' }]));
  release();
  await pending;
  assert.deepEqual(JSON.parse(h.shared.get('cet6_vocab_favorites')).map(f => f.word), ['original', 'concurrent', 'incoming']);
});

test('a failed overwrite preserves favorites changed while page import was pending', async () => {
  const h = harness(new Map([['cet6_vocab_favorites', JSON.stringify([{ word: 'original' }])]]));
  let started;
  let release;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const write = h.context.localStorage.setItem;
  let failNextWrite = true;
  h.context.localStorage.setItem = (key, value) => {
    if (key === 'cet6_vocab_favorites' && failNextWrite) { failNextWrite = false; throw new Error('one-time write failure'); }
    write(key, value);
  };
  const { applyImport } = loadHelpers(['applyImport'], {
    ...h.context, importPageRecords: async () => { started(); await gate; return true; }, confirm: () => true,
    closeModal: () => assert.fail('failed import closed the dialog'),
    renderVFavs: () => {}, updateAllVocabButtons: () => {}, initKey: () => {}
  });
  const pending = applyImport('overwrite', { favorites: [{ word: 'incoming' }] });
  await waiting;
  const concurrent = JSON.stringify([{ word: 'original' }, { word: 'concurrent' }]);
  h.shared.set('cet6_vocab_favorites', concurrent);
  release();
  await pending;
  assert.equal(h.shared.get('cet6_vocab_favorites'), concurrent);
});

test('asynchronous page rollback cannot undo a concurrent favorites update', async () => {
  const h = harness(new Map([['cet6_vocab_favorites', JSON.stringify([{ word: 'original' }])], ['cet6_api_key', 'old-key']]));
  let started;
  let release;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  h.controls.failWriteKey = 'cet6_api_key';
  const store = h.context.getSavedPageStore();
  const { applyImport } = loadHelpers(['applyImport', 'mergeFavorites', 'getVFavs'], {
    ...h.context, importPageRecords: async (_, ids) => { ids.push('imported'); return true; },
    getSavedPageStore: () => ({ ...store, removeMany: async ids => { started(); await gate; await store.removeMany(ids); } }),
    closeModal: () => assert.fail('failed import closed the dialog'),
    renderVFavs: () => {}, updateAllVocabButtons: () => {}, initKey: () => {}
  });
  const pending = applyImport('merge', { favorites: [{ word: 'incoming' }], apiKey: 'new-key' });
  await waiting;
  const concurrent = JSON.stringify([{ word: 'original' }, { word: 'concurrent' }]);
  h.shared.set('cet6_vocab_favorites', concurrent);
  release();
  await pending;
  assert.equal(h.shared.get('cet6_vocab_favorites'), concurrent);
});

test('repeated import clicks cannot start overlapping page imports and the guard resets', async () => {
  const h = harness();
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { applyImport } = loadHelpers(['applyImport', 'mergeFavorites', 'getVFavs'], {
    ...h.context, importPageRecords: async () => { calls++; await gate; return true; },
    closeModal: () => {}, renderVFavs: () => {}, updateAllVocabButtons: () => {}, initKey: () => {}
  });
  const first = applyImport('merge', { favorites: [] });
  const second = applyImport('merge', { favorites: [] });
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  await applyImport('merge', { favorites: [] });
  assert.equal(calls, 2);
});

test('the import dialog lists the saved page count before importing a backup', async () => {
  const summary = { textContent: '' };
  const { importData, pendingImport } = loadHelpers(['importData'], {
    FileReader: class {
      readAsText(file) { this.result = JSON.stringify(file); this.onload(); }
    },
    toast: () => {}, openModal: () => {}, document: { getElementById: () => summary }
  });
  importData({ favorites: [], pageRecords: [record('saved')] });
  assert.match(summary.textContent, /1 条页面记录/);
  assert.equal(pendingImport().pageRecords.length, 1);
});
