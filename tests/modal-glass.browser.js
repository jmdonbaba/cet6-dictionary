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

    // ---------------------------------------------------------- focus glass
    const focusStyle = async selector => page.locator(selector).first().evaluate(element => {
      const style = getComputedStyle(element);
      return {
        border: style.borderTopColor,
        outline: style.outlineStyle,
        background: style.backgroundColor,
        backdrop: style.backdropFilter,
        focused: document.activeElement === element
      };
    });
    const input = page.locator('.word-search-input').first();
    await input.focus();
    await page.waitForTimeout(250);
    const inputFocus = await focusStyle('.word-search-input');
    assert.equal(inputFocus.focused, true);
    assert.equal(inputFocus.border, 'rgba(0, 0, 0, 0)', 'focused search input must not draw a border');
    assert.equal(inputFocus.outline, 'none');
    assert.match(inputFocus.background, /rgba\(255, 255, 255, 0\.08\)/, 'card search keeps a clear glass fill');
    assert.equal(inputFocus.backdrop, 'none', 'card search does not frost the card behind it');
    await page.screenshot({ path: path.join(OUT, 'search-focus.png') });

    // The API-key field is another search box; focus renders the same glass.
    const keyInput = page.locator('.key-area input').first();
    await keyInput.focus();
    await page.waitForTimeout(250);
    const keyFocus = await focusStyle('.key-area input');
    assert.equal(keyFocus.border, 'rgba(0, 0, 0, 0)', 'focusing another search box must not add a border');
    assert.match(keyFocus.background, /rgba\(255, 255, 255, 0\.16\)/);
    assert.match(keyFocus.backdrop, /blur\(8px\)/);

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
      const modalAfter = await page.evaluate(selector => {
        const style = getComputedStyle(document.querySelector(selector), '::after');
        return { filter: style.filter, opacity: style.opacity };
      }, cardSelector);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      return { immediate, stable, styles, innerOptics, modalAfter };
    };

    const settings = await openModal('#btnOpenSettings', '#modalSettings');
    assert.equal(settings.immediate.active, true);
    assert.equal(settings.immediate.filter, 'none', 'the card renderer supplies real refraction without a second SVG pass');
    assert.equal(settings.immediate.animation, 'none', 'glass modals must not animate opacity over their refraction');
    assert.equal(settings.immediate.backdrop, 'none', 'modal glass stays as clear as page cards');
    assert.equal(settings.modalAfter.filter, 'none', 'highlights are not a fake refractive backdrop');
    assert.equal(settings.styles.innerBackdrop, 'none');
    assert.equal(settings.styles.innerBackground, 'rgba(0, 0, 0, 0)');
    assert.ok(settings.stable, 'settings modal must keep the same filter and run no animations after painting');
    const innerOptics = settings.innerOptics;

    const vocab = await openModal('#btnOpenVocabFav', '#modalVocabFav');
    assert.equal(vocab.immediate.filter, 'none');
    assert.equal(vocab.immediate.animation, 'none');

    const restore = await openModal('#btnRestorePage', '#modalRestorePage');
    assert.equal(restore.immediate.filter, 'none');
    assert.equal(restore.immediate.animation, 'none');

    assert.deepEqual(errors, []);
    console.log('PASS: clear card search, borderless frosted modal fields, stable first-frame modal optics; screenshots in ' + OUT);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
