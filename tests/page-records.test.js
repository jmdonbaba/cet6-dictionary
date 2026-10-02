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
  const controls = { answer: true, failRender: false, failSave: false, failWrite: false, failDelete: false };
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
        shared.set(key, value);
      },
      removeItem: key => {
        if (controls.failDelete) throw new Error('storage blocked');
        shared.delete(key);
      }
    },
    crypto: { randomUUID: () => `record-${++nextId}` },
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
    'readPageRecord', 'getPageRecords', 'savePageRecord', 'restorePageRecord'
  ], context);
  return { ...helpers, modules, shared, notices, confirmations, controls, context };
}

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

test('saved candidates survive closing every tab and reopening with fresh runtime state', () => {
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
  assert.equal(after.getPageRecords().length, 0);
  assert.deepEqual(after.confirmations, []);
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
  assert.equal(h.getPageRecords().length, 0);
});

test('restoring protects a typed draft and consumes only the selected record', () => {
  const h = harness();
  h.modules.push(makeCard('one'));
  h.savePageRecord();
  const firstId = h.getPageRecords()[0].id;
  h.modules[0].input.value = 'two';
  h.savePageRecord();
  h.modules[0].input.value = 'unfinished draft';
  assert.equal(h.restorePageRecord(firstId), true);
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.modules[0].input.value, 'one');
  assert.equal(h.getPageRecords().length, 1);
  assert.equal(h.getPageRecords()[0].cards[0].input, 'two');
});

test('failed rendering, persistence or record deletion preserves the record and current cards', () => {
  for (const failure of ['failRender', 'failSave', 'failDelete']) {
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

test('missing or malformed records cannot clear current cards or be silently consumed', () => {
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

test('a record consumed by another tab during confirmation cannot replace the current page', () => {
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
  assert.equal(h.getPageRecords()[0].cards[0].result.word, '<script>alert(1)</script>');
});
