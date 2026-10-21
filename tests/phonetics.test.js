const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const StudyExport = require('../study-export.js');

const source = fs.readFileSync('index.html', 'utf8');
const dual = '英 /ˈkɒmbæt/　美 /ˈkɑːmbæt/';

function loadHelpers(names, context) {
  if (source.includes('function hasDualPhonetic(')) names = [...names, 'hasDualPhonetic'];
  const functions = [...new Set(names)].map(name => {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?(?=\\n(?:async )?function |\\n// ====================)`));
    assert.ok(match, `${name} must exist`);
    return match[0];
  }).join('\n');
  return new Function(...Object.keys(context), `${functions}\nreturn { ${names.join(', ')} };`)(...Object.values(context));
}

function harness(favorites = [], phonetic = dual) {
  const requests = [];
  const favoriteWrites = [];
  const controls = { fail: false, invalidJSON: false, beforeResponse() {} };
  const resultEl = { innerHTML: '' };
  const wrapper = { _wordData: null, querySelector: selector =>
    selector === '.word-search-result' ? resultEl : { classList: { add() {} } } };
  const helpers = loadHelpers([
    'searchWord', 'renderWordResult', 'extractJSON', 'renderForms',
    'addVFav', 'normalizeWordSearchCard'
  ], {
    DEEPSEEK_URL: 'https://example.test/chat', getApiKey: () => 'test-key', esc: StudyExport.escapeHtml,
    getVFavs: () => favorites,
    setVFavs: next => { favorites = next; favoriteWrites.push(structuredClone(next)); },
    renderVFavs() {}, updateAllVocabButtons() {}, toast() {}, saveWordSearchSession() {},
    fmtTime: () => 'test-time',
    fetch: async (_, request) => {
      requests.push(JSON.parse(request.body));
      controls.beforeResponse();
      if (controls.fail) throw new Error('network unavailable');
      return { ok: true, json: async () => ({ choices: [{ message: { content: controls.invalidJSON ? 'invalid' : JSON.stringify({
        word: 'combat', phonetic, pos: 'n.', definitions: ['战斗'], forms: '', sentences: []
      }) } }] }) };
    }
  });
  return { ...helpers, wrapper, resultEl, requests, favoriteWrites, controls,
    favorites: () => favorites, replaceFavorites: next => { favorites = next; } };
}

for (const mode of ['lemma', 'original']) {
  test(`${mode} requests labeled British and American IPA for the result word`, async () => {
    const h = harness();
    await h.searchWord(mode === 'lemma' ? 'combats' : 'combat', h.wrapper, mode);
    const prompt = h.requests[0].messages[1].content;
    assert.match(prompt, /"phonetic": "英 \/[^\n]+美 \/[^\n]+"/);
    assert.match(prompt, /英式.*美式/);
    assert.match(prompt, /相同.*分别/);
    assert.match(prompt, /phonetic.*word/);
    assert.ok(h.resultEl.innerHTML.includes(dual));
  });
}

test('querying a legacy favorite fetches both pronunciations and updates only its phonetic', async () => {
  const favorite = { id: 'old', word: 'combat', phonetic: '/ˈkɒmbæt/', meaning: '旧释义',
    pinned: true, createdAt: 'old-time', examples: ['Old example.'] };
  const h = harness([structuredClone(favorite)]);
  await h.searchWord('combat', h.wrapper, 'original');
  assert.equal(h.requests.length, 1);
  assert.equal(h.wrapper._wordData.phonetic, dual);
  assert.deepEqual(h.favorites(), [{ ...favorite, phonetic: dual }]);
  assert.equal(h.favoriteWrites.length, 1);
});

test('a favorite with both pronunciations is served without a new request', async () => {
  const h = harness([{ id: 'dual', word: 'combat', phonetic: dual }]);
  await h.searchWord('COMBAT', h.wrapper, 'original');
  assert.equal(h.requests.length, 0);
  assert.equal(h.wrapper._wordData.phonetic, dual);
  assert.ok(h.resultEl.innerHTML.includes(dual));
});

test('an incomplete pronunciation response does not overwrite a legacy favorite', async () => {
  const favorite = { id: 'old', word: 'combat', phonetic: '/ˈkɒmbæt/' };
  const h = harness([structuredClone(favorite)], '');
  await h.searchWord('combat', h.wrapper, 'original');
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.favorites(), [favorite]);
  assert.equal(h.favoriteWrites.length, 0);
});

for (const failure of ['fail', 'invalidJSON']) {
  test(`${failure}: pronunciation upgrades fall back to the saved favorite`, async () => {
    const favorite = { id: 'old', word: 'combat', phonetic: '/ˈkɒmbæt/', definitions: ['旧释义'] };
    const h = harness([structuredClone(favorite)]);
    h.controls[failure] = true;
    await h.searchWord('combat', h.wrapper, 'original');
    assert.equal(h.requests.length, 1);
    assert.ok(h.wrapper._wordData, 'the saved result remains available when upgrading fails');
    assert.equal(h.wrapper._wordData.phonetic, favorite.phonetic);
    assert.ok(h.resultEl.innerHTML.includes('旧释义'));
    assert.deepEqual(h.favorites(), [favorite]);
    assert.equal(h.favoriteWrites.length, 0);
  });
}

test('pronunciation upgrades preserve edits and other favorites saved during the request', async () => {
  const h = harness([{ id: 'old', word: 'combat', phonetic: '/old/' }]);
  const edited = { id: 'old', word: 'combat', phonetic: '/old/', meaning: '新释义', pinned: true };
  const other = { id: 'other', word: 'another', phonetic: '/another/' };
  h.controls.beforeResponse = () => h.replaceFavorites([edited, other]);
  await h.searchWord('combat', h.wrapper, 'original');
  assert.deepEqual(h.favorites(), [{ ...edited, phonetic: dual }, other]);
});

test('deleting a favorite during the request does not recreate it on completion', async () => {
  const h = harness([{ id: 'old', word: 'combat', phonetic: '/old/' }]);
  h.controls.beforeResponse = () => h.replaceFavorites([]);
  await h.searchWord('combat', h.wrapper, 'original');
  assert.deepEqual(h.favorites(), []);
  assert.equal(h.favoriteWrites.length, 0);
});

test('identical British and American pronunciations still display both labels', async () => {
  const same = '英 /kæt/　美 /kæt/';
  const h = harness([{ word: 'combat', phonetic: same }]);
  await h.searchWord('combat', h.wrapper, 'original');
  assert.equal(h.requests.length, 0);
  assert.ok(h.resultEl.innerHTML.includes(same));
});

test('favoriting and normalizing a page preserve both pronunciations through study exports', async () => {
  const h = harness();
  await h.searchWord('combat', h.wrapper, 'original');
  h.addVFav(h.wrapper._wordData);
  assert.equal(h.favorites()[0].phonetic, dual);
  const saved = h.normalizeWordSearchCard({ input: 'combat', result: h.wrapper._wordData });
  assert.equal(JSON.parse(JSON.stringify(saved)).result.phonetic, dual);
  const studyWords = StudyExport.normalizeFavorites(h.favorites());
  assert.ok(StudyExport.renderHtml(studyWords).includes(dual));
  assert.ok(StudyExport.renderMarkdown(studyWords).includes(dual));
});
