const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];

// Replace every @media { ... } block with spaces so leftover text is
// only rules that live outside any media query.
function stripMediaBlocks(cssText) {
  let out = '';
  let i = 0;
  while (i < cssText.length) {
    if (cssText.startsWith('@media', i)) {
      const open = cssText.indexOf('{', i);
      if (open === -1) { out += cssText.slice(i); break; }
      let depth = 0;
      let k = open;
      for (; k < cssText.length; k++) {
        if (cssText[k] === '{') depth++;
        else if (cssText[k] === '}') { depth--; if (depth === 0) break; }
      }
      out += ' '.repeat(k - i + 1);
      i = k + 1;
    } else {
      out += cssText[i];
      i++;
    }
  }
  return out;
}

test('suppresses the mobile tap highlight flash', () => {
  assert.match(css, /-webkit-tap-highlight-color:\s*transparent/);
});

test('removes the blue focus ring on button taps but keeps it for keyboard', () => {
  assert.match(css, /button:focus\s*\{\s*outline:\s*none;\s*\}/);
  assert.match(css, /button:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--primary\);/);
});

test('scopes all :hover rules to hover-capable devices', () => {
  assert.ok(css.includes('@media (hover: hover)'));
  assert.doesNotMatch(stripMediaBlocks(css), /:hover/);
});
