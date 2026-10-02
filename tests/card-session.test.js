const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');
const storageKey = 'cet6_dictionary_cards';

function loadHelpers(names, context = {}) {
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

function sessionHarness(saved, throws = false) {
  const modules = [];
  const notices = [];
  const storage = new Map(saved === undefined ? [] : [[storageKey, saved]]);
  let helpers;
  const context = {
    $wsModules: { querySelectorAll: () => modules, appendChild: item => modules.push(item) },
    localStorage: {
      getItem: key => { if (throws) throw new Error('disabled'); return storage.get(key) || null; },
      setItem: (key, value) => { if (throws) throw new Error('full'); storage.set(key, value); }
    },
    getSearchMode: item => item.mode,
    createWordSearchModule: () => card(''),
    syncSlider: () => {}, updateMinusButtons: () => {},
    toast: message => notices.push(message),
    renderWordResult: (item, _, input, result) => {
      item._wordData = result;
      helpers.saveWordSearchSession();
    }
  };
  helpers = loadHelpers(['normalizeWordSearchCard', 'saveWordSearchSession', 'restoreWordSearchSession'], context);
  return {
    ...helpers, modules, storage, notices, context
  };
}

test('round-trips card order, blank drafts, query modes and complete results', () => {
  const first = sessionHarness();
  first.modules.push(card('aspiring', 'original', {
    word: 'aspire', definitions: ['渴望'], sourceForm: 'aspiring', inflection: '现在分词',
    sentences: [{ en: 'We aspire to improve.', cn: '我们渴望进步。' }]
  }), card('unfinished'), card(''));
  first.saveWordSearchSession();
  const saved = first.storage.get(storageKey);
  const second = sessionHarness(saved);
  second.restoreWordSearchSession();
  assert.equal(second.storage.get(storageKey), saved, 'rendering during restore must not overwrite the snapshot');
  assert.deepEqual(second.modules.map(item => item.input.value), ['aspiring', 'unfinished', '']);
  assert.deepEqual(second.modules.map(item => item.mode), ['original', 'lemma', 'lemma']);
  assert.equal(second.modules[0]._wordData.word, 'aspire');
  assert.equal(second.modules[0]._wordData.sourceForm, 'aspiring');
  assert.equal(second.modules[1]._wordData, null);
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
  assert.equal(JSON.parse(harness.storage.get(storageKey)).cards.length, 2);
  await clickAction('remove', '1');
  const reloaded = sessionHarness(harness.storage.get(storageKey));
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
  const reloaded = sessionHarness(harness.storage.get(storageKey));
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
