const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');
const storageKey = 'cet6_dictionary_cards';

function loadHelpers(names, context = {}) {
  names = Array.from(new Set([
    ...names,
    ...(names.includes('clearPage') ? ['hasWordSearchContent'] : []),
    ...(names.includes('saveWordSearchSession') ? ['captureWordSearchCards'] : []),
    ...(names.includes('restoreWordSearchSession') ? ['applyWordSearchCards'] : [])
  ]));
  const functions = names.map(name => {
    const match = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(match, `${name} must exist`);
    return match[0];
  }).join('\n');
  return new Function(...Object.keys(context), `
    const WORD_SEARCH_SESSION_KEY = '${storageKey}';
    let restoringWordSearchSession = false;
    let wordSearchStorageFailed = false;
    ${functions}
    return { ${names.join(', ')} };
  `)(...Object.values(context));
}

test('normalizes card drafts and result data without storing keys or HTML', () => {
  const { normalizeWordSearchCard } = loadHelpers(['normalizeWordSearchCard']);
  const card = normalizeWordSearchCard({
    input: 'aspiring', mode: 'original', apiKey: 'secret', html: '<div>unsafe</div>',
    result: {
      word: 'aspire', sourceForm: 'aspiring', inflection: '现在分词',
      phonetic: '/əˈspaɪə/', pos: 'v.', definitions: ['渴望'],
      forms: { inflections: [{ type: '过去式', word: 'aspired' }], derivatives: [] },
      sentences: [{ en: 'We aspire to improve.', cn: '我们渴望进步。' }],
      apiKey: 'secret', html: '<script>unsafe</script>', fromCache: true, vfavId: 'fav1'
    }
  });
  assert.equal(card.input, 'aspiring');
  assert.equal(card.mode, 'original');
  assert.equal(card.result.sourceForm, 'aspiring');
  assert.deepEqual(card.result.definitions, ['渴望']);
  assert.deepEqual(card.result.sentences, [{ en: 'We aspire to improve.', cn: '我们渴望进步。' }]);
  assert.equal(card.result.vfavId, 'fav1');
  assert.doesNotMatch(JSON.stringify(card), /secret|unsafe|apiKey|html/);
});

test('normalizes legacy examples and discards malformed fields without breaking a draft', () => {
  const { normalizeWordSearchCard } = loadHelpers(['normalizeWordSearchCard']);
  assert.equal(normalizeWordSearchCard(null), null);
  assert.deepEqual(normalizeWordSearchCard({ input: 'draft', mode: 'invalid', result: {} }), {
    input: 'draft', mode: 'lemma', result: null
  });
  const card = normalizeWordSearchCard({ result: {
    word: 'legacy', pos: {}, definitions: [null, '释义', 3], forms: '复数 legacies',
    examples: ['An example.', null, { en: 'Another example.', cn: 3 }]
  } });
  assert.equal(card.result.pos, '');
  assert.deepEqual(card.result.definitions, ['释义']);
  assert.equal(card.result.forms, '复数 legacies');
  assert.deepEqual(card.result.sentences, ['An example.', { en: 'Another example.', cn: '' }]);
});

test('unavailable browser storage does not stop page initialization at the API key read', () => {
  const { getApiKey } = loadHelpers(['getApiKey'], {
    localStorage: { getItem: () => { throw new Error('disabled'); } },
    KEY_STORAGE: 'cet6_api_key'
  });
  assert.equal(getApiKey(), '');
});

function card(input, mode = 'lemma', result = null) {
  const resultEl = { innerHTML: '' };
  return {
    input: { value: input }, mode, _wordData: result,
    querySelector(selector) {
      if (selector === '.word-search-input') return this.input;
      if (selector === '.word-search-result') return resultEl;
      if (selector === '.ws-mode-toggle') return this;
      if (selector === '.btn-favorite') return { classList: { add: () => {} } };
    },
    querySelectorAll() {
      return ['lemma', 'original'].map(mode => ({
        dataset: { mode }, classList: { toggle: (_, active) => { if (active) this.mode = mode; } }
      }));
    }
  };
}

function sessionHarness(saved, throws = false, sharedStorage, tabStorage, navigationType = 'reload') {
  const modules = [];
  const notices = [];
  const metrics = { mounts: 0, favoriteReads: 0 };
  const storage = sharedStorage || new Map();
  const tab = tabStorage || new Map(saved === undefined ? [] : [[storageKey, saved]]);
  let helpers;
  const context = {
    performance: { getEntriesByType: () => [{ type: navigationType }] },
    $wsModules: {
      get childNodes() { return modules; },
      querySelectorAll: () => modules,
      appendChild: item => {
        metrics.mounts += 1;
        if (item.nodeType === 11) modules.push(...item.children);
        else modules.push(item);
      },
      replaceChildren: (...items) => {
        metrics.mounts += 1;
        const nodes = items.flatMap(item => item.nodeType === 11 ? item.children : [item]);
        modules.splice(0, modules.length, ...nodes);
      }
    },
    document: { createDocumentFragment: () => ({
      nodeType: 11, children: [], appendChild(item) { this.children.push(item); }
    }) },
    localStorage: {
      getItem: key => { if (throws) throw new Error('disabled'); return storage.get(key) || null; },
      setItem: (key, value) => { if (throws) throw new Error('full'); storage.set(key, value); }
    },
    sessionStorage: {
      getItem: key => { if (throws) throw new Error('disabled'); return tab.get(key) || null; },
      setItem: (key, value) => { if (throws) throw new Error('full'); tab.set(key, value); }
    },
    getSearchMode: item => item.mode,
    createWordSearchModule: () => card(''),
    syncSlider: () => {}, syncSliders: () => {}, updateMinusButtons: () => {},
    getVFavs: () => { metrics.favoriteReads += 1; return []; },
    toast: message => notices.push(message),
    renderWordResult: (item, _, input, result) => {
      item._wordData = result;
      helpers.saveWordSearchSession();
    }
  };
  helpers = loadHelpers(['normalizeWordSearchCard', 'saveWordSearchSession', 'restoreWordSearchSession'], context);
  return {
    ...helpers, modules, storage, tabStorage: tab, notices, context, metrics
  };
}

test('round-trips card order, blank drafts, query modes and complete results', () => {
  const first = sessionHarness();
  first.modules.push(card('aspiring', 'original', {
    word: 'aspire', definitions: ['渴望'], sourceForm: 'aspiring', inflection: '现在分词',
    sentences: [{ en: 'We aspire to improve.', cn: '我们渴望进步。' }]
  }), card('unfinished'), card(''));
  first.saveWordSearchSession();
  const saved = first.tabStorage.get(storageKey);
  const second = sessionHarness(saved);
  second.restoreWordSearchSession();
  assert.equal(second.tabStorage.get(storageKey), saved, 'rendering during restore must not overwrite the snapshot');
  assert.deepEqual(second.modules.map(item => item.input.value), ['aspiring', 'unfinished', '']);
  assert.deepEqual(second.modules.map(item => item.mode), ['original', 'lemma', 'lemma']);
  assert.equal(second.modules[0]._wordData.word, 'aspire');
  assert.equal(second.modules[0]._wordData.sourceForm, 'aspiring');
  assert.equal(second.modules[1]._wordData, null);
});

test('tabs sharing a browser keep their own cards when another tab saves and they reload', () => {
  const shared = new Map();
  const first = sessionHarness(undefined, false, shared);
  const second = sessionHarness(undefined, false, shared);
  first.modules.push(card('first', 'original', { word: 'first' }));
  second.modules.push(card('second', 'lemma', { word: 'second' }));
  first.saveWordSearchSession();
  second.saveWordSearchSession();
  const reloadFirst = sessionHarness(undefined, false, shared, first.tabStorage);
  const reloadSecond = sessionHarness(undefined, false, shared, second.tabStorage);
  reloadFirst.restoreWordSearchSession();
  reloadSecond.restoreWordSearchSession();
  assert.equal(reloadFirst.modules[0]._wordData.word, 'first');
  assert.equal(reloadFirst.modules[0].mode, 'original');
  assert.equal(reloadSecond.modules[0]._wordData.word, 'second');
  const newTab = sessionHarness(undefined, false, shared, undefined, 'navigate');
  newTab.restoreWordSearchSession();
  assert.equal(newTab.modules[0].input.value, '');
  assert.equal(newTab.modules[0]._wordData, null);
});

test('new pages start blank even with inherited tab data and stay blank after reload', () => {
  const original = sessionHarness();
  original.modules.push(card('existing', 'original', { word: 'existing' }));
  original.saveWordSearchSession();
  const inherited = new Map(original.tabStorage);
  const fresh = sessionHarness(undefined, false, original.storage, inherited, 'navigate');
  fresh.restoreWordSearchSession();
  assert.equal(fresh.modules.length, 1);
  assert.equal(fresh.modules[0].input.value, '');
  assert.equal(fresh.modules[0]._wordData, null);
  const reloaded = sessionHarness(undefined, false, original.storage, fresh.tabStorage);
  reloaded.restoreWordSearchSession();
  assert.equal(reloaded.modules[0].input.value, '');
  assert.equal(reloaded.modules[0]._wordData, null);
  const reloadOriginal = sessionHarness(undefined, false, original.storage, original.tabStorage);
  reloadOriginal.restoreWordSearchSession();
  assert.equal(reloadOriginal.modules[0]._wordData.word, 'existing');
});

test('legacy shared card snapshots never populate a new page or an empty tab reload', () => {
  const oldSnapshot = JSON.stringify({ version: 1, cards: [{
    input: 'old page', mode: 'lemma', result: { word: 'old page' }
  }] });
  const shared = new Map([[storageKey, oldSnapshot]]);
  for (const navigationType of ['navigate', 'reload']) {
    const fresh = sessionHarness(undefined, false, shared, undefined, navigationType);
    fresh.restoreWordSearchSession();
    assert.equal(fresh.modules[0].input.value, '');
    assert.equal(fresh.modules[0]._wordData, null);
  }
  assert.equal(shared.get(storageKey), oldSnapshot);
});

test('automatic card snapshots use only the current tab and do not change saved records or favorites', () => {
  const shared = new Map([
    ['cet6_dictionary_page_record_saved', 'saved record'],
    ['cet6_vocab_favorites', 'favorites'], ['cet6_api_key', 'key']
  ]);
  const before = Array.from(shared);
  const h = sessionHarness(undefined, false, shared);
  h.modules.push(card('current', 'lemma', { word: 'current' }));
  assert.equal(h.saveWordSearchSession(), true);
  assert.equal(JSON.parse(h.tabStorage.get(storageKey)).cards[0].result.word, 'current');
  assert.deepEqual(Array.from(shared), before);
});

test('failed card replacement keeps the existing page intact', () => {
  const h = sessionHarness();
  const original = card('current', 'original', { word: 'current' });
  h.modules.push(original);
  const { applyWordSearchCards } = loadHelpers(['applyWordSearchCards'], {
    ...h.context,
    renderWordResult: () => { throw new Error('bad rendering'); }
  });
  assert.throws(() => applyWordSearchCards([{ input: 'saved', mode: 'lemma', result: { word: 'saved' } }]), /bad rendering/);
  assert.equal(h.modules[0], original);
});

test('manual recovery uses the actual renderer, updates the tab snapshot and consumes the record', () => {
  const h = sessionHarness();
  const prefix = 'cet6_dictionary_page_record_';
  h.modules.push(card('current', 'lemma', { word: 'current' }));
  h.storage.set(prefix + 'saved', JSON.stringify({ version: 1, savedAt: 123, cards: [{
    input: 'aspiring', mode: 'original', result: { word: 'aspire', definitions: ['渴望'] }
  }] }));
  const { restorePageRecord } = loadHelpers([
    'normalizeWordSearchCard', 'captureWordSearchCards', 'saveWordSearchSession', 'applyWordSearchCards',
    'readPageRecord', 'hasWordSearchContent', 'restorePageRecord', 'renderWordResult', 'renderForms'
  ], {
    ...h.context,
    PAGE_RECORD_PREFIX: prefix,
    localStorage: { ...h.context.localStorage, removeItem: key => h.storage.delete(key) },
    confirm: () => true, esc: value => String(value),
    renderPageRecords: () => {}, closeModal: () => {}, schedulePageJumpUpdate: () => {},
    window: { scrollTo: () => {} }, matchMedia: () => ({ matches: true })
  });
  assert.equal(restorePageRecord('saved'), true);
  assert.equal(h.modules.length, 1);
  assert.equal(h.modules[0].mode, 'original');
  assert.match(h.modules[0].querySelector('.word-search-result').innerHTML, /渴望/);
  assert.equal(h.storage.has(storageKey), false);
  assert.equal(JSON.parse(h.tabStorage.get(storageKey)).cards[0].result.word, 'aspire');
  assert.equal(h.storage.has(prefix + 'saved'), false);
  const reloaded = sessionHarness(undefined, false, h.storage, h.tabStorage);
  reloaded.restoreWordSearchSession();
  assert.equal(reloaded.modules[0]._wordData.word, 'aspire');
  const newTab = sessionHarness(undefined, false, h.storage, undefined, 'navigate');
  newTab.restoreWordSearchSession();
  assert.equal(newTab.modules[0].input.value, '');
  assert.equal(newTab.modules[0]._wordData, null);
});

test('clearing an empty page shows the exact notice without confirmation or card changes', () => {
  const h = sessionHarness();
  const original = card('   ');
  h.modules.push(original);
  h.saveWordSearchSession();
  const snapshot = h.tabStorage.get(storageKey);
  let confirmations = 0;
  const { clearPage } = loadHelpers(['clearPage'], {
    ...h.context, ...h,
    confirm: () => { confirmations += 1; return false; }
  });
  assert.equal(clearPage(), false);
  assert.deepEqual(h.notices, ['当前页面已为空']);
  assert.equal(confirmations, 0);
  assert.equal(h.modules.length, 1);
  assert.equal(h.modules[0], original);
  assert.equal(h.tabStorage.get(storageKey), snapshot);
});

test('confirmed page clearing leaves one blank card and keeps it blank after reload', () => {
  const shared = new Map([
    ['cet6_dictionary_page_record_saved', 'saved record'],
    ['cet6_vocab_favorites', 'favorites'], ['cet6_api_key', 'key']
  ]);
  const before = Array.from(shared);
  const h = sessionHarness(undefined, false, shared);
  h.modules.push(card('word', 'original', { word: 'word' }), card('unfinished'), card(''));
  h.saveWordSearchSession();
  const other = sessionHarness(undefined, false, shared);
  other.modules.push(card('other', 'lemma', { word: 'other' }));
  other.saveWordSearchSession();
  let confirmations = 0;
  const { clearPage } = loadHelpers(['clearPage'], {
    ...h.context, ...h,
    confirm: () => { confirmations += 1; return true; },
    schedulePageJumpUpdate: () => {},
    window: { scrollTo: () => {} }, matchMedia: () => ({ matches: true })
  });
  let clickHandler;
  const binding = source.match(/document\.getElementById\('btnClearPage'\)\.addEventListener\('click', clearPage\);/);
  assert.ok(binding, 'clear button must invoke the page clearing action');
  new Function('document', 'clearPage', binding[0])({
    getElementById: () => ({ addEventListener: (_, callback) => { clickHandler = callback; } })
  }, clearPage);
  assert.equal(clickHandler(), true);
  assert.equal(confirmations, 1);
  assert.equal(h.modules.length, 1);
  assert.equal(h.modules[0].input.value, '');
  assert.equal(h.modules[0].mode, 'lemma');
  assert.equal(h.modules[0]._wordData, null);
  const reloaded = sessionHarness(undefined, false, shared, h.tabStorage);
  reloaded.restoreWordSearchSession();
  assert.equal(reloaded.modules.length, 1);
  assert.equal(reloaded.modules[0].input.value, '');
  assert.equal(reloaded.modules[0]._wordData, null);
  const reloadOther = sessionHarness(undefined, false, shared, other.tabStorage);
  reloadOther.restoreWordSearchSession();
  assert.equal(reloadOther.modules[0]._wordData.word, 'other');
  assert.deepEqual(Array.from(shared), before);
});

test('canceling page clearing preserves cards and the refresh snapshot', () => {
  const h = sessionHarness();
  const original = card('current', 'original', { word: 'current' });
  h.modules.push(original, card('unfinished'));
  h.saveWordSearchSession();
  const snapshot = h.tabStorage.get(storageKey);
  const { clearPage } = loadHelpers(['clearPage'], { ...h.context, ...h, confirm: () => false });
  assert.equal(clearPage(), false);
  assert.equal(h.modules.length, 2);
  assert.equal(h.modules[0], original);
  assert.equal(h.tabStorage.get(storageKey), snapshot);
});

test('failed snapshot saving cancels page clearing and preserves the existing cards', () => {
  const h = sessionHarness();
  const original = card('current', 'original', { word: 'current' });
  h.modules.push(original);
  h.saveWordSearchSession();
  const snapshot = h.tabStorage.get(storageKey);
  const { clearPage } = loadHelpers(['clearPage', 'saveWordSearchSession'], {
    ...h.context, ...h, confirm: () => true,
    sessionStorage: { setItem: () => { throw new Error('storage full'); } },
    schedulePageJumpUpdate: () => {}
  });
  assert.equal(clearPage(), false);
  assert.equal(h.modules[0], original);
  assert.equal(h.tabStorage.get(storageKey), snapshot);
});

test('restores many result cards with one DOM insertion and one favorites read', t => {
  const cards = Array.from({ length: 100 }, (_, index) => ({
    input: `word-${index}`, result: { word: `word-${index}`, definitions: ['释义'], sentences: [] }
  }));
  const harness = sessionHarness(JSON.stringify({ version: 1, cards }));
  const { restoreWordSearchSession } = loadHelpers([
    'normalizeWordSearchCard', 'saveWordSearchSession', 'restoreWordSearchSession', 'renderWordResult', 'renderForms'
  ], { ...harness.context, esc: value => String(value) });
  restoreWordSearchSession();
  t.diagnostic(JSON.stringify(harness.metrics));
  assert.equal(harness.modules.length, 100);
  assert.equal(harness.metrics.mounts, 1, 'mount restored cards as one batch');
  assert.equal(harness.metrics.favoriteReads, 1, 'read favorites once for the entire restore');
});

test('measures all mode sliders before writing styles to avoid repeated layout flushes', () => {
  const { syncSliders } = loadHelpers(['syncSliders']);
  const events = [];
  const toggles = [10, 50, 90].map(left => {
    const style = {};
    for (const property of ['left', 'width']) {
      Object.defineProperty(style, property, { set(value) { events.push(`write ${property} ${value}`); } });
    }
    const button = {
      get offsetLeft() { events.push('read left'); return left; },
      get offsetWidth() { events.push('read width'); return 40; }
    };
    return { querySelector: selector => selector === '.ws-mode-slider' ? { style } : button };
  });
  syncSliders(toggles);
  assert.ok(events.slice(0, 6).every(event => event.startsWith('read')));
  assert.ok(events.slice(6).every(event => event.startsWith('write')));
  assert.ok(events.includes('write left 90px'));
  assert.ok(events.includes('write width 40px'));
});

test('restored results render their meanings, inflections and examples through the actual renderer', () => {
  const harness = sessionHarness(JSON.stringify({ version: 1, cards: [{
    input: 'aspiring', mode: 'original', result: {
      word: 'aspire', sourceForm: 'aspiring', inflection: '现在分词', definitions: ['渴望 <progress>'],
      forms: { inflections: [{ type: '过去式', word: 'aspired' }], derivatives: [] },
      sentences: [{ en: 'We aspire to improve.', cn: '我们渴望进步。' }]
    }
  }] }));
  const { restoreWordSearchSession } = loadHelpers([
    'normalizeWordSearchCard', 'saveWordSearchSession', 'restoreWordSearchSession', 'renderWordResult', 'renderForms'
  ], {
    ...harness.context,
    getVFavs: () => [],
    esc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  });
  restoreWordSearchSession();
  const html = harness.modules[0].querySelector('.word-search-result').innerHTML;
  assert.match(html, /aspiring/);
  assert.match(html, /现在分词/);
  assert.match(html, /渴望 &lt;progress&gt;/);
  assert.match(html, /过去式 aspired/);
  assert.match(html, /We aspire to improve\./);
  assert.match(html, /我们渴望进步。/);
});

function captureHandler(pattern, context) {
  const match = source.match(pattern);
  assert.ok(match, 'event handler must exist');
  let handler;
  const refs = { ...context, $wsModules: {
    ...context.$wsModules, addEventListener: (_, callback) => { handler = callback; }
  } };
  new Function(...Object.keys(refs), match[0])(...Object.values(refs));
  return handler;
}

test('card add and remove events update the snapshot so deleted cards stay deleted after reload', async () => {
  const harness = sessionHarness();
  harness.restoreWordSearchSession();
  let counter = 0;
  const makeCard = () => {
    const item = card('');
    const id = counter++;
    item.id = `ws-module-${id}`;
    item.after = next => harness.modules.splice(harness.modules.indexOf(item) + 1, 0, next);
    item.remove = () => harness.modules.splice(harness.modules.indexOf(item), 1);
    item.scrollIntoView = () => {};
    return item;
  };
  harness.modules[0] = makeCard();
  const handler = captureHandler(/\$wsModules\.addEventListener\('click', async e => \{[\s\S]*?\n\}\);/, {
    ...harness.context,
    ...harness,
    document: {
      getElementById: id => harness.modules.find(item => item.id === id),
      querySelectorAll: () => harness.modules
    },
    createWordSearchModule: makeCard,
    schedulePageJumpUpdate: () => {}, setTimeout: () => {}
  });
  const clickAction = async (wsAct, wsId) => handler({ target: {
    closest: selector => selector === '[data-ws-act]' ? { dataset: { wsAct, wsId } } : null
  } });
  await clickAction('add', '0');
  assert.equal(JSON.parse(harness.tabStorage.get(storageKey)).cards.length, 2);
  await clickAction('remove', '1');
  const reloaded = sessionHarness(harness.tabStorage.get(storageKey));
  reloaded.restoreWordSearchSession();
  assert.equal(reloaded.modules.length, 1);
});

test('typing saves an unsubmitted draft that survives reload', () => {
  const harness = sessionHarness();
  harness.restoreWordSearchSession();
  const wrapper = harness.modules[0];
  wrapper.input.value = 'unfinished phrase';
  wrapper.input.closest = () => wrapper;
  const handler = captureHandler(/\$wsModules\.addEventListener\('input', e => \{[\s\S]*?\n\}\);/, {
    ...harness.context, ...harness,
    searchFavorites: () => [], renderWSSearchDropdown: () => {}
  });
  handler({ target: { closest: () => wrapper.input } });
  const reloaded = sessionHarness(harness.tabStorage.get(storageKey));
  reloaded.restoreWordSearchSession();
  assert.equal(reloaded.modules[0].input.value, 'unfinished phrase');
});

test('missing, corrupt, unsupported or empty storage restores one usable card', () => {
  for (const saved of [undefined, '{bad', 'null', '[]', '{"version":2,"cards":[{}]}',
    '{"version":1,"cards":[]}', '{"version":1,"cards":[null,5]}']) {
    const harness = sessionHarness(saved);
    assert.doesNotThrow(() => harness.restoreWordSearchSession());
    assert.equal(harness.modules.length, 1);
    assert.equal(harness.modules[0].input.value, '');
  }
});

test('blocked storage leaves cards usable and reports save failure only once', () => {
  const harness = sessionHarness(undefined, true);
  assert.doesNotThrow(() => harness.restoreWordSearchSession());
  assert.equal(harness.modules.length, 1);
  assert.doesNotThrow(() => harness.saveWordSearchSession());
  harness.saveWordSearchSession();
  assert.equal(harness.notices.length, 1);
});

test('opens a favorite from saved data and reuses its card while leaving the modal in place', () => {
  const modules = [];
  const positions = [];
  const favorite = { id: 'fav1', word: 'aspire', meaning: '渴望', examples: ['We aspire to improve.'] };
  const overlay = { style: { display: 'flex' } };
  const { openFavoriteInCard } = loadHelpers(['openFavoriteInCard'], {
    $wsModules: { querySelectorAll: () => modules, appendChild: item => modules.push(item) },
    $modalOverlay: overlay,
    getVFavs: () => [favorite],
    createWordSearchModule: () => ({ ...card(''), getBoundingClientRect: () => ({ top: 100 }) }),
    renderWordResult: (item, _, input, result) => { item._wordData = result; },
    updateMinusButtons: () => {}, syncSlider: () => {}, schedulePageJumpUpdate: () => {},
    requestAnimationFrame: callback => callback(),
    window: { scrollY: 200, scrollTo: options => positions.push(options) },
    toast: () => {}, saveWordSearchSession: () => {},
    matchMedia: () => ({ matches: true })
  });
  openFavoriteInCard('fav1');
  assert.equal(modules.length, 1);
  assert.equal(modules[0].input.value, 'aspire');
  assert.deepEqual(modules[0]._wordData.definitions, ['渴望']);
  assert.deepEqual(modules[0]._wordData.sentences, ['We aspire to improve.']);
  openFavoriteInCard('fav1');
  assert.equal(modules.length, 1);
  assert.equal(overlay.style.display, 'flex');
  assert.equal(positions.length, 2);
  assert.ok(positions.every(position => position.top > 0));
  assert.equal(openFavoriteInCard('missing'), undefined);
  assert.equal(modules.length, 1);
});
