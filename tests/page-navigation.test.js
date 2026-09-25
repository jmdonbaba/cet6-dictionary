const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('renders accessible top and bottom controls', () => {
  assert.match(source, /id="pageJumpControls"/);
  assert.match(source, /id="btnJumpTop"[^>]*aria-label="回到页面顶部"[^>]*title="回到顶部"/);
  assert.match(source, /id="btnJumpBottom"[^>]*aria-label="前往页面底部"[^>]*title="前往底部"/);
});

test('controls are touch-safe and honor mobile safe areas', () => {
  assert.match(source, /\.page-jump-btn\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  assert.match(source, /env\(safe-area-inset-right/);
  assert.match(source, /env\(safe-area-inset-bottom/);
});
