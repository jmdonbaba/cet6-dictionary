// Real-browser regression: focused search fields boost the card lens instead of
// drawing a border, and modals appear with their final native refraction in the
// first painted frame (no flash / late colour shift). Inner rows are glass too.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.gstack', 'modal-glass');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('file:///' + ROOT.replaceAll('\\', '/') + '/index.html');
    await page.evaluate(() => { Appearance.set('glass'); Appearance.setTheme('aurora'); LiquidGlass.enable({ persist: false }); });
    await page.waitForFunction(() => window.GlassRenderer && GlassRenderer.getState().active, null, { timeout: 10000 });
    await page.waitForTimeout(700);

    // ---------------------------------------------------------- focus lens
    const input = page.locator('.word-search-input').first();
    const canvasRegion = (selector, inset) => page.evaluate(([name, pad]) => new Promise(resolve => {
      GlassRenderer.render();
      requestAnimationFrame(() => {
        const source = document.querySelector('.glass-wallpaper-canvas');
        const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
        copy.getContext('2d').drawImage(source, 0, 0);
        const box = source.getBoundingClientRect();
        const r = document.querySelector(name).getBoundingClientRect();
        const sx = source.width / box.width, sy = source.height / box.height;
        const x = Math.max(0, Math.round((r.left - box.left + pad) * sx));
        const y = Math.max(0, Math.round((r.top - box.top + pad) * sy));
        const w = Math.max(1, Math.round((r.width - pad * 2) * sx));
        const h = Math.max(1, Math.round((r.height - pad * 2) * sy));
        resolve(Array.from(copy.getContext('2d').getImageData(x, y, w, h).data));
      });
    }), [selector, inset || 0]);
    const canvasRect = (selector, offset) => page.evaluate(([name, dx, dy, dw, dh]) => new Promise(resolve => {
      GlassRenderer.render();
      requestAnimationFrame(() => {
        const source = document.querySelector('.glass-wallpaper-canvas');
        const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
        copy.getContext('2d').drawImage(source, 0, 0);
        const box = source.getBoundingClientRect();
        const r = document.querySelector(name).getBoundingClientRect();
        const sx = source.width / box.width, sy = source.height / box.height;
        const x = Math.max(0, Math.round((r.left - box.left + dx) * sx));
        const y = Math.max(0, Math.round((r.top - box.top + dy) * sy));
        resolve(Array.from(copy.getContext('2d').getImageData(x, y,
          Math.max(1, Math.round(dw * sx)), Math.max(1, Math.round(dh * sy))).data));
      });
    }), [selector, offset[0], offset[1], offset[2], offset[3]]);
    const mean = (a, b) => a.reduce((sum, value, index) => index % 4 === 3 ? sum : sum + Math.abs(value - b[index]), 0) / (a.length * .75);
    const drawsBeforeFocus = await page.evaluate(() => GlassRenderer.getState().draws);
    const unfocused = await canvasRegion('.word-search-input');
    const cardCornerBefore = await canvasRect('.word-search-wrapper', [8, 4, 120, 12]);
    await input.focus();
    await page.waitForTimeout(250);
    const focused = await canvasRegion('.word-search-input');
    const cardCornerAfter = await canvasRect('.word-search-wrapper', [8, 4, 120, 12]);
    const focusStyles = await input.evaluate(element => {
      const style = getComputedStyle(element);
      return { border: style.borderTopColor, outline: style.outlineStyle, shadow: style.boxShadow, focused: document.activeElement === element };
    });
    assert.equal(focusStyles.focused, true);
    assert.equal(focusStyles.border, 'rgba(0, 0, 0, 0)', 'focused search input must not draw a border');
    assert.equal(focusStyles.outline, 'none');
    assert.equal(focusStyles.shadow, 'none');
    assert.ok(await page.evaluate(draws => GlassRenderer.getState().draws > draws, drawsBeforeFocus),
      'focusing the search input must request a lens redraw');
    const inputBoost = mean(unfocused, focused);
    assert.ok(inputBoost > .3, `focus must visibly strengthen the input's own lens, mean=${inputBoost.toFixed(2)}`);
    const cardRegionBoost = mean(cardCornerBefore, cardCornerAfter);
    assert.ok(cardRegionBoost < .2,
      `focus must not warp the whole card, card-corner mean=${cardRegionBoost.toFixed(2)}`);
    await page.screenshot({ path: path.join(OUT, 'search-focus.png') });
    // The API-key field is another search box; it gets the same focus lens.
    const keyInput = page.locator('.key-area input').first();
    const keyUnfocused = await canvasRegion('.key-area input');
    await keyInput.focus();
    await page.waitForTimeout(250);
    const keyFocused = await canvasRegion('.key-area input');
    assert.ok(mean(keyUnfocused, keyFocused) > .25, 'every search box must boost its own lens on focus');
    const keyStyle = await keyInput.evaluate(element => getComputedStyle(element).borderTopColor);
    assert.equal(keyStyle, 'rgba(0, 0, 0, 0)', 'focusing another search box must not add a border');
    await page.locator('.word-search-input').first().focus();

    // ------------------------------------------------------- modal opening
    const openModal = async (trigger, cardSelector) => {
      await page.locator(trigger).click();
      const immediate = await page.evaluate(selector => {
        const card = document.querySelector(selector);
        const before = getComputedStyle(card, '::before');
        return {
          active: card.classList.contains('active'),
          filter: before.filter,
          animation: getComputedStyle(card).animationName,
          backdrop: before.backdropFilter
        };
      }, cardSelector);
      const styleSnapshot = () => page.evaluate(selector => {
        const card = document.querySelector(selector);
        return {
          filter: getComputedStyle(card, '::before').filter,
          animation: getComputedStyle(card).animationName,
          runningAnimations: card.getAnimations({ subtree: true }).length
        };
      }, cardSelector);
      await page.waitForTimeout(450);
      const earlyStyles = await styleSnapshot();
      await page.waitForTimeout(250);
      const lateStyles = await styleSnapshot();
      const stable = JSON.stringify(earlyStyles) === JSON.stringify(lateStyles) && lateStyles.runningAnimations === 0;
      await page.screenshot({ path: path.join(OUT, cardSelector.replace('#', '') + '.png') });
      const styles = await page.evaluate(selector => {
        const option = document.querySelector(selector + ' .appearance-option, ' + selector + ' .favorite-study-tabs');
        const style = option ? getComputedStyle(option) : null;
        return {
          innerBackdrop: style ? style.backdropFilter : null,
          innerBackground: style ? style.backgroundColor : null
        };
      }, cardSelector);
      const innerOptics = await page.evaluate(selector => {
        const option = document.querySelector(selector + ' .appearance-option');
        if (!option) return null;
        return {
          classes: option.className,
          filterVar: option.style.getPropertyValue('--glass-filter'),
          beforeFilter: getComputedStyle(option, '::before').filter,
          beforeBlur: getComputedStyle(option, '::before').backdropFilter,
          afterFilter: getComputedStyle(option, '::after').filter,
          afterOpacity: getComputedStyle(option, '::after').opacity
        };
      }, cardSelector);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      return { immediate, stable, styles, innerOptics };
    };

    const settings = await openModal('#btnOpenSettings', '#modalSettings');
    assert.equal(settings.immediate.active, true);
    assert.match(settings.immediate.filter, /url\("?#?cet6-liquid-refract/, 'modal filter must exist in the same task as the open');
    assert.equal(settings.immediate.animation, 'none', 'glass modals must not animate opacity over their refraction');
    assert.match(settings.styles.innerBackdrop, /blur\(16px\) saturate\(1\.4\)/);
    assert.match(settings.styles.innerBackground, /rgba\(255, 255, 255, 0\.1\)/);
    assert.ok(settings.stable, 'settings modal must keep the same filter and run no animations after painting');
    const innerOptics = settings.innerOptics;

    const vocab = await openModal('#btnOpenVocabFav', '#modalVocabFav');
    assert.match(vocab.immediate.filter, /url\("?#?cet6-liquid-refract/);
    assert.equal(vocab.immediate.animation, 'none');

    const restore = await openModal('#btnRestorePage', '#modalRestorePage');
    assert.match(restore.immediate.filter, /url\("?#?cet6-liquid-refract/);
    assert.equal(restore.immediate.animation, 'none');

    assert.deepEqual(errors, []);
    console.log('PASS: focus drops the border for a stronger card lens, modals open already-refracted and stay stable; screenshots in ' + OUT);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
