// Real rendering regression: run with PLAYWRIGHT_MODULE pointing to Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file:///' + ROOT.replaceAll('\\', '/') + '/index.html');
    await page.evaluate(() => { Appearance.set('glass'); Appearance.setTheme('aurora'); LiquidGlass.enable({ persist: false }); });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.waitForTimeout(500);
    const styles = () => page.locator('.card').evaluateAll(cards => cards.map(card => ({
      width: card.clientWidth, filter: getComputedStyle(card, '::before').filter,
      border: getComputedStyle(card, '::before').borderTopStyle,
      textFilter: getComputedStyle(card).filter
    })));
    let surfaces = await styles();
    assert.ok(surfaces.some(s => s.filter !== 'none'), 'default aurora must visibly refract');
    assert.ok(surfaces.every(s => s.border === 'none'), 'glass surfaces have no drawn border');
    assert.ok(surfaces.every(s => s.textFilter === 'none'), 'text stays outside the filter');
    await page.evaluate(() => {
      const card = document.createElement('div');
      card.className = 'card liquid-test-card';
      card.style.cssText = 'position:fixed;left:400px;top:430px;width:460px;height:240px;z-index:4';
      card.textContent = 'Clear glass · 清晰文字';
      document.body.append(card);
    });
    await page.waitForTimeout(500);
    const ownFilter = await page.locator('.liquid-test-card').evaluate(c => getComputedStyle(c, '::before').filter);
    assert.notEqual(ownFilter, 'none', 'dynamically inserted cards get refraction');
    const otherFilter = await page.locator('.card').first().evaluate(c => getComputedStyle(c, '::before').filter);
    assert.notEqual(ownFilter, otherFilter, 'different sizes use individually calibrated maps');
    const mapOf = () => page.locator('.liquid-test-card').evaluate(c => {
      const id = c.style.getPropertyValue('--glass-filter').match(/#([^\)]+)/)[1];
      return document.getElementById(id).querySelector('feImage').getAttribute('href');
    });
    const originalMap = await mapOf();
    await page.locator('.liquid-test-card').evaluate(c => c.style.height = '260px');
    await page.waitForTimeout(350);
    assert.notEqual(await mapOf(), originalMap, 'resizing recalibrates the displacement map');
    await page.locator('.liquid-test-card').evaluate(c => c.style.height = '240px');
    await page.waitForTimeout(350);
    const dir = path.join(ROOT, '.gstack', 'liquid-glass');
    fs.mkdirSync(dir, { recursive: true });
    const on = await page.screenshot({ path: path.join(dir, 'aurora-on.png') });
    await page.evaluate(() => LiquidGlass.setIntensity(0, { persist: false }));
    const off = await page.screenshot({ path: path.join(dir, 'aurora-zero.png') });
    const difference = await page.evaluate(async ([a, b]) => {
      const pixels = async base64 => {
        const blob = await (await fetch('data:image/png;base64,' + base64)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(400, 430, 460, 240).data;
      };
      const x = await pixels(a), y = await pixels(b);
      let changed = 0;
      for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i]-y[i]) + Math.abs(x[i+1]-y[i+1]) + Math.abs(x[i+2]-y[i+2]) > 12) changed++;
      return changed / (x.length / 4);
    }, [on.toString('base64'), off.toString('base64')]);
    assert.ok(difference > 0.025, `refraction must change visible pixels, got ${difference}`);
    await page.evaluate(() => { document.querySelector('.liquid-test-card').remove(); LiquidGlass.setIntensity(1, { persist: false }); });
    await page.route('https://api.deepseek.com/**', route => route.fulfill({ json: {
      choices: [{ message: { content: JSON.stringify({ word: 'refraction', phonetic: '/rɪˈfrækʃən/', pos: 'n.',
        definitions: ['折射；光线穿过不同介质时传播方向发生偏转。'], forms: { inflections: [], derivatives: [] },
        sentences: [{ en: 'Refraction bends light as it passes through glass.', cn: '光线穿过玻璃时，折射使它改变方向。' }] }) } }]
    } }));
    await page.evaluate(async () => {
      localStorage.setItem('cet6_api_key', 'sk-test');
      initKey();
      const wrapper = document.querySelector('.word-search-wrapper');
      await searchWord('refraction', wrapper, getSearchMode(wrapper));
    });
    await page.locator('.word-header .word').waitFor();
    let sharedUI;
    for (const theme of ['aurora', 'water', 'night', 'peach', 'minimal']) {
      await page.evaluate(t => Appearance.setTheme(t), theme);
      await page.waitForTimeout(300);
      const ui = await page.evaluate(() => {
        const card = document.querySelector('.card');
        const style = getComputedStyle(card, '::before');
        return [style.backgroundColor, style.backdropFilter, style.borderStyle,
          getComputedStyle(card).color,
          getComputedStyle(document.querySelector('.header h1')).color,
          getComputedStyle(document.querySelector('.footer')).color,
          getComputedStyle(document.querySelector('#btnOpenSettings')).backgroundColor];
      });
      if (!sharedUI) sharedUI = ui;
      assert.deepEqual(ui, sharedUI, theme + ' changes only the background, not glass UI');
      await page.screenshot({ path: path.join(dir, theme + '-desktop.png') });
    }
    await page.locator('#btnOpenSettings').click();
    await page.waitForTimeout(350);
    assert.notEqual(await page.locator('#modalSettings').evaluate(c => getComputedStyle(c, '::before').filter), 'none',
      'opening a modal creates a size-calibrated glass layer');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => Appearance.setTheme('aurora'));
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.card').first().evaluate(c => getComputedStyle(c, '::before').filter), 'none');
    await page.screenshot({ path: path.join(dir, 'aurora-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => LiquidGlass.disable({ persist: false }));
    assert.equal(await page.locator('.card').first().evaluate(c => getComputedStyle(c, '::before').filter), 'none');
    assert.equal(await page.evaluate(() => LiquidGlass.getState().surfaces), 0, 'disabled glass releases per-surface filters');
    await page.evaluate(() => LiquidGlass.destroy());
    assert.equal(await page.locator('[data-glass-refraction-svg]').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS: borderless, calibrated dynamic surfaces, sharp text, pixel difference ${(difference*100).toFixed(1)}%, five themes, mobile fallback and cleanup`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
