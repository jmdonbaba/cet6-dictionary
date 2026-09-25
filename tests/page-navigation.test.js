const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');

test('renders accessible top and bottom controls', () => {
  assert.match(source, /id="pageJumpControls"/);
  assert.match(source, /id="btnJumpTop"[^>]*aria-label="回到页面顶部"[^>]*title="回到顶部"/);
  assert.match(source, /id="btnJumpBottom"[^>]*aria-label="前往页面底部"[^>]*title="前往底部"/);
  assert.match(source, /id="btnJumpTop"[\s\S]*?<svg[^>]*class="page-jump-icon"[\s\S]*?<path[^>]*d="M12 19V5M6\.5 10\.5 12 5l5\.5 5\.5"/);
  assert.match(source, /id="btnJumpBottom"[\s\S]*?<path[^>]*d="M12 5v14m-5\.5-5\.5L12 19l5\.5-5\.5"/);
  assert.match(source, /\.page-jump-icon\s*\{[^}]*stroke-linecap:\s*round;[^}]*stroke-linejoin:\s*round;/s);
});

test('controls sit outside the desktop content column and hide on narrow screens', () => {
  assert.match(source, /\.page-jump-btn\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  assert.match(source, /\.page-jump-controls\s*\{[^}]*top:\s*50%;[^}]*left:\s*calc\(50% \+ 426px\);[^}]*transform:\s*translateY\(-50%\);/s);
  assert.match(source, /@media \(max-width:\s*1000px\)\s*\{\s*\.page-jump-controls\s*\{[^}]*display:\s*none\s*!important;/s);
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

test('refreshes page controls when the optional API key guide toggles', () => {
  const hook = source.match(/const \$keyGuide = document\.querySelector\('\.key-guide'\);\s*if \(\$keyGuide\) \$keyGuide\.addEventListener\('toggle', schedulePageJumpUpdate\);/);
  assert.ok(hook, 'the guide must schedule a page update on toggle');

  let listener;
  let updates = 0;
  const document = { querySelector: () => ({ addEventListener: (event, callback) => {
    assert.equal(event, 'toggle');
    listener = callback;
  } }) };
  const schedulePageJumpUpdate = () => { updates += 1; };
  vm.runInNewContext(hook[0], { document, schedulePageJumpUpdate });
  listener();
  assert.equal(updates, 1);

  assert.doesNotThrow(() => vm.runInNewContext(hook[0], {
    document: { querySelector: () => null }, schedulePageJumpUpdate
  }));
});
