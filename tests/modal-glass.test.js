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
  const focusRule = css.match(/html\[data-interface="glass"\] \.input-area input:focus,[\s\S]*?\n\}/);
  assert.ok(focusRule, 'glass focus rule must exist');
  assert.match(focusRule[0], /border-color: transparent !important;/);
  assert.match(focusRule[0], /outline: none !important;/);
  assert.match(focusRule[0], /box-shadow: none !important;/);
  assert.match(renderer, /uniform vec4 focusRect;/);
  assert.match(renderer, /uniform float focusBoost;/);
  assert.match(renderer, /element\.contains\(document\.activeElement\)\) focusIndex = count;/);
  assert.match(renderer, /gl\.uniform1f\(locations\.focusBoost, focusIndex >= 0 \? 1 : 0\);/);
  assert.match(renderer, /\?1\.35:1\./);
  assert.match(renderer, /document\.addEventListener\('focusin', requestRender\)/);
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
