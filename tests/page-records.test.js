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
    let pageRecordRenderVersion = 0;
    ${functions}
    return { ${names.join(', ')} };
  `)(...Object.values(context));
}

function makeCard(input, result = null) {
  return { _wordData: result, input: { value: input },
    querySelector(selector) { if (selector === '.word-search-input') return this.input; }
  };
}

function harness(shared = new Map()) {
  let nextId = 0;
  const modules = [];
  const notices = [];
  const confirmations = [];
  const controls = { answer: true, failRender: false, failSave: false, failWrite: false, failDelete: false,
    discardWrite: false, corruptWrite: false };
  const persistenceRequests = [];
  const context = {
    $wsModules: {
      get childNodes() { return modules; },
      querySelectorAll: () => modules,
      replaceChildren: (...items) => modules.splice(0, modules.length, ...items)
    },
    localStorage: {
      get length() { return shared.size; }, key: index => Array.from(shared.keys())[index] || null,
      getItem: key => shared.get(key) || null,
      setItem: (key, value) => {
        if (controls.failWrite) throw new Error('storage full');
        if (!controls.discardWrite) shared.set(key, controls.corruptWrite ? '{bad' : value);
      },
      removeItem: key => {
        if (controls.failDelete) throw new Error('storage blocked');
        shared.delete(key);
      }
    },
    crypto: { randomUUID: () => `record-${++nextId}` },
    navigator: { storage: { persist: () => { persistenceRequests.push(true); return Promise.resolve(true); } } },
    getSearchMode: () => 'original',
    applyWordSearchCards: cards => {
      if (controls.failRender) throw new Error('render failed');
      modules.splice(0, modules.length, ...cards.map(card => makeCard(card.input, card.result)));
    },
    saveWordSearchSession: () => !controls.failSave,
    confirm: message => { confirmations.push(message); return controls.answer; },
    toast: message => notices.push(message),
    renderPageRecords: () => {}, closeModal: () => {}, updateMinusButtons: () => {},
    schedulePageJumpUpdate: () => {},
    window: { scrollTo: () => {} },
    matchMedia: () => ({ matches: true }),
    $modalRestorePage: { classList: { contains: () => false } }
  };
  const store = createTestPageStore(context.localStorage);
  context.getSavedPageStore = () => store;
  const helpers = loadHelpers([
    'normalizeWordSearchCard', 'captureWordSearchCards', 'hasWordSearchContent',
    'readPageRecord', 'getPageRecords', 'savePageRecord', 'restorePageRecord', 'deletePageRecord'
  ], context);
  return { ...helpers, modules, shared, notices, confirmations, controls, context, persistenceRequests };
}

test('saving while any lookup is pending reports that the page is incomplete', async () => {
  const h = harness();
  h.modules.push(makeCard('complete', { word: 'complete' }), { ...makeCard('pending'), _searching: true });
  assert.equal(await h.savePageRecord(), false);
  assert.equal((await h.getPageRecords()).length, 0);
  assert.match(h.notices.at(-1), /查询.*完成|查询.*保存/);
  assert.equal(h.persistenceRequests.length, 0);
  h.modules[1]._wordData = { word: 'pending', definitions: ['稍后返回的释义'] };
  h.modules[1]._searching = false;
  assert.equal(await h.savePageRecord(), true);
  const reopened = harness(h.shared);
  assert.equal((await reopened.getPageRecords())[0].cards[1].result.definitions[0], '稍后返回的释义');
});

test('a save is not reported as successful when the stored value is missing or corrupt', async () => {
  for (const failure of ['discardWrite', 'corruptWrite']) {
    const h = harness();
    h.modules.push(makeCard('saved', { word: 'saved' }));
    h.controls[failure] = true;
    assert.equal(await h.savePageRecord(), false, failure);
    assert.match(h.notices.at(-1), /保存失败/);
    assert.equal(h.persistenceRequests.length, 0);
  }
});

test('save success waits for the durable transaction rather than just a readable value', async () => {
  const h = harness();
  h.modules.push(makeCard('saved'));
  const store = h.context.getSavedPageStore();
  let finish;
  const committed = new Promise(resolve => { finish = resolve; });
  const { savePageRecord } = loadHelpers(['savePageRecord'], {
    ...h.context, captureWordSearchCards: h.captureWordSearchCards, hasWordSearchContent: h.hasWordSearchContent,
    getSavedPageStore: () => ({ ...store, addMany: async entries => { await committed; await store.addMany(entries); } })
  });
  const pending = savePageRecord();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.notices, []);
  assert.equal(h.persistenceRequests.length, 0);
  finish();
  assert.equal(await pending, true);
  assert.match(h.notices.at(-1), /页面已保存/);
});

test('successful manual saving requests persistent browser storage', async () => {
  const h = harness();
  h.modules.push(makeCard('saved'));
  assert.equal(await h.savePageRecord(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.persistenceRequests.length, 1);
});

test('unsupported, denied or failing persistence protection does not lose a verified save', async () => {
  for (const navigator of [{}, { storage: { persist: () => Promise.resolve(false) } },
    { storage: { persist: () => Promise.reject(new Error('denied')) } },
    { storage: { persist: () => { throw new Error('unsupported'); } } }]) {
    const h = harness();
    h.modules.push(makeCard('saved'));
    const { savePageRecord } = loadHelpers(['savePageRecord'], {
      ...h.context, hasWordSearchContent: h.hasWordSearchContent, captureWordSearchCards: h.captureWordSearchCards,
      navigator
    });
    assert.equal(await savePageRecord(), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await h.getPageRecords()).length, 1);
  }
});

test('saving creates independent unnamed records with complete cards and no credentials', async () => {
  const h = harness();
  h.modules.push(makeCard('aspiring', { word: 'aspire', definitions: ['渴望'],
    sourceForm: 'aspiring', inflection: '现在分词', sentences: ['We aspire to improve.'], apiKey: 'secret'
  }), makeCard('draft'), makeCard(''));
  await h.savePageRecord();
  h.modules[0].input.value = 'changed';
  await h.savePageRecord();
  const records = (await h.getPageRecords());
  assert.equal(records.length, 2);
  assert.ok(records.every(record => record.cards.length === 3));
  assert.ok(records.some(record => record.cards[0].input === 'aspiring'));
  assert.ok(records.some(record => record.cards[0].input === 'changed'));
  assert.ok(records.every(record => record.cards[0].mode === 'original'));
  assert.doesNotMatch(JSON.stringify(records), /secret|apiKey|"name"/);
  assert.ok(records.every(record => typeof record.savedAt === 'number'));
});

test('saved pages remain recoverable after restoring and closing every tab again', async () => {
  const shared = new Map();
  const before = harness(shared);
  before.modules.push(makeCard('aspire', { word: 'aspire', definitions: ['渴望'] }));
  await before.savePageRecord();
  const after = harness(shared);
  assert.equal((await after.getPageRecords()).length, 1);
  const record = (await after.getPageRecords())[0];
  after.modules.push(makeCard(''));
  assert.equal(await after.restorePageRecord(record.id), true);
  assert.equal(after.modules[0]._wordData.word, 'aspire');
  assert.equal((await after.getPageRecords()).length, 1);
  assert.deepEqual(after.confirmations, []);
  const reopened = harness(shared);
  reopened.modules.push(makeCard(''));
  assert.equal(await reopened.restorePageRecord(record.id), true);
  assert.equal(reopened.modules[0]._wordData.word, 'aspire');
  assert.equal((await reopened.getPageRecords()).length, 1);
  assert.equal(await reopened.deletePageRecord(record.id), true);
  assert.equal((await harness(shared).getPageRecords()).length, 0);
});

test('manual deletion removes only the chosen record across tabs and keeps the current page', async () => {
  const h = harness();
  h.modules.push(makeCard('one'));
  await h.savePageRecord();
  const firstId = (await h.getPageRecords())[0].id;
  h.modules[0].input.value = 'two';
  await h.savePageRecord();
  const current = makeCard('current', { word: 'current' });
  h.modules.splice(0, h.modules.length, current);
  h.shared.set('cet6_vocab_favorites', 'favorites');
  h.shared.set('cet6_api_key', 'key');
  assert.equal(await h.deletePageRecord(firstId), true);
  const reopened = harness(h.shared);
  assert.equal((await reopened.getPageRecords()).length, 1);
  assert.equal((await reopened.getPageRecords())[0].cards[0].input, 'two');
  assert.equal(h.modules[0], current);
  assert.equal(h.shared.get('cet6_vocab_favorites'), 'favorites');
  assert.equal(h.shared.get('cet6_api_key'), 'key');
  assert.deepEqual(h.confirmations, []);
});

test('failed manual deletion retains the record and current cards', async () => {
  const h = harness();
  const current = makeCard('saved', { word: 'saved' });
  h.modules.push(current);
  await h.savePageRecord();
  const id = (await h.getPageRecords())[0].id;
  h.controls.failDelete = true;
  assert.equal(await h.deletePageRecord(id), false);
  assert.equal((await h.getPageRecords()).length, 1);
  assert.equal(h.modules[0], current);
  assert.match(h.notices.at(-1), /删除失败/);
});

test('clicking a delete cross never restores a page and keeps keyboard focus in the dialog', async () => {
  const binding = source.match(/\$pageRecordList\.addEventListener\('click', async e => \{[\s\S]*?\n\}\);/);
  assert.ok(binding);
  for (const lastRecord of [false, true]) {
    let handler;
    let deleted;
    let focused;
    const target = { dataset: { pageRecordDelete: 'selected' } };
    const next = { focus: () => { focused = 'next'; } };
    const list = {
      addEventListener: (_, callback) => { handler = callback; },
      querySelectorAll: () => deleted ? (lastRecord ? [] : [next]) : [target, next]
    };
    const modal = { querySelector: () => ({ focus: () => { focused = 'close'; } }) };
    new Function('$pageRecordList', '$modalRestorePage', 'deletePageRecord', 'restorePageRecord', binding[0])(
      list, modal, id => { deleted = id; return true; },
      () => assert.fail('deleting must not restore the page')
    );
    await handler({ target: { closest: selector => selector === '[data-page-record-delete]' ? target : null } });
    assert.equal(deleted, 'selected');
    assert.equal(focused, lastRecord ? 'close' : 'next');
  }
});

test('restoring over a word card asks the exact confirmation and cancellation preserves both', async () => {
  const h = harness();
  h.modules.push(makeCard('saved', { word: 'saved' }));
  await h.savePageRecord();
  const id = (await h.getPageRecords())[0].id;
  const existing = makeCard('current', { word: 'current' });
  h.modules.splice(0, h.modules.length, existing);
  h.controls.answer = false;
  assert.equal(await h.restorePageRecord(id), false);
  assert.deepEqual(h.confirmations, ['恢复此记录将覆盖当前页面，是否继续？']);
  assert.equal(h.modules[0], existing);
  assert.equal((await h.getPageRecords()).length, 1);
  h.controls.answer = true;
  assert.equal(await h.restorePageRecord(id), true);
  assert.equal(h.modules.length, 1);
  assert.equal(h.modules[0]._wordData.word, 'saved');
  assert.equal((await h.getPageRecords()).length, 1);
});

test('restoring protects a typed draft and preserves every saved record unchanged', async () => {
  const h = harness();
  h.modules.push(makeCard('one'));
  await h.savePageRecord();
  const firstId = (await h.getPageRecords())[0].id;
  h.modules[0].input.value = 'two';
  await h.savePageRecord();
  const saved = Array.from(h.shared);
  h.modules[0].input.value = 'unfinished draft';
  assert.equal(await h.restorePageRecord(firstId), true);
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.modules[0].input.value, 'one');
  assert.equal((await h.getPageRecords()).length, 2);
  assert.deepEqual(Array.from(h.shared), saved);
});

test('failed rendering or session persistence preserves the record and current cards', async () => {
  for (const failure of ['failRender', 'failSave']) {
    const h = harness();
    h.modules.push(makeCard('saved'));
    await h.savePageRecord();
    const id = (await h.getPageRecords())[0].id;
    const previous = makeCard('current', { word: 'current' });
    h.modules.splice(0, h.modules.length, previous);
    h.controls[failure] = true;
    assert.equal(await h.restorePageRecord(id), false, failure);
    assert.equal(h.modules[0], previous, failure);
    assert.equal((await h.getPageRecords()).length, 1, failure);
  }
});

test('restoring a saved page does not require changing long-term storage', async () => {
  const h = harness();
  h.modules.push(makeCard('saved', { word: 'saved' }));
  await h.savePageRecord();
  const id = (await h.getPageRecords())[0].id;
  h.modules.splice(0, h.modules.length, makeCard(''));
  h.controls.failWrite = true;
  h.controls.failDelete = true;
  assert.equal(await h.restorePageRecord(id), true);
  assert.equal(h.modules[0]._wordData.word, 'saved');
  assert.equal((await h.getPageRecords()).length, 1);
});

test('missing or malformed records cannot clear current cards or be silently deleted', async () => {
  const h = harness();
  const previous = makeCard('current', { word: 'current' });
  h.modules.push(previous);
  h.shared.set(prefix + 'bad', '{bad');
  h.shared.set(prefix + 'empty', JSON.stringify({ version: 1, savedAt: 1, cards: [] }));
  h.shared.set(prefix + 'invalid', JSON.stringify({ version: 1, savedAt: 1, cards: [null] }));
  assert.equal(await h.restorePageRecord('missing'), false);
  assert.equal(await h.restorePageRecord('bad'), false);
  assert.equal(await h.restorePageRecord('empty'), false);
  assert.equal(await h.restorePageRecord('invalid'), false);
  assert.equal(h.modules[0], previous);
  assert.equal(h.shared.size, 3);
  assert.equal((await h.getPageRecords()).length, 0);
});

test('empty pages and write failures do not create misleading recovery records', async () => {
  const h = harness();
  h.modules.push(makeCard(''));
  assert.equal(await h.savePageRecord(), false);
  assert.equal((await h.getPageRecords()).length, 0);
  h.modules[0].input.value = 'draft';
  h.controls.failWrite = true;
  assert.equal(await h.savePageRecord(), false);
  assert.equal((await h.getPageRecords()).length, 0);
});

test('a record deleted by another tab during confirmation cannot replace the current page', async () => {
  const h = harness();
  h.modules.push(makeCard('saved'));
  await h.savePageRecord();
  const id = (await h.getPageRecords())[0].id;
  const previous = makeCard('current', { word: 'current' });
  h.modules.splice(0, h.modules.length, previous);
  const { restorePageRecord } = loadHelpers(['restorePageRecord'], {
    ...h.context, readPageRecord: h.readPageRecord, hasWordSearchContent: h.hasWordSearchContent, captureWordSearchCards: h.captureWordSearchCards,
    confirm: () => { h.shared.delete(prefix + id); return true; }
  });
  assert.equal(await restorePageRecord(id), false);
  assert.equal(h.modules[0], previous);
});

test('restoring in another tab during confirmation leaves the saved page available', async () => {
  const shared = new Map();
  const first = harness(shared);
  first.modules.push(makeCard('saved', { word: 'saved' }));
  await first.savePageRecord();
  const id = (await first.getPageRecords())[0].id;
  const second = harness(shared);
  second.modules.push(makeCard(''));
  let secondRecovery;
  const { restorePageRecord } = loadHelpers(['restorePageRecord'], {
    ...first.context, readPageRecord: first.readPageRecord, hasWordSearchContent: first.hasWordSearchContent, captureWordSearchCards: first.captureWordSearchCards,
    confirm: () => { secondRecovery = second.restorePageRecord(id); return true; }
  });
  assert.equal(await restorePageRecord(id), true);
  assert.equal(await secondRecovery, true);
  assert.equal(first.modules[0]._wordData.word, 'saved');
  assert.equal(second.modules[0]._wordData.word, 'saved');
  assert.equal((await first.getPageRecords()).length, 1);
});

test('text entered while a recovery read is pending is protected by confirmation', async () => {
  const h = harness();
  h.modules.push(makeCard('saved'));
  await h.savePageRecord();
  const id = (await h.getPageRecords())[0].id;
  h.modules.splice(0, h.modules.length, makeCard(''));
  let release;
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let reads = 0;
  const { restorePageRecord } = loadHelpers(['restorePageRecord'], {
    ...h.context, captureWordSearchCards: h.captureWordSearchCards, hasWordSearchContent: h.hasWordSearchContent,
    readPageRecord: async id => { if (++reads === 2) { started(); await gate; } return h.readPageRecord(id); }
  });
  const pending = restorePageRecord(id);
  await waiting;
  h.modules[0].input.value = 'new draft';
  h.controls.answer = false;
  release();
  assert.equal(await pending, false);
  assert.equal(h.modules[0].input.value, 'new draft');
  assert.deepEqual(h.confirmations, ['恢复此记录将覆盖当前页面，是否继续？']);
  assert.equal((await h.getPageRecords()).length, 1);
});

test('the recovery dialog explains that records stay saved after recovery', async () => {
  const hint = source.match(/<p class="page-record-hint">([^<]*)<\/p>/);
  assert.ok(hint);
  assert.match(hint[1], /恢复后.*保留/);
  assert.equal(hint[1], '选择一条记录恢复。恢复后记录仍会保留。');
});

test('candidate previews are escaped and retain the original word data', async () => {
  const h = harness();
  h.modules.push(makeCard('<script>alert(1)</script>', { word: '<script>alert(1)</script>' }));
  await h.savePageRecord();
  const list = { innerHTML: '' };
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const { renderPageRecords } = loadHelpers(['renderPageRecords'], {
    getPageRecords: h.getPageRecords, $pageRecordList: list, esc: escape, escAttr: escape,
    fmtTime: time => new Date(time).toISOString()
  });
  await renderPageRecords();
  assert.doesNotMatch(list.innerHTML, /<script>/);
  assert.match(list.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(list.innerHTML, /1 张卡片/);
  assert.match(list.innerHTML, /<button[^>]*data-page-record-delete="record-1"[^>]*aria-label="删除此记录"/);
  let depth = 0;
  for (const button of list.innerHTML.matchAll(/<\/?button\b[^>]*>/g)) {
    depth += button[0].startsWith('</') ? -1 : 1;
    assert.ok(depth >= 0 && depth <= 1, 'restore and delete buttons must be siblings');
  }
  assert.equal(depth, 0);
  assert.equal((await h.getPageRecords())[0].cards[0].result.word, '<script>alert(1)</script>');
});

test('deleting the final candidate updates the list to the empty state', async () => {
  const h = harness();
  h.modules.push(makeCard('saved'));
  await h.savePageRecord();
  const id = (await h.getPageRecords())[0].id;
  const list = { innerHTML: '' };
  const { renderPageRecords, deletePageRecord } = loadHelpers(['renderPageRecords', 'deletePageRecord'], {
    ...h.context, getPageRecords: h.getPageRecords, $pageRecordList: list,
    esc: value => String(value), escAttr: value => String(value), fmtTime: () => 'time'
  });
  await renderPageRecords();
  assert.match(list.innerHTML, /data-page-record-id/);
  assert.equal(await deletePageRecord(id), true);
  assert.match(list.innerHTML, /还没有保存的页面/);
  assert.doesNotMatch(list.innerHTML, /data-page-record-id/);
});

test('unreadable records remain visible as a read error instead of a misleading empty history', async () => {
  const h = harness(new Map([[prefix + 'damaged', '{bad']]));
  const list = { innerHTML: '' };
  const { renderPageRecords } = loadHelpers(['renderPageRecords'], {
    getPageRecords: h.getPageRecords, $pageRecordList: list,
    esc: value => String(value), escAttr: value => String(value), fmtTime: () => 'time'
  });
  await renderPageRecords();
  assert.match(list.innerHTML, /1 条.*读取失败/);
  assert.doesNotMatch(list.innerHTML, /还没有保存的页面/);
  assert.equal(h.shared.get(prefix + 'damaged'), '{bad');
  h.modules.push(makeCard('valid'));
  await h.savePageRecord();
  await renderPageRecords();
  assert.match(list.innerHTML, /data-page-record-id/);
  assert.match(list.innerHTML, /1 条.*读取失败/);
});

test('an older asynchronous list read cannot overwrite a newer list render', async () => {
  const pending = [];
  const list = { innerHTML: '' };
  const { renderPageRecords } = loadHelpers(['renderPageRecords'], {
    getPageRecords: () => new Promise(resolve => pending.push(resolve)), $pageRecordList: list,
    esc: String, escAttr: String, fmtTime: () => 'time'
  });
  const oldRender = renderPageRecords();
  const newRender = renderPageRecords();
  pending[1]([]);
  await newRender;
  const current = list.innerHTML;
  pending[0]([{ id: 'old', savedAt: 1, cards: [{ input: 'deleted', result: null }] }]);
  await oldRender;
  assert.equal(list.innerHTML, current);
  assert.doesNotMatch(list.innerHTML, /data-page-record-id/);
});
