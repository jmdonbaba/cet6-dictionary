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

test('updates visibility and disabled state from scroll geometry and modal state', () => {
  assert.match(source, /function updatePageJumpControls\(\)/);
  assert.match(source, /scrollHeight\s*>\s*clientHeight\s*\+\s*1/);
  assert.match(source, /\$modalOverlay\.style\.display\s*!==\s*'none'/);
  assert.match(source, /\$btnJumpTop\.disabled\s*=\s*scrollTop\s*<=\s*1/);
  assert.match(source, /\$btnJumpBottom\.disabled\s*=\s*scrollTop\s*\+\s*clientHeight\s*>=\s*scrollHeight\s*-\s*1/);
});

test('uses reduced-motion-aware top and bottom scrolling', () => {
  assert.match(source, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(source, /window\.scrollTo\(\{\s*top:\s*edge === 'top' \? 0 : document\.documentElement\.scrollHeight/);
  assert.match(source, /behavior:\s*reducedMotion \? 'auto' : 'smooth'/);
});

test('refreshes controls after scrolling, resizing, modal changes, and content changes', () => {
  assert.match(source, /addEventListener\('scroll', schedulePageJumpUpdate/);
  assert.match(source, /addEventListener\('resize', schedulePageJumpUpdate/);
  assert.match(source, /new MutationObserver\(schedulePageJumpUpdate\)/);
  assert.match(source, /\$wsModules, document\.querySelector\('\.footer'\), \$modalOverlay/);
  assert.match(source, /function openModal\([\s\S]*?schedulePageJumpUpdate\(\);/);
  assert.match(source, /function closeModal\([\s\S]*?schedulePageJumpUpdate\(\);/);
  assert.match(source, /wrapper\.after\(newModule\);\s*schedulePageJumpUpdate\(\);/);
  assert.match(source, /wrapper\.remove\(\);\s*schedulePageJumpUpdate\(\);/);
  assert.match(source, /requestAnimationFrame\(updatePageJumpControls\)/);
});
