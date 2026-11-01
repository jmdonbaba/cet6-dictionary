// Static checks for the water colour slider (cet6_water_hue): settings control,
// hue tint layer, first-paint apply and persistence wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8').replace(/\?v=[a-f0-9]+(?=")/g, '');
const css = fs.readFileSync('appearance.css', 'utf8');
const script = fs.readFileSync('appearance.js', 'utf8');
const section = css.slice(css.indexOf('7. 水波颜色条'));

function cssRuleText(selector) {
  const index = section.indexOf(selector);
  assert.ok(index > -1, `missing CSS rule for ${selector}`);
  const open = section.indexOf('{', index);
  const close = section.indexOf('}', open);
  assert.ok(open > -1 && close > open, `malformed CSS rule for ${selector}`);
  return section.slice(open + 1, close);
}

test('settings panel offers a water colour slider only for the water theme', () => {
  const controlTag = source.match(/<div class="water-tint-control" id="waterTintControl"[^>]*>/);
  assert.ok(controlTag, 'missing #waterTintControl in the settings panel');
  assert.match(controlTag[0], /\shidden(?:\s|>)/, 'the slider starts hidden until the water theme is active');
  assert.ok(source.indexOf('id="waterTintControl"') > source.indexOf('class="theme-options"'),
    'the slider belongs to the theme section, after the theme radio grid');
  assert.ok(source.indexOf('id="waterTintControl"') < source.indexOf('<script src="study-export.js"'),
    'the slider must live inside the settings modal markup');

  const slider = source.match(/<input[^>]*id="waterHueSlider"[^>]*>/s);
  assert.ok(slider, 'missing #waterHueSlider');
  for (const attribute of ['type="range"', 'min="0"', 'max="359"', 'step="1"', 'value="174"', 'class="water-tint-slider"']) {
    assert.match(slider[0], new RegExp(attribute.replace(/[[\]]/g, '\\$&')), `slider needs ${attribute}`);
  }
  assert.match(slider[0], /aria-label="水波颜色（色相）"/);
  assert.match(slider[0], /aria-valuetext="青绿 174°"/);
  assert.match(slider[0], /aria-describedby="waterHueHint"/);
  assert.match(source, /<label class="water-tint-label" for="waterHueSlider">水波颜色<\/label>/);
  assert.match(source, /<output class="water-tint-text" id="waterHueValue" for="waterHueSlider">青绿 174°<\/output>/);
  assert.match(source, /<span class="water-tint-chip" id="waterHueChip" aria-hidden="true"><\/span>/);
  assert.match(source, /<p class="water-tint-hint" id="waterHueHint">左右拖动调整水波背景的颜色/);
  assert.match(source, /<span class="appearance-water-tint" aria-hidden="true"><\/span>/,
    'the backdrop needs a hue tint layer above the water image / GPU canvas');
});

test('a hue-blend tint recolours the water wallpaper and the theme swatch', () => {
  const rootRule = section.match(/:root \{([\s\S]*?)\}/);
  assert.ok(rootRule, 'missing the water hue defaults');
  assert.match(rootRule[1], /--water-hue: 174;/);
  assert.match(rootRule[1], /--water-tint-opacity: 0;/);

  const tint = cssRuleText('html[data-wallpaper="water"] .appearance-water-tint');
  assert.match(tint, /position: absolute;/);
  assert.match(tint, /inset: 0;/);
  assert.match(tint, /z-index: 2;/, 'the tint paints above the water layer and the GPU wallpaper canvas');
  assert.match(tint, /pointer-events: none;/);
  assert.match(tint, /background: hsl\(var\(--water-hue\), 100%, 50%\);/);
  assert.match(tint, /mix-blend-mode: hue;/, 'the tint keeps the water texture luminance and only swaps hue');
  assert.match(tint, /opacity: var\(--water-tint-opacity\);/);
  assert.match(section, /html:not\(\[data-wallpaper="water"\]\) \.appearance-water-tint \{ display: none; \}/,
    'the tint layer is hidden for every other theme');

  const swatch = cssRuleText('.theme-swatch.is-water::after');
  assert.match(swatch, /mix-blend-mode: hue;/);
  assert.match(swatch, /background: hsl\(var\(--water-hue\), 100%, 50%\);/);
  assert.match(swatch, /opacity: var\(--water-tint-opacity\);/);

  assert.match(section, /\.water-tint-control\[hidden\] \{ display: none; \}/);
  assert.match(cssRuleText('.water-tint-slider::-webkit-slider-runnable-track'), /hsl\(174, 75%, 48%\)/,
    'the slider track previews the full hue range around the default aqua');
  assert.match(cssRuleText('.water-tint-slider::-webkit-slider-thumb'), /border: 2px solid hsl\(var\(--water-hue\), 85%, 45%\);/);
  assert.match(section, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?html\[data-wallpaper="water"\] \.appearance-water-tint \{ transition: none; \}/);
});

test('the water hue is applied before first paint and stored per browser', () => {
  assert.match(source, /var savedWaterHue = parseInt\(localStorage\.getItem\('cet6_water_hue'\), 10\);/);
  assert.match(source, /if \(!isFinite\(savedWaterHue\)\) savedWaterHue = 174;/);
  assert.match(source, /document\.documentElement\.style\.setProperty\('--water-hue', String\(savedWaterHue\)\);/);
  assert.match(source, /document\.documentElement\.dataset\.waterHue = String\(savedWaterHue\);/);

  assert.match(script, /var WATER_HUE_KEY = 'cet6_water_hue';/);
  assert.match(script, /var DEFAULT_WATER_HUE = 174;/);
  assert.match(script, /function normalizeWaterHue\(value\) \{[\s\S]*?parseInt\(value, 10\)[\s\S]*?\(\(hue % 360\) \+ 360\) % 360;/);
  assert.match(script, /function readStoredWaterHue\(\) \{[\s\S]*?window\.localStorage\.getItem\(WATER_HUE_KEY\)/);
  assert.match(script, /function writeStoredWaterHue\(hue\) \{[\s\S]*?window\.localStorage\.setItem\(WATER_HUE_KEY, String\(hue\)\);/);
  assert.match(script, /function applyWaterHue\(value, options\) \{[\s\S]*?root\.style\.setProperty\('--water-hue', String\(hue\)\);/);
  assert.match(script, /root\.style\.setProperty\('--water-tint-opacity', hue === DEFAULT_WATER_HUE \? '0' : '0\.92'\);/);
  assert.match(script, /root\.dataset\.waterTint = hue === DEFAULT_WATER_HUE \? 'off' : 'on';/);
  assert.match(script, /if \(control\) control\.hidden = currentTheme !== 'water';/,
    'the slider is only offered for the water theme');
  assert.match(script, /hueSlider\.addEventListener\('input', function \(\) \{\s*applyWaterHue\(hueSlider\.value, \{ silent: true \}\);/);
  assert.match(script, /hueSlider\.addEventListener\('change', function \(\) \{\s*applyWaterHue\(hueSlider\.value\);/);
  assert.match(script, /event\.key !== WATER_HUE_KEY/);
  assert.match(script, /if \(event\.key === WATER_HUE_KEY\) \{\s*applyWaterHue\(readStoredWaterHue\(\), \{ silent: true \}\);/);
  assert.match(script, /applyWaterHue\(readStoredWaterHue\(\), \{ silent: true \}\);\s*paint\(readStoredStyle\(\)\);/,
    'the stored hue must be applied before the first themed paint');
  assert.match(script, /WATER_HUE_KEY: WATER_HUE_KEY,/);
  assert.match(script, /DEFAULT_WATER_HUE: DEFAULT_WATER_HUE,/);
  assert.match(script, /getWaterHue: function \(\) \{ return currentWaterHue; \},/);
  assert.match(script, /setWaterHue: applyWaterHue,/);
  assert.match(script, /detail: \{ style: currentStyle, theme: currentTheme, waterHue: currentWaterHue \}/);
  assert.match(script, /color = 'hsl\(' \+ currentWaterHue \+ ', 38%, 72%\)';/,
    'the mobile browser theme colour follows a custom water hue');
});
