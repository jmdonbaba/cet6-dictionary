const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const StudyTools = require('../study-tools');
const StudyExport = require('../study-export');

const phraseMnemonic = {
  word: 'resolve to',
  breakdown: 'resolve（下定决心） + to（引出要做的事） → 下定决心去做 → 决心、决定（做某事）',
  parts: [
    { part: 'resolve', source: '动词：在这个搭配中表示下定决心' },
    { part: 'to', source: '不定式标记：后接动词原形，引出决心要做的事' }
  ]
};

function requestHarness(result = phraseMnemonic) {
  const source = fs.readFileSync('study-tools-ui.js', 'utf8');
  const fn = source.match(/  async function requestStudy\([^)]*\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'requestStudy exists');
  const requests = [];
  const request = new Function('StudyTools', 'fetch', 'DEEPSEEK_URL', 'getApiKey', 'extractJSON',
    `${fn[0]}; return requestStudy;`)(StudyTools, async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) };
  }, 'https://example.test/chat', () => 'test-key', JSON.parse);
  return { request, requests };
}

test('phrase requests explain whole words and their roles instead of splitting internal roots', async () => {
  const h = requestHarness();
  const result = await h.request('mnemonic', ['resolve to']);
  const prompt = h.requests[0].messages[0].content;
  assert.match(prompt, /完整单词/);
  assert.match(prompt, /不再.*词根.*前缀.*后缀/);
  assert.match(prompt, /不定式标记/);
  assert.doesNotMatch(prompt, /plaus|advisable/);
  assert.deepEqual(JSON.parse(h.requests[0].messages[1].content), { words: ['resolve to'] });
  assert.deepEqual(result.mnemonic, phraseMnemonic);
});

test('phrase requests reject internal-root parts and missing word explanations', async () => {
  for (const parts of [[{ part: 're-', source: '前缀' }, { part: 'solve', source: '词根' }, phraseMnemonic.parts[1]], [phraseMnemonic.parts[0]], []]) {
    const h = requestHarness({ ...phraseMnemonic, parts });
    await assert.rejects(h.request('mnemonic', ['resolve to']), /词组|单词|不匹配/);
  }
});

test('phrase formulas must also use whole words even when their explanations are correct', async () => {
  const h = requestHarness({ ...phraseMnemonic, breakdown: 're-（加强） + solve（解决） + to（引出动作） → 决心做某事' });
  await assert.rejects(h.request('mnemonic', ['resolve to']), /词组|单词|不匹配/);
});

test('phrases with several words or unicode spaces keep the same whole-word rule', async () => {
  for (const word of ['in spite of', 'look\u00a0up']) {
    const parts = StudyTools.normalizeWord(word).split(' ').map(part => ({ part, source: '在搭配中的含义与作用' }));
    const h = requestHarness({ word, breakdown: parts.map(item => `${item.part}（此处的含义）`).join(' + ') + ' → 整体含义', parts });
    await h.request('mnemonic', [word]);
    assert.match(h.requests[0].messages[0].content, /完整单词/);
  }
});

test('single words retain their root and affix memory instructions', async () => {
  const h = requestHarness({ word: 'advisable', breakdown: 'advise（建议） + able（能…的） → 明智的、可取的', parts: [] });
  await h.request('mnemonic', ['advisable']);
  assert.match(h.requests[0].messages[0].content, /advisable/);
  assert.match(h.requests[0].messages[0].content, /词根、前缀或后缀/);
});

test('phrase exports label word explanations and retain complete words in both formats', () => {
  const words = StudyExport.normalizeFavorites([{ word: 'resolve to', mnemonic: phraseMnemonic }]);
  const html = StudyExport.renderHtml(words);
  const markdown = StudyExport.renderMarkdown(words);
  assert.match(html, /词语解释：<\/strong><strong>resolve<\/strong>：动词/);
  assert.match(markdown, /\*\*词语解释\*\*：resolve：动词/);
  assert.doesNotMatch(html, /词块来源/);
  assert.doesNotMatch(markdown, /词块来源/);
});
