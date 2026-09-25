const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('adds gentle static ambient light behind the application', () => {
  assert.match(source, /--bg:\s*#eef0f6;/);
  assert.match(source, /body\s*\{[^}]*background:\s*radial-gradient/s);
  assert.match(source, /body\s*\{[^}]*isolation:\s*isolate;/s);
  assert.match(source, /body::before\s*\{[^}]*radial-gradient\(circle 240px[\s\S]*?var\(--spotlight-x\)[\s\S]*?var\(--spotlight-y\)[\s\S]*?pointer-events:\s*none;/s);
  assert.match(source, /\.container\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/s);
});

test('tracks a fine pointer at most once per animation frame', () => {
  assert.match(source, /matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
  assert.match(source, /requestAnimationFrame\(paintPointerSpotlight\)/);
  assert.match(source, /setProperty\('--spotlight-x'/);
  assert.match(source, /setProperty\('--spotlight-y'/);
  assert.match(source, /pointerleave[\s\S]*?setProperty\('--spotlight-opacity',\s*'0'\)/);
});

test('does not enable pointer tracking when reduced motion is requested', () => {
  assert.match(source, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(source, /if \(finePointer\.matches && !reducedMotion\.matches\)/);
});
