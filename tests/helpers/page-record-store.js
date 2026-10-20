// Fast adapter for UI tests. Browser tests exercise the real IndexedDB store and crash recovery.
module.exports = function createTestPageStore(storage) {
  const prefix = 'cet6_dictionary_page_record_';
  return {
    ready: async () => {},
    get: async id => storage.getItem(prefix + id),
    has: async id => storage.getItem(prefix + id) !== null,
    entries: async () => {
      const entries = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith(prefix)) entries.push([key.slice(prefix.length), storage.getItem(key)]);
      }
      return entries;
    },
    addMany: async entries => {
      if (entries.some(entry => storage.getItem(prefix + entry.id) !== null)) throw new Error('duplicate ID');
      const added = [];
      try {
        for (const { id, raw } of entries) {
          added.push(id);
          storage.setItem(prefix + id, raw);
        }
      } catch (error) {
        for (const id of added) storage.removeItem(prefix + id);
        throw error;
      }
    },
    removeMany: async ids => { for (const id of ids) storage.removeItem(prefix + id); }
  };
};
