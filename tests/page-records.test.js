const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');
const prefix = 'cet6_dictionary_page_record_';

function loadHelpers(names, context) {
  const functions = names.map(name => {
    const match = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(match, `${name} must exist`);
    return match[0];
  }).join('\n');
  return new Function(...Object.keys(context), `
    const PAGE_RECORD_PREFIX = '${prefix}';
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
  const helpers = loadHelpers([
    'normalizeWordSearchCard', 'captureWordSearchCards', 'hasWordSearchContent',
    'readPageRecord', 'getPageRecords', 'savePageRecord', 'restorePageRecord', 'deletePageRecord'
  ], context);
  return { ...helpers, modules, shared, notices, confirmations, controls, context, persistenceRequests };
}

test('saving while any lookup is pending reports that the page is incomplete', () => {
  const h = harness();
  h.modules.push(makeCard('complete', { word: 'complete' }), { ...makeCard('pending'), _searching: true });
  assert.equal(h.savePageRecord(), false);
  assert.equal(h.getPageRecords().length, 0);
  assert.match(h.notices.at(-1), /查询.*完成|查询.*保存/);
  assert.equal(h.persistenceRequests.length, 0);
  h.modules[1]._wordData = { word: 'pending', definitions: ['稍后返回的释义'] };
  h.modules[1]._searching = false;
  assert.equal(h.savePageRecord(), true);
  const reopened = harness(h.shared);
  assert.equal(reopened.getPageRecords()[0].cards[1].result.definitions[0], '稍后返回的释义');
});

test('a save is not reported as successful when the stored value is missing or corrupt', () => {
  for (const failure of ['discardWrite', 'corruptWrite']) {
    const h = harness();
    h.modules.push(makeCard('saved', { word: 'saved' }));
    h.controls[failure] = true;
    assert.equal(h.savePageRecord(), false, failure);
    assert.match(h.notices.at(-1), /保存失败/);
    assert.equal(h.persistenceRequests.length, 0);
  }
});

test('successful manual saving requests persistent browser storage', async () => {
  const h = harness();
  h.modules.push(makeCard('saved'));
  assert.equal(h.savePageRecord(), true);
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
    assert.equal(savePageRecord(), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.getPageRecords().length, 1);
  }
});

test('saving creates independent unnamed records with complete cards and no credentials', () => {
  const h = harness();
  h.modules.push(makeCard('aspiring', { word: 'aspire', definitions: ['渴望'],
    sourceForm: 'aspiring', inflection: '现在分词', sentences: ['We aspire to improve.'], apiKey: 'secret'
  }), makeCard('draft'), makeCard(''));
  h.savePageRecord();
  h.modules[0].input.value = 'changed';
  h.savePageRecord();
  const records = h.getPageRecords();
  assert.equal(records.length, 2);
  assert.ok(records.every(record => record.cards.length === 3));
  assert.ok(records.some(record => record.cards[0].input === 'aspiring'));
  assert.ok(records.some(record => record.cards[0].input === 'changed'));
  assert.ok(records.every(record => record.cards[0].mode === 'original'));
  assert.doesNotMatch(JSON.stringify(records), /secret|apiKey|"name"/);
  assert.ok(records.every(record => typeof record.savedAt === 'number'));
});

test('saved pages remain recoverable after restoring and closing every tab again', () => {
  const shared = new Map();
  const before = harness(shared);
  before.modules.push(makeCard('aspire', { word: 'aspire', definitions: ['渴望'] }));
  before.savePageRecord();
  const after = harness(shared);
  assert.equal(after.getPageRecords().length, 1);
  const record = after.getPageRecords()[0];
  after.modules.push(makeCard(''));
  assert.equal(after.restorePageRecord(record.id), true);
  assert.equal(after.modules[0]._wordData.word, 'aspire');
  assert.equal(after.getPageRecords().length, 1);
  assert.deepEqual(after.confirmations, []);
  const reopened = harness(shared);
  reopened.modules.push(makeCard(''));
  assert.equal(reopened.restorePageRecord(record.id), true);
  assert.equal(reopened.modules[0]._wordData.word, 'aspire');
  assert.equal(reopened.getPageRecords().length, 1);
  assert.equal(reopened.deletePageRecord(record.id), true);
  assert.equal(harness(shared).getPageRecords().length, 0);
});

test('manual deletion removes only the chosen record across tabs and keeps the current page', () => {
  const h = harness();
  h.modules.push(makeCard('one'));
  h.savePageRecord();
  const firstId = h.getPageRecords()[0].id;
  h.modules[0].input.value = 'two';
  h.savePageRecord();
  const current = makeCard('current', { word: 'current' });
  h.modules.splice(0, h.modules.length, current);
  h.shared.set('cet6_vocab_favorites', 'favorites');
  h.shared.set('cet6_api_key', 'key');
  assert.equal(h.deletePageRecord(firstId), true);
  const reopened = harness(h.shared);
  assert.equal(reopened.getPageRecords().length, 1);
  assert.equal(reopened.getPageRecords()[0].cards[0].input, 'two');
  assert.equal(h.modules[0], current);
  assert.equal(h.shared.get('cet6_vocab_favorites'), 'favorites');
  assert.equal(h.shared.get('cet6_api_key'), 'key');
  assert.deepEqual(h.confirmations, []);
});

test('failed manual deletion retains the record and current cards', () => {
  const h = harness();
  const current = makeCard('saved', { word: 'saved' });
  h.modules.push(current);
  h.savePageRecord();
  const id = h.getPageRecords()[0].id;
  h.controls.failDelete = true;
  assert.equal(h.deletePageRecord(id), false);
  assert.equal(h.getPageRecords().length, 1);
  assert.equal(h.modules[0], current);
  assert.match(h.notices.at(-1), /删除失败/);
});

test('clicking a delete cross never restores a page and keeps keyboard focus in the dialog', () => {
  const binding = source.match(/\$pageRecordList\.addEventListener\('click', e => \{[\s\S]*?\n\}\);/);
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
    handler({ target: { closest: selector => selector === '[data-page-record-delete]' ? target : null } });
    assert.equal(deleted, 'selected');
    assert.equal(focused, lastRecord ? 'close' : 'next');
  }
});

test('restoring over a word card asks the exact confirmation and cancellation preserves both', () => {
  const h = harness();
  h.modules.push(makeCard('saved', { word: 'saved' }));
  h.savePageRecord();
  const id = h.getPageRecords()[0].id;
  const existing = makeCard('current', { word: 'current' });
  h.modules.splice(0, h.modules.length, existing);
  h.controls.answer = false;
  assert.equal(h.restorePageRecord(id), false);
  assert.deepEqual(h.confirmations, ['恢复此记录将覆盖当前页面，是否继续？']);
  assert.equal(h.modules[0], existing);
  assert.equal(h.getPageRecords().length, 1);
  h.controls.answer = true;
  assert.equal(h.restorePageRecord(id), true);
  assert.equal(h.modules.length, 1);
  assert.equal(h.modules[0]._wordData.word, 'saved');
  assert.equal(h.getPageRecords().length, 1);
});

test('restoring protects a typed draft and preserves every saved record unchanged', () => {
  const h = harness();
  h.modules.push(makeCard('one'));
  h.savePageRecord();
  const firstId = h.getPageRecords()[0].id;
  h.modules[0].input.value = 'two';
  h.savePageRecord();
  const saved = Array.from(h.shared);
  h.modules[0].input.value = 'unfinished draft';
  assert.equal(h.restorePageRecord(firstId), true);
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.modules[0].input.value, 'one');
  assert.equal(h.getPageRecords().length, 2);
  assert.deepEqual(Array.from(h.shared), saved);
});

test('failed rendering or session persistence preserves the record and current cards', () => {
  for (const failure of ['failRender', 'failSave']) {
    const h = harness();
    h.modules.push(makeCard('saved'));
    h.savePageRecord();
    const id = h.getPageRecords()[0].id;
    const previous = makeCard('current', { word: 'current' });
    h.modules.splice(0, h.modules.length, previous);
    h.controls[failure] = true;
    assert.equal(h.restorePageRecord(id), false, failure);
    assert.equal(h.modules[0], previous, failure);
    assert.equal(h.getPageRecords().length, 1, failure);
  }
});

test('restoring a saved page does not require changing long-term storage', () => {
  const h = harness();
  h.modules.push(makeCard('saved', { word: 'saved' }));
  h.savePageRecord();
  const id = h.getPageRecords()[0].id;
  h.modules.splice(0, h.modules.length, makeCard(''));
  h.controls.failWrite = true;
  h.controls.failDelete = true;
  assert.equal(h.restorePageRecord(id), true);
  assert.equal(h.modules[0]._wordData.word, 'saved');
  assert.equal(h.getPageRecords().length, 1);
});

test('missing or malformed records cannot clear current cards or be silently deleted', () => {
  const h = harness();
  const previous = makeCard('current', { word: 'current' });
  h.modules.push(previous);
  h.shared.set(prefix + 'bad', '{bad');
  h.shared.set(prefix + 'empty', JSON.stringify({ version: 1, savedAt: 1, cards: [] }));
  h.shared.set(prefix + 'invalid', JSON.stringify({ version: 1, savedAt: 1, cards: [null] }));
  assert.equal(h.restorePageRecord('missing'), false);
  assert.equal(h.restorePageRecord('bad'), false);
  assert.equal(h.restorePageRecord('empty'), false);
  assert.equal(h.restorePageRecord('invalid'), false);
  assert.equal(h.modules[0], previous);
  assert.equal(h.shared.size, 3);
  assert.equal(h.getPageRecords().length, 0);
});

test('empty pages and write failures do not create misleading recovery records', () => {
  const h = harness();
  h.modules.push(makeCard(''));
  assert.equal(h.savePageRecord(), false);
  assert.equal(h.getPageRecords().length, 0);
  h.modules[0].input.value = 'draft';
  h.controls.failWrite = true;
  assert.equal(h.savePageRecord(), false);
  assert.equal(h.getPageRecords().length, 0);
});

test('a record deleted by another tab during confirmation cannot replace the current page', () => {
  const h = harness();
  h.modules.push(makeCard('saved'));
  h.savePageRecord();
  const id = h.getPageRecords()[0].id;
  const previous = makeCard('current', { word: 'current' });
  h.modules.splice(0, h.modules.length, previous);
  const { restorePageRecord } = loadHelpers(['restorePageRecord'], {
    ...h.context, readPageRecord: h.readPageRecord, hasWordSearchContent: h.hasWordSearchContent,
    confirm: () => { h.shared.delete(prefix + id); return true; }
  });
  assert.equal(restorePageRecord(id), false);
  assert.equal(h.modules[0], previous);
});

test('restoring in another tab during confirmation leaves the saved page available', () => {
  const shared = new Map();
  const first = harness(shared);
  first.modules.push(makeCard('saved', { word: 'saved' }));
  first.savePageRecord();
  const id = first.getPageRecords()[0].id;
  const second = harness(shared);
  second.modules.push(makeCard(''));
  const { restorePageRecord } = loadHelpers(['restorePageRecord'], {
    ...first.context, readPageRecord: first.readPageRecord, hasWordSearchContent: first.hasWordSearchContent,
    confirm: () => { assert.equal(second.restorePageRecord(id), true); return true; }
  });
  assert.equal(restorePageRecord(id), true);
  assert.equal(first.modules[0]._wordData.word, 'saved');
  assert.equal(second.modules[0]._wordData.word, 'saved');
  assert.equal(first.getPageRecords().length, 1);
});

test('the recovery dialog explains that records stay saved after recovery', () => {
  const hint = source.match(/<p class="page-record-hint">([^<]*)<\/p>/);
  assert.ok(hint);
  assert.match(hint[1], /恢复后.*保留/);
  assert.equal(hint[1], '选择一条记录恢复。恢复后记录仍会保留。');
});

test('candidate previews are escaped and retain the original word data', () => {
  const h = harness();
  h.modules.push(makeCard('<script>alert(1)</script>', { word: '<script>alert(1)</script>' }));
  h.savePageRecord();
  const list = { innerHTML: '' };
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const { renderPageRecords } = loadHelpers(['renderPageRecords'], {
    getPageRecords: h.getPageRecords, $pageRecordList: list, esc: escape, escAttr: escape,
    fmtTime: time => new Date(time).toISOString()
  });
  renderPageRecords();
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
  assert.equal(h.getPageRecords()[0].cards[0].result.word, '<script>alert(1)</script>');
});

test('deleting the final candidate updates the list to the empty state', () => {
  const h = harness();
  h.modules.push(makeCard('saved'));
  h.savePageRecord();
  const id = h.getPageRecords()[0].id;
  const list = { innerHTML: '' };
  const { renderPageRecords, deletePageRecord } = loadHelpers(['renderPageRecords', 'deletePageRecord'], {
    ...h.context, getPageRecords: h.getPageRecords, $pageRecordList: list,
    esc: value => String(value), escAttr: value => String(value), fmtTime: () => 'time'
  });
  renderPageRecords();
  assert.match(list.innerHTML, /data-page-record-id/);
  assert.equal(deletePageRecord(id), true);
  assert.match(list.innerHTML, /还没有保存的页面/);
  assert.doesNotMatch(list.innerHTML, /data-page-record-id/);
});

test('unreadable records remain visible as a read error instead of a misleading empty history', () => {
  const h = harness(new Map([[prefix + 'damaged', '{bad']]));
  const list = { innerHTML: '' };
  const { renderPageRecords } = loadHelpers(['renderPageRecords'], {
    getPageRecords: h.getPageRecords, $pageRecordList: list,
    esc: value => String(value), escAttr: value => String(value), fmtTime: () => 'time'
  });
  renderPageRecords();
  assert.match(list.innerHTML, /1 条.*读取失败/);
  assert.doesNotMatch(list.innerHTML, /还没有保存的页面/);
  assert.equal(h.shared.get(prefix + 'damaged'), '{bad');
  h.modules.push(makeCard('valid'));
  h.savePageRecord();
  renderPageRecords();
  assert.match(list.innerHTML, /data-page-record-id/);
  assert.match(list.innerHTML, /1 条.*读取失败/);
});
