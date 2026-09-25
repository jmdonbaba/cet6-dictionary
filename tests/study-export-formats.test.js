const assert = require('node:assert/strict');
const test = require('node:test');
const StudyExport = require('../study-export.js');

const words = StudyExport.normalizeFavorites([{
  word: 'combat <&>', phonetic: '/test/', pos: 'n. | v.',
  definitions: ['战斗 *重点*', '防止'], forms: 'combats | combated',
  examples: [
    { en: 'Example <one>.', cn: '例句一。' },
    { en: 'Example two.', cn: '例句二。' },
    { en: 'Example three.', cn: '例句三。' },
    { en: 'Example four.', cn: '例句四。' }
  ]
}]);

test('HTML is standalone, escaped, printable, and contains three examples', () => {
  const html = StudyExport.renderHtml(words, { generatedAt: new Date(2026, 8, 25) });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /@page\s*\{\s*size:\s*A4/);
  assert.match(html, /combat &lt;&amp;&gt;/);
  assert.match(html, /Example &lt;one&gt;\./);
  assert.match(html, /例句三。/);
  assert.doesNotMatch(html, /Example four/);
  assert.match(html, /已掌握/);
  assert.match(html, /复习笔记/);
});

test('Markdown escapes structure and uses a task checkbox', () => {
  const md = StudyExport.renderMarkdown(words, { generatedAt: new Date(2026, 8, 25) });
  assert.match(md, /^# CET-6 收藏词汇背诵讲义/m);
  assert.match(md, /- \[ \] 已掌握/);
  assert.match(md, /n\. \\| v\./);
  assert.match(md, /战斗 \\\*重点\\\*/);
  assert.match(md, /3\. \*\*Example three\.\*\*/);
  assert.doesNotMatch(md, /Example four/);
});

test('Markdown treats HTML-looking stored text as text', () => {
  const md = StudyExport.renderMarkdown([{
    word: '<script>alert(1)</script> &', phonetic: '', pos: '',
    definitions: [], forms: '', examples: []
  }], { generatedAt: new Date(2026, 8, 25) });
  assert.match(md, /&lt;script&gt;/);
  assert.match(md, /&lt;\/script&gt; &amp;/);
  assert.doesNotMatch(md, /<script>/);
});

test('renderers omit empty optional sections and cap direct input examples', () => {
  const direct = [{
    word: 'plain', phonetic: '', pos: '', definitions: [], forms: '',
    examples: Array.from({ length: 4 }, (_, index) => ({ en: `Sentence ${index + 1}.`, cn: '' }))
  }];
  const html = StudyExport.renderHtml(direct, { generatedAt: new Date(2026, 8, 25) });
  const md = StudyExport.renderMarkdown(direct, { generatedAt: new Date(2026, 8, 25) });
  for (const output of [html, md]) {
    assert.doesNotMatch(output, /Sentence 4/);
    assert.doesNotMatch(output, /词形|释义|音标/);
  }
});

test('downloadBlob creates, clicks, and removes an anchor', () => {
  const originalUrl = global.URL;
  const originalTimeout = global.setTimeout;
  const events = [];
  global.URL = {
    createObjectURL(blob) { events.push(['create', blob]); return 'blob:test'; },
    revokeObjectURL(url) { events.push(['revoke', url]); }
  };
  global.setTimeout = (callback, delay) => { events.push(['timeout', delay]); callback(); };
  const anchor = {
    click() { events.push(['click', this.href, this.download]); },
    remove() { events.push(['remove']); }
  };
  const doc = {
    createElement(tag) { events.push(['element', tag]); return anchor; },
    body: { appendChild(node) { events.push(['append', node]); } }
  };
  const blob = new Blob(['hello']);
  try {
    StudyExport.downloadBlob(blob, 'study.md', doc);
  } finally {
    global.URL = originalUrl;
    global.setTimeout = originalTimeout;
  }
  assert.deepEqual(events, [
    ['create', blob], ['element', 'a'], ['append', anchor],
    ['click', 'blob:test', 'study.md'], ['remove'], ['timeout', 1000], ['revoke', 'blob:test']
  ]);
});
