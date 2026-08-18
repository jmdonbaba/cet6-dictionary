const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('⋮ button toggles: clicking an already-open menu closes it', () => {
  const handler = source.match(/\$modalVocabBody\.addEventListener\('click', e => \{[\s\S]*?\n\}\);/);
  assert.ok(handler, 'vocab favorites click handler must exist');
  const body = handler[0];
  assert.match(body, /const wasOpen = menu && menu\.classList\.contains\('open'\);/);
  assert.match(body, /if \(!wasOpen && menu\) menu\.classList\.add\('open'\);/);
  // Must not reopen unconditionally right after closing
  assert.doesNotMatch(body, /closeAllMenus\(\);\s*document\.querySelector/);
});

test('⋮ button still stops propagation so the outside-click listener ignores it', () => {
  const handler = source.match(/\$modalVocabBody\.addEventListener\('click', e => \{[\s\S]*?\n\}\);/);
  assert.ok(handler, 'vocab favorites click handler must exist');
  assert.match(handler[0], /e\.stopPropagation\(\);/);
});
