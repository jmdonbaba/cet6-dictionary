const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('appearance.css', 'utf8');
const script = fs.readFileSync('appearance.js', 'utf8');

const head = source.slice(0, source.indexOf('</head>'));
const body = source.slice(source.indexOf('<body>'));
// Script templates build dynamic ids (`${id}`, `escAttr(f.id)`); only static markup counts here.
const staticMarkup = source.replace(/<script\b[\s\S]*?<\/script>/g, '');

// Minimal CSS block scanner: returns every `selector { body }` pair, including at-rule blocks.
// Comments are stripped first so commented-out code can never satisfy a rule assertion.
function ruleBlocks(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const openBlocks = [];
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === '{') {
      let start = index - 1;
      while (start >= 0 && !'};{'.includes(clean[start])) start -= 1;
      openBlocks.push({ selector: clean.slice(start + 1, index).trim(), start: index });
    } else if (char === '}') {
      const block = openBlocks.pop();
      if (block) {
        blocks.push({
          selector: block.selector.replace(/\s+/g, ' ').trim(),
          body: clean.slice(block.start + 1, index)
        });
      }
    }
  }
  return blocks;
}

const cssLeafRules = ruleBlocks(css).filter(block => !block.body.includes('{'));
const findRule = selectorPattern => cssLeafRules.find(block => selectorPattern.test(block.selector));
const ruleBody = selectorPattern => {
  const block = findRule(selectorPattern);
  assert.ok(block, `missing CSS rule matching: ${selectorPattern}`);
  return block.body;
};

const themeValues = ['minimal', 'aurora', 'peach', 'night', 'water'];
const themeLabels = { minimal: '极简', aurora: '极光', peach: '蜜桃', night: '深空', water: '水波' };
const themeColors = { minimal: '#f8fafc', aurora: '#eef0fb', peach: '#fff7ed', night: '#0b1026', water: '#8fd8d2' };

test('settings entry is an accessible fixed control that turns absolute on narrow screens', () => {
  const buttonTag = body.match(/<button[^>]*id="btnOpenSettings"[^>]*>/);
  assert.ok(buttonTag, 'the settings entry must live inside <body>');
  assert.match(buttonTag[0], /class="settings-entry"/);
  assert.match(buttonTag[0], /type="button"/);
  assert.match(buttonTag[0], /aria-label="打开设置"/);
  assert.match(buttonTag[0], /aria-haspopup="dialog"/);
  assert.doesNotMatch(head, /btnOpenSettings/, 'the trigger must not be duplicated in <head>');
  const iconTag = body.match(/<svg class="settings-entry-icon"[^>]*>/);
  assert.ok(iconTag);
  assert.match(iconTag[0], /aria-hidden="true"/);
  assert.match(iconTag[0], /focusable="false"/);

  // Floating control outside the content column, small hit target, safe-area aware.
  const baseRule = ruleBody(/^\.settings-entry$/);
  assert.match(baseRule, /position: fixed;/);
  assert.match(baseRule, /top: max\(16px, env\(safe-area-inset-top\)\);/);
  assert.match(baseRule, /right: max\(16px, env\(safe-area-inset-right\)\);/);
  assert.match(baseRule, /z-index: 60;/);
  assert.match(baseRule, /width: 42px;/);
  assert.match(baseRule, /height: 42px;/);
  assert.match(baseRule, /border-radius: 50%;/);

  // ≤1000px it leaves the fixed layer so it can never cover scrolled card controls.
  const entryRules = cssLeafRules.filter(block => block.selector === '.settings-entry');
  assert.ok(entryRules.length >= 3, 'expected base, narrow-screen and phone rules for the gear');
  const absolute = entryRules.find(block => /position: absolute;/.test(block.body));
  assert.ok(absolute, 'the settings entry must switch to position:absolute on narrow screens');
  assert.match(absolute.body, /top: max\(12px, env\(safe-area-inset-top\)\);/);
  assert.match(absolute.body, /right: max\(12px, env\(safe-area-inset-right\)\);/);
  assert.match(css, /@media \(max-width: 1000px\) \{[\s\S]*?\.settings-entry \{\s*position: absolute;/);
  const smallRule = entryRules.find(block => /width: 38px;/.test(block.body));
  assert.ok(smallRule, 'phones get a compact 38px hit target');

  // Stacking: above page-jump controls (30), below modal overlays (999).
  const jumpZIndex = Number((source.match(/\.page-jump-controls\s*\{[^}]*z-index:\s*(\d+);/) || [])[1]);
  const overlayZIndex = Number((source.match(/\.modal-overlay\s*\{[^}]*z-index:\s*(\d+);/) || [])[1]);
  const entryZIndex = Number((baseRule.match(/z-index:\s*(\d+);/) || [])[1]);
  assert.equal(entryZIndex, 60);
  assert.ok(entryZIndex > jumpZIndex && entryZIndex < overlayZIndex);
  assert.doesNotMatch(source, /\.header\s*\{[^}]*position:\s*(?:fixed|sticky)/);
  assert.match(ruleBody(/^button\.settings-entry:active$/), /scale: 0\.92;/,
    'the press scale must outrank the global button:not(:disabled):active rule');
  assert.match(ruleBody(/^\.settings-entry:focus-visible$/), /outline: 2px solid var\(--primary\);/);
});

test('settings panel exposes the interface and theme sections with five theme radios', () => {
  const panelTag = body.match(/<div class="modal-card settings-modal" id="modalSettings"[^>]*>/);
  assert.ok(panelTag);
  assert.match(panelTag[0], /role="dialog"/);
  assert.match(panelTag[0], /aria-modal="true"/);
  assert.match(panelTag[0], /aria-labelledby="settingsTitle"/);
  const overlayStart = source.indexOf('<div class="modal-overlay" id="modalOverlay"');
  const panelStart = source.indexOf('id="modalSettings"');
  const overlayEnd = source.indexOf('<script src="study-export.js">');
  assert.ok(overlayStart > -1 && panelStart > overlayStart && panelStart < overlayEnd);

  // Interface section (2 options) keeps the previous contract.
  assert.match(body, /<span class="modal-header-title" id="settingsTitle">设置<\/span>/);
  assert.match(body, /<h3 class="settings-section-title" id="appearanceSectionTitle">界面设置<\/h3>/);
  assert.match(body, /<div class="appearance-options" role="radiogroup" aria-label="界面风格">/);
  assert.match(body, /传统界面/);
  assert.match(body, /玻璃质感<span class="appearance-dev">（开发中）<\/span>/);
  assert.match(body, /玻璃质感为实验性界面，仍在持续调整；[\s\S]*?主题会按界面分别记住/);

  // Theme section (5 options) is new.
  assert.match(body, /<h3 class="settings-section-title" id="themeSectionTitle">主题<\/h3>/);
  assert.match(body, /<div class="theme-options" role="radiogroup" aria-label="背景主题">/);
  assert.match(body, /背景主题两种界面都能用；传统界面默认“极简”（最初的样子），玻璃质感默认“极光”。/);
  const styleRadios = [...source.matchAll(/<input[^>]*name="appearanceStyle"[^>]*>/g)];
  assert.equal(styleRadios.length, 2);
  const themeRadios = [...source.matchAll(/<input[^>]*name="wallpaperTheme"[^>]*value="([^"]+)"[^>]*>/g)];
  assert.deepEqual(themeRadios.map(match => match[1]), themeValues,
    'theme radios must be declared in the documented order');
  for (const theme of themeValues) {
    assert.match(body, new RegExp(`value="${theme}"`));
    assert.match(body, new RegExp(`class="theme-swatch is-${theme}"`), `missing ${theme} swatch`);
    assert.match(body, new RegExp(`class="appearance-option-title">${themeLabels[theme]}<`), `missing ${theme} label`);
  }
  assert.equal((body.match(/class="theme-option"/g) || []).length, 5,
    'exactly five theme option labels are expected');
  assert.doesNotMatch(source, /<input[^>]*name="wallpaperTheme"[^>]*\schecked\b/,
    'theme selection must be synced from storage by JS, not hard-coded');
});

test('preload script applies interface, wallpaper and theme-color before the first paint', () => {
  const preload = head.match(/<script>[\s\S]*?cet6_interface_style[\s\S]*?<\/script>/);
  assert.ok(preload, 'missing the first-paint appearance preload script in <head>');
  const code = preload[0];
  assert.match(code, /localStorage\.getItem\('cet6_interface_style'\) === 'glass' \? 'glass' : 'classic'/);
  assert.match(code, /var wallpaperThemes = \['minimal', 'aurora', 'peach', 'night', 'water'\];/);
  assert.match(code, /localStorage\.getItem\('cet6_theme_' \+ savedInterface\)/,
    'the preload must read the theme key belonging to the stored interface');
  assert.match(code, /savedTheme = savedInterface === 'glass' \? 'aurora' : 'minimal';/,
    'invalid/missing themes fall back to the per-interface default');
  assert.match(code, /document\.documentElement\.dataset\.interface = savedInterface;/);
  assert.match(code, /document\.documentElement\.dataset\.wallpaper = savedTheme;/);
  for (const [theme, color] of Object.entries(themeColors)) {
    assert.ok(code.includes(`${theme}: '${color}'`), `preload theme-color map missing ${theme} ${color}`);
  }
  assert.match(code, /savedThemeColor\.setAttribute\('content', wallpaperColors\[savedTheme\] \|\| '#f8fafc'\)/);
  assert.match(code, /catch \(error\) \{[\s\S]*?dataset\.interface = 'classic';[\s\S]*?dataset\.wallpaper = 'minimal';/,
    'blocked localStorage must fall back to classic/minimal');

  assert.ok(head.indexOf('appearance.css') < head.indexOf('cet6_interface_style'),
    'the preload must run after the stylesheet link so the attributes land before first paint');
  assert.ok(source.indexOf('cet6_interface_style') < source.indexOf('<body>'));
  assert.match(head, /<meta name="theme-color" content="#f8fafc">/,
    'the static theme-color meta must exist for the preload to rewrite');
  assert.match(css, /html\[data-wallpaper="aurora"\] \{\s*--wallpaper-base:/,
    'theme variables must be readable before the interaction scripts run');
});

test('appearance.js exposes the full interface + theme API and remembers themes per interface', () => {
  assert.match(script, /var STORAGE_KEY = 'cet6_interface_style';/);
  assert.match(script, /var THEME_PREFIX = 'cet6_theme_';/);
  assert.match(script, /var STYLES = \[CLASSIC, GLASS\];/);
  assert.match(script, /var THEMES = \['minimal', 'aurora', 'peach', 'night', 'water'\];/);
  for (const theme of themeValues) assert.ok(script.includes(`${theme}: '${themeLabels[theme]}'`), `THEME_LABELS missing ${theme}`);
  assert.match(script, /var DEFAULT_THEMES = \{ classic: 'minimal', glass: 'aurora' \};/);
  for (const color of Object.values(themeColors)) assert.ok(script.includes(`'${color}'`), `THEME_COLORS missing ${color}`);

  assert.match(script, /function themeKey\(style\) \{\s*return THEME_PREFIX \+ normalize\(style\);/);
  assert.match(script, /function normalizeTheme\(theme, style\) \{\s*if \(THEMES\.indexOf\(theme\) !== -1\) return theme;\s*return DEFAULT_THEMES\[normalize\(style\)\];/);
  assert.match(script, /function readStoredTheme\(style\) \{[\s\S]*?localStorage\.getItem\(themeKey\(normalized\)\)[\s\S]*?normalizeTheme\(stored, normalized\)/);
  assert.match(script, /function writeStoredTheme\(style, theme\) \{[\s\S]*?localStorage\.setItem\(themeKey\(style\), theme\);/);
  assert.match(script, /root\.setAttribute\('data-wallpaper', currentTheme\);/,
    'the theme must be exposed through html[data-wallpaper]');
  assert.match(script, /meta\.setAttribute\('content', THEME_COLORS\[currentTheme\] \|\| '#f8fafc'\);/);

  // Switching interface applies that interface's remembered theme.
  assert.match(script, /function paint\(style, themeOverride\) \{[\s\S]*?root\.setAttribute\('data-interface', currentStyle\);[\s\S]*?applyTheme\([^;]*readStoredTheme\(currentStyle\)/);
  // Switching theme writes the key for the current interface only.
  assert.match(script, /function applyThemeOption\(theme, options\) \{[\s\S]*?writeStoredTheme\(currentStyle, next\)/,
    'theme changes must be stored under the current interface key');
  assert.match(script, /function readStoredStyle\(\) \{[\s\S]*?localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(script, /function writeStoredStyle\(style\) \{[\s\S]*?localStorage\.setItem\(STORAGE_KEY, style\);/);
  assert.match(script, /saved = writeStoredStyle\(next\);/);
  assert.match(script, /saved = writeStoredTheme\(currentStyle, next\);/);
  assert.match(script, /浏览器未允许保存设置/);

  assert.match(script, /window\.Appearance = Object\.freeze\(\{/);
  for (const key of ['KEY: STORAGE_KEY', 'THEME_PREFIX: THEME_PREFIX', 'STYLES: STYLES.slice()', 'THEMES: THEMES.slice()',
    'THEME_LABELS: Object.freeze', 'DEFAULT_THEMES: Object.freeze', 'get: getStyle', 'set: applyStyle',
    'getTheme: getTheme', 'setTheme: applyThemeOption', 'openSettings: openSettings']) {
    assert.ok(script.includes(key), `window.Appearance missing ${key}`);
  }
});

test('settings, storage events and focus handling stay in sync for both control groups', () => {
  assert.match(script, /function syncControls\(\) \{\s*radioInputs\('appearanceStyle'\)[\s\S]*?radioInputs\('wallpaperTheme'\)/);
  assert.match(script, /option\.classList\.toggle\('is-selected', selected\);/);
  assert.match(script, /radioInputs\('appearanceStyle'\)\.forEach\(function \(radio\) \{[\s\S]*?addEventListener\('change'/);
  assert.match(script, /radioInputs\('wallpaperTheme'\)\.forEach\(function \(radio\) \{[\s\S]*?addEventListener\('change'/);
  assert.match(script, /applyThemeOption\(radio\.value, \{ announce: true \}\)/);
  assert.match(script, /applyStyle\(radio\.value, \{ announce: true \}\)/);

  // Cross-tab sync reacts to the interface key, any theme key, and a full site-data wipe (key === null).
  assert.match(script, /if \(event\.key !== null && event\.key !== STORAGE_KEY && event\.key\.indexOf\(THEME_PREFIX\) !== 0\) return;/);
  assert.match(script, /window\.addEventListener\('storage', function \(event\) \{[\s\S]*?paint\(readStoredStyle\(\)\);/);

  // Opening focuses the checked interface radio; closing (MutationObserver on the overlay style) restores the gear.
  assert.match(script, /var selected = radioInputs\('appearanceStyle'\)\.filter\(function \(radio\) \{ return radio\.checked; \}\)\[0\];/);
  assert.match(script, /selected\.focus\(\{ preventScroll: true \}\)/);
  assert.match(script, /new window\.MutationObserver\(function \(\) \{[\s\S]*?overlay\.style\.display !== 'none'\) return;[\s\S]*?trigger\.focus\(\{ preventScroll: true \}\)/,
    'closing the settings panel must return focus to the gear');
  assert.match(script, /document\.readyState === 'loading'/);
  assert.match(script, /paint\(readStoredStyle\(\)\);/);
});

test('background layer is wallpaper-driven and contains the aurora, water and noise layers', () => {
  const backdropMarkup = body.match(/<div class="appearance-backdrop" id="appearanceBackdrop" aria-hidden="true">([\s\S]*?)<\/div>/);
  assert.ok(backdropMarkup, 'missing decorative backdrop markup');
  const auroraLayers = [...backdropMarkup[1].matchAll(/<span class="appearance-aurora [^"]+"><\/span>/g)];
  assert.equal(auroraLayers.length, 4, 'four drifting aurora blobs are expected');
  for (const name of ['aurora-blue', 'aurora-violet', 'aurora-teal', 'aurora-rose']) {
    assert.match(backdropMarkup[1], new RegExp(`appearance-aurora ${name}`), `missing ${name} layer`);
  }
  assert.match(backdropMarkup[1], /<span class="appearance-water"><\/span>/);
  assert.match(backdropMarkup[1], /<span class="appearance-noise"><\/span>/);

  assert.match(css, /\.appearance-backdrop \{ display: none; \}/,
    'minimal wallpaper must keep the decorative layer hidden by default');
  const backdrop = ruleBody(/^html\[data-wallpaper\]:not\(\[data-wallpaper="minimal"\]\) \.appearance-backdrop$/);
  assert.match(backdrop, /display: block;/);
  assert.match(backdrop, /position: fixed;/);
  assert.match(backdrop, /inset: 0;/);
  assert.match(backdrop, /z-index: -1;/);
  assert.match(backdrop, /overflow: hidden;/);
  assert.match(backdrop, /pointer-events: none;/);
  assert.match(backdrop, /background: var\(--wallpaper-base, transparent\);/);
  assert.match(ruleBody(/^html\[data-wallpaper\]:not\(\[data-wallpaper="minimal"\]\) body$/), /background: transparent;/);

  // Theme palettes: aurora/peach/night share the --aurora-a..d colour tokens.
  for (const theme of ['aurora', 'peach', 'night']) {
    const palette = ruleBody(new RegExp(`^html\\[data-wallpaper="${theme}"\\]$`));
    assert.match(palette, /--wallpaper-base:/, `${theme} needs a base gradient`);
    for (const token of ['a', 'b', 'c', 'd']) {
      assert.match(palette, new RegExp(`--aurora-${token}:`), `${theme} missing --aurora-${token}`);
    }
  }
  assert.match(ruleBody(/^html\[data-wallpaper="water"\]$/), /--wallpaper-base: linear-gradient\(160deg, #a7e6df 0%, #8fd8d2 42%, #6fc9c4 100%\);/);
  assert.match(css, /rgba\(var\(--aurora-a\), 0\.7\)/, 'aurora blobs must consume the palette variables');
  assert.match(css, /rgba\(var\(--aurora-d\), 0\.44\)/);

  // Minimal glass keeps an opaque fallback on the root element (body stays transparent so the
  // negative z-index glass ::before layer is not covered by an opaque body background);
  // night glass keeps light text on a whiter tint.
  assert.match(ruleBody(/^html\[data-interface="glass"\]\[data-wallpaper="minimal"\]$/), /background-color: #eef0f8;/);
  assert.match(ruleBody(/^html\[data-interface="glass"\] body$/), /background: transparent;/);
  const nightGlass = ruleBody(/^html\[data-interface="glass"\]\[data-wallpaper="night"\]$/);
  assert.match(nightGlass, /--glass-tint-solid: rgba\(255, 255, 255, 0\.42\);/);
  assert.match(nightGlass, /--text: #171126;/);

  // Water theme uses the caustics image layer and hides the aurora blobs; other themes hide the water layer.
  assert.match(css, /html\[data-wallpaper="water"\] \.appearance-water \{[\s\S]*?url\("assets\/water-caustics\.webp"\)[\s\S]*?animation: glass-water-drift 80s ease-in-out infinite alternate;/);
  assert.match(css, /html\[data-wallpaper="water"\] \.appearance-backdrop \.appearance-aurora \{ display: none; \}/);
  assert.match(css, /html\[data-wallpaper\]:not\(\[data-wallpaper="water"\]\) \.appearance-water \{ display: none; \}/);
  assert.match(css, /\.theme-swatch\.is-water \{\s*background-image: url\("assets\/water-caustics\.webp"\);/,
    'the water theme swatch should preview the caustics texture');
  assert.match(css, /@keyframes glass-aurora-drift \{/);
  assert.match(css, /@keyframes glass-water-drift \{/);
  assert.match(ruleBody(/^html\[data-wallpaper\]:not\(\[data-wallpaper="minimal"\]\) \.appearance-aurora$/), /animation: glass-aurora-drift 52s ease-in-out infinite alternate;/);
});

test('night wallpaper overrides light page text and keeps cards readable', () => {
  const nightTextRules = [
    [/^html\[data-wallpaper="night"\] \.header h1$/, /color: #eef2ff;/],
    [/^html\[data-wallpaper="night"\] \.header p$/, /color: rgba\(226, 232, 255, 0\.8\);/],
    [/^html\[data-wallpaper="night"\] \.footer$/, /color: rgba\(226, 232, 255, 0\.72\);/],
    [/^html\[data-wallpaper="night"\] \.footer-project-link$/, /color: #c7d2fe;/],
    [/^html\[data-wallpaper="night"\] \.key-guide$/, /color: rgba\(226, 232, 255, 0\.72\);/],
    [/^html\[data-wallpaper="night"\] \.key-status$/, /color: rgba\(226, 232, 255, 0\.82\);/]
  ];
  for (const [selector, declaration] of nightTextRules) {
    assert.match(ruleBody(selector), declaration, `night wallpaper must lighten page text for ${selector}`);
  }
  assert.match(ruleBody(/^html\[data-wallpaper="night"\] \.key-area input$/), /color: #eef2ff;/,
    'the API key input must stay readable on the dark wallpaper');
  assert.match(css, /html\[data-wallpaper="night"\] \.settings-entry,[\s\S]*?color: #dbeafe;/,
    'floating controls need a light icon on the dark wallpaper');
});

test('glass architecture puts the frosted layer behind content and disperses edges on ::after', () => {
  const surfaces = ruleBody(/^html\[data-interface="glass"\] \.card, html\[data-interface="glass"\] \.modal-card, html\[data-interface="glass"\] \.btn-fav-nav$/);
  assert.match(surfaces, /background: transparent;/);
  assert.match(surfaces, /border: 1px solid transparent;/);
  assert.match(surfaces, /box-shadow: var\(--glass-shadow\);/,
    'the outer drop shadow stays on the element so the refraction filter cannot ghost it');
  assert.match(surfaces, /backdrop-filter: none;/);
  assert.match(surfaces, /-webkit-backdrop-filter: none;/,
    'the big surfaces themselves must not blur; the ::before layer does it');
  // Positioned surfaces exclude .study-toolbox so its sticky behaviour survives.
  const positioned = ruleBody(/^html\[data-interface="glass"\] \.card:not\(\.study-toolbox\), html\[data-interface="glass"\] \.modal-card, html\[data-interface="glass"\] \.btn-fav-nav$/);
  assert.match(positioned, /position: relative;/);
  assert.doesNotMatch(surfaces, /position: relative;/, 'a generic .card position rule would break the sticky toolbox');

  const glassLayer = ruleBody(/^html\[data-interface="glass"\] \.card::before, html\[data-interface="glass"\] \.modal-card::before, html\[data-interface="glass"\] \.btn-fav-nav::before$/);
  assert.match(glassLayer, /content: "";/);
  assert.match(glassLayer, /position: absolute;/);
  assert.match(glassLayer, /inset: 0;/);
  assert.match(glassLayer, /z-index: -1;/, 'the glass layer must paint below the card content');
  assert.match(glassLayer, /border-radius: inherit;/);
  assert.match(glassLayer, /pointer-events: none;/);
  assert.match(glassLayer, /background-color: var\(--glass-tint-solid\);/);
  assert.match(glassLayer, /background-image: var\(--glass-tint\);/);
  assert.match(glassLayer, /border: 1px solid var\(--glass-rim\);/);
  assert.match(glassLayer, /box-shadow:[\s\S]*?var\(--glass-edge\)/);
  assert.match(glassLayer, /backdrop-filter: var\(--glass-blur\);/);
  assert.match(glassLayer, /-webkit-backdrop-filter: var\(--glass-blur\);/);
  assert.match(ruleBody(/^html\[data-interface="glass"\] \.modal-card$/), /box-shadow: 0 30px 80px -30px/,
    'the modal card keeps its deep drop shadow on the element itself');
  assert.match(ruleBody(/^html\[data-interface="glass"\] \.modal-card::before$/), /inset 0 20px 36px -28px/,
    'the modal glass layer keeps its inner highlight');

  // Edge dispersion ring moved to ::after.
  const ring = ruleBody(/^html\[data-interface="glass"\] \.card::after, html\[data-interface="glass"\] \.modal-card::after, html\[data-interface="glass"\] \.btn-fav-nav::after$/);
  assert.match(ring, /content: "";/);
  assert.match(ring, /position: absolute;/);
  assert.match(ring, /border-radius: inherit;/);
  assert.match(ring, /padding: 1px;/);
  assert.match(ring, /pointer-events: none;/);
  assert.match(ring, /background: conic-gradient\(from 130deg at 50% 50%/);
  assert.match(ring, /-webkit-mask: linear-gradient\(#fff 0 0\) content-box, linear-gradient\(#fff 0 0\);/);
  assert.match(ring, /mask-composite: exclude;/);
  assert.doesNotMatch(glassLayer, /mask-composite: exclude;/,
    'the glass layer must not carry the dispersion mask');

  // Small surfaces keep a direct frosted layer.
  const small = ruleBody(/^html\[data-interface="glass"\] \.page-actions \.btn-sm, html\[data-interface="glass"\] \.page-jump-btn, html\[data-interface="glass"\] \.unfavorited-jump-btn, html\[data-interface="glass"\] \.settings-entry, html\[data-interface="glass"\] \.toast$/);
  assert.match(small, /backdrop-filter: var\(--glass-blur\);/);
  assert.match(small, /background-color: rgba\(255, 255, 255, 0\.38\)/);
  assert.match(ruleBody(/^html\[data-interface="glass"\] \.card$/), /border-radius: var\(--radius\);/);
  assert.doesNotMatch(ruleBody(/^html\[data-interface="glass"\] \.card$/), /padding:/,
    'the glass .card rule must not clobber component paddings such as .word-search-wrapper padding-bottom:50px');
  assert.match(source, /\.word-search-wrapper \{\s*position: relative; padding-bottom: 50px;/,
    'the word-search card still reserves 50px for its floating +/- buttons');
});

test('refraction hook and small-screen fallbacks are wired without a hard dependency', () => {
  // The liquid refraction is a water-wallpaper enhancement only (it needs texture to bend).
  assert.match(css, /html\.glass-refraction\[data-interface="glass"\]\[data-wallpaper="water"\] \{\s*--glass-blur: blur\(11px\) saturate\(200%\) brightness\(1\.05\);/);
  const hook = ruleBody(/^html\.glass-refraction\[data-interface="glass"\]\[data-wallpaper="water"\] \.card::before, html\.glass-refraction\[data-interface="glass"\]\[data-wallpaper="water"\] \.modal-card::before, html\.glass-refraction\[data-interface="glass"\]\[data-wallpaper="water"\] \.btn-fav-nav::before$/);
  assert.match(hook, /filter: url\(#cet6-liquid-refract\);/);
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?html\.glass-refraction\[data-interface="glass"\]\[data-wallpaper="water"\] \.card::before,[\s\S]*?filter: none;/,
    'the SVG displacement filter must be disabled on small screens');
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?html\[data-wallpaper="water"\] \.appearance-water \{ animation: none; \}/);
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*?--glass-blur: blur\(13px\) saturate\(195%\) brightness\(1\.05\);/);

  // The optional enhancement module must be an additive script, guarded at call time.
  assert.ok(fs.existsSync('glass-refraction.js'), 'glass-refraction.js should ship with the feature');
  const refractionIndex = source.indexOf('<script src="glass-refraction.js"></script>');
  const appearanceIndex = source.indexOf('<script src="appearance.js"></script>');
  assert.ok(refractionIndex > appearanceIndex, 'the refraction module loads after the appearance controller');
  assert.match(source, /if \(window\.LiquidGlass && LiquidGlass\.supported\) \{[\s\S]*?LiquidGlass\.configure\(\{ scale: 52, band: 34 \}\);/,
    'the page only configures the module when the browser supports it');
  assert.match(fs.readFileSync('glass-refraction.js', 'utf8'), /window\.LiquidGlass = /,
    'the module must expose window.LiquidGlass');
});

test('degrades for reduced motion, reduced transparency and missing backdrop-filter', () => {
  const reducedMotion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reducedMotion, /html\[data-wallpaper\] \.appearance-aurora,\s*html\[data-wallpaper\] \.appearance-water \{\s*animation: none !important;\s*transform: none !important;/);
  assert.match(reducedMotion, /html\[data-interface="glass"\] \.card,\s*html\[data-interface="glass"\] \.appearance-option,\s*html\[data-interface="glass"\] \.theme-option \{\s*transition: none !important;\s*animation: none !important;/);
  assert.match(reducedMotion, /html\[data-interface="glass"\] \.card:hover \{ translate: none; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*html\[data-interface="glass"\] \.card \{\s*animation: glass-surface-in 520ms var\(--motion-spring\);/);

  const reducedTransparency = css.slice(css.indexOf('@media (prefers-reduced-transparency: reduce)'));
  assert.match(reducedTransparency, /--glass-tint-solid: rgba\(255, 255, 255, 0\.9\);/);
  assert.match(reducedTransparency, /html\[data-wallpaper\]:not\(\[data-wallpaper="minimal"\]\) \.appearance-backdrop \{ display: none; \}/);
  assert.match(reducedTransparency, /html\[data-interface="glass"\] \.card::before,[\s\S]*?backdrop-filter: none;[\s\S]*?filter: none;/);
  assert.match(reducedTransparency, /html\[data-interface="glass"\] \.modal-overlay \{[\s\S]*?backdrop-filter: none;/);
  assert.match(reducedTransparency, /html\[data-interface="glass"\] \.toast \{[\s\S]*?backdrop-filter: none;/);

  const fallback = css.slice(css.indexOf('@supports not'));
  assert.match(fallback, /@supports not \(\(backdrop-filter: blur\(2px\)\) or \(-webkit-backdrop-filter: blur\(2px\)\)\)/);
  assert.match(fallback, /--glass-tint-solid: rgba\(255, 255, 255, 0\.88\);/);
  assert.match(fallback, /--card-bg: rgba\(255, 255, 255, 0\.86\);/);
  assert.match(fallback, /html\[data-interface="glass"\] \.card::before,[\s\S]*?backdrop-filter: none;/);
  assert.match(fallback, /html\[data-interface="glass"\] \.modal-overlay \{[\s\S]*?background: rgba\(30, 17, 58, 0\.55\);/);
});

test('keeps appearance scoped: wallpaper rules are theme-scoped, blur rules are glass-scoped', () => {
  assert.doesNotMatch(css, /\[data-interface="classic"\]/, 'classic must rely on the absence of overrides');
  for (const rule of cssLeafRules.filter(block => /backdrop-filter\s*:/.test(block.body))) {
    assert.match(rule.selector, /html\[data-interface="glass"\]/,
      `backdrop-filter must never leak into the classic interface: ${rule.selector}`);
  }
  const layerRules = cssLeafRules.filter(block => /\.appearance-(?:aurora|water|noise)\b/.test(block.selector));
  assert.ok(layerRules.length >= 5);
  for (const rule of layerRules) {
    assert.match(rule.selector, /html\[data-wallpaper/,
      `decorative background rules must be wallpaper-scoped: ${rule.selector}`);
  }
  // Night wallpaper lightens page chrome in both interfaces (not glass-only), and must be declared
  // after the glass chrome rules so equal-specificity rules resolve to the light colours.
  assert.match(ruleBody(/^html\[data-wallpaper="night"\] \.header h1$/), /color:/);
  assert.doesNotMatch(ruleBody(/^html\[data-wallpaper="night"\] \.header h1$/), /data-interface/);
  const glassFooterIndex = css.indexOf('html[data-interface="glass"] .footer {');
  const nightFooterIndex = css.indexOf('html[data-wallpaper="night"] .footer {');
  assert.ok(glassFooterIndex > -1 && nightFooterIndex > glassFooterIndex,
    'night light-text overrides must come after the glass chrome rules (equal specificity, source order wins)');
  const nightGear = ruleBody(/^html\[data-wallpaper="night"\] \.settings-entry, html\[data-wallpaper="night"\] \.page-jump-btn, html\[data-wallpaper="night"\] \.unfavorited-jump-btn$/);
  assert.match(nightGear, /color: #dbeafe;/, 'floating controls get a light icon on the night wallpaper');
  assert.ok(css.indexOf('html[data-wallpaper="night"] .settings-entry') > css.lastIndexOf('html[data-interface="glass"] .settings-entry'),
    'the night gear colour must win over the glass settings-entry colour');
});

test('keeps static ids unique and loads appearance assets in a safe order', () => {
  assert.ok(fs.existsSync('appearance.css'));
  assert.ok(fs.existsSync('appearance.js'));
  const ids = [...staticMarkup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, [], `duplicate static ids: ${duplicates.join(', ')}`);

  const htmlTag = source.match(/<html[^>]*>/)[0];
  assert.doesNotMatch(htmlTag, /data-interface|data-wallpaper/,
    'the attributes are written by the preload script, never hard-coded in markup');
  assert.ok(head.indexOf('study-tools.css') < head.indexOf('appearance.css'),
    'appearance.css must win the cascade over base component styles');
  const scriptIndex = source.indexOf('<script src="appearance.js"></script>');
  const settingsIndex = source.indexOf('id="modalSettings"');
  const mainScriptIndex = source.indexOf('// ==================== 配置 ====================');
  assert.ok(scriptIndex > -1);
  assert.ok(settingsIndex > -1 && settingsIndex < scriptIndex,
    'appearance.js must load after the settings markup it wires up');
  assert.ok(mainScriptIndex > scriptIndex,
    'appearance.js must load before the main inline script');
  assert.ok(source.indexOf('<meta name="theme-color"') < source.indexOf('appearance.css'));
  assert.ok(css.includes('assets/water-caustics.webp'), 'the water wallpaper image reference must exist in CSS');
});
