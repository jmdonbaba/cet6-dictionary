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
  assert.doesNotMatch(focusRule[0], /background-color:|backdrop-filter:|box-shadow:/, 'focus keeps the clear input tint');
  assert.match(focusRule[0], /\.fav-search input/);
  assert.match(focusRule[0], /\.comparison-search/);
  assert.match(renderer, /button\.matches\('input'\)/);
  assert.match(renderer, /GlassOptics\.inputStrength\(input,performance\.now\(\)\)/, 'the whole input background gets the focus lens');
});

test('modals get their final refraction before the first paint without an entry animation', () => {
  assert.match(css, /html\[data-interface="glass"\] \.modal-card\.active \{\s*animation: none;/);
  assert.match(refraction, /function flush\(\) \{/);
  assert.match(refraction, /flush: flush,/);
  assert.match(html, /LiquidGlass\.flush\(\)/);
  assert.match(appearance, /LiquidGlass\.flush\(\)/);
});

test('modal inner rows use clear glass without stacked white fog', () => {
  assert.match(css, /html\[data-interface="glass"\] \.appearance-option,\s*html\[data-interface="glass"\] \.theme-option \{[\s\S]*?background-color: transparent;[\s\S]*?backdrop-filter: none;/);
  assert.match(css, /html\[data-interface="glass"\] \.modal-card :is\(\.page-record-item, \.vf-compact, \.vf-detail,[\s\S]*?background: transparent;[\s\S]*?backdrop-filter: none;/);
});

test('native modal inner rows keep a clear refractive backdrop', () => {
  assert.match(refraction, /MODAL_INNER = GlassOptics\.modalLayers/);
  const nativeLine = refraction.split('\n').find(line => line.includes('var nativeSelector'));
  assert.ok(nativeLine && nativeLine.includes('MODAL_INNER'), 'modal inner rows join the native surface selector');
  assert.match(refraction, /var inner=element\.matches\(MODAL_INNER\);/);
  assert.match(css, /\.modal-card :is\(\.appearance-option, \.theme-option,[\s\S]*?\.glass-layer-optics::before \{[\s\S]*?backdrop-filter: blur\(\.3px\);[\s\S]*?filter: var\(--glass-filter, none\);/);
});

test('modal card itself is transparent refractive glass, not a flat white sheet', () => {
  assert.match(css, /html\[data-interface="glass"\] \.modal-card::before \{[\s\S]*?background-color: rgba\(255, 255, 255, 0\.26\);[\s\S]*?background-image: var\(--glass-tint\);/);
  assert.match(renderer, /drawSurface\(element,false,1,sx,sy,rects,shapes\)/, 'modal uses the card shader');
  assert.match(renderer, /ctx\.drawImage\(canvas,/, 'the actual refracted wallpaper is presented above the overlay');
});
