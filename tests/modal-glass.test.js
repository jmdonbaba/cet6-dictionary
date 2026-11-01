const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'appearance.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'glass-renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refraction = fs.readFileSync(path.join(root, 'glass-refraction.js'), 'utf8');
const appearance = fs.readFileSync(path.join(root, 'appearance.js'), 'utf8');

test('focused search fields drop the border and bend their glass card harder', () => {
  const focusRule = css.match(/html\[data-interface="glass"\] :is\(\.input-area input,[\s\S]*?\n\}/);
  assert.ok(focusRule, 'glass focus rule must exist');
  assert.match(focusRule[0], /border-color: transparent !important;/);
  assert.match(focusRule[0], /outline: none !important;/);
  assert.match(focusRule[0], /box-shadow: none !important;/);
  assert.match(focusRule[0], /\.fav-search input/);
  assert.match(focusRule[0], /\.comparison-search/);
  assert.match(renderer, /uniform float focusLens;/);
  assert.match(renderer, /focusLens>\.5\?2\.1:1\./);
  assert.match(renderer, /gl\.uniform1f\(locations\.focusLens,element===document\.activeElement\?1:0\);/);
  assert.match(renderer, /document\.addEventListener\('focusin', requestRender\)/);
  assert.doesNotMatch(renderer, /focusRect|focusBoost/, 'focus must boost the control lens, not the whole card');
});

test('modals get their final refraction before the first paint without an entry animation', () => {
  assert.match(css, /html\[data-interface="glass"\] \.modal-card\.active \{\s*animation: none;/);
  assert.match(refraction, /function flush\(\) \{/);
  assert.match(refraction, /flush: flush,/);
  assert.match(html, /LiquidGlass\.flush\(\)/);
  assert.match(appearance, /LiquidGlass\.flush\(\)/);
});

test('modal inner rows share the frosted glass material', () => {
  assert.match(css, /html\[data-interface="glass"\] \.appearance-option,\s*html\[data-interface="glass"\] \.theme-option \{[\s\S]*?background-color: rgba\(255, 255, 255, 0\.14\);[\s\S]*?backdrop-filter: blur\(16px\) saturate\(140%\);/);
  assert.match(css, /html\[data-interface="glass"\] \.modal-card :is\(\.page-record-item, \.vf-compact, \.vf-detail,[\s\S]*?backdrop-filter: blur\(14px\) saturate\(135%\);/);
});

test('modal inner rows get their own blurred-backdrop refraction', () => {
  assert.match(refraction, /MODAL_INNER = '\.appearance-option, \.theme-option/);
  const nativeLine = refraction.split('\n').find(line => line.includes('var nativeSelector'));
  assert.ok(nativeLine && nativeLine.includes('MODAL_INNER'), 'modal inner rows join the native surface selector');
  assert.match(refraction, /var inner=element\.matches\(MODAL_INNER\);/);
  assert.match(css, /\.modal-card :is\(\.appearance-option, \.theme-option,[\s\S]*?\.glass-layer-optics::before \{[\s\S]*?backdrop-filter: blur\(12px\) saturate\(145%\);[\s\S]*?filter: var\(--glass-filter, none\);/);
  assert.match(css, /\.modal-card :is\(\.appearance-option, \.theme-option,[\s\S]*?\.glass-layer-optics::after \{[\s\S]*?filter: var\(--glass-filter, none\);/);
});
