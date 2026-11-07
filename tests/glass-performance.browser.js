// Performance invariants; frame timing is reported, not asserted across hardware.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file:///' + path.resolve(__dirname, '../index.html').replaceAll('\\', '/'));
    await page.evaluate(() => {
      const motionFor = GlassWallpaper.motionFor;
      GlassWallpaper.motionFor = theme => theme === 'minimal' ? null : motionFor(theme);
      Appearance.set('glass');
      Appearance.setTheme('minimal');
      LiquidGlass.enable({ persist: false });
    });
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.appearance-aurora').first().evaluate(e => getComputedStyle(e).animationName), 'none',
      'static wallpaper must not continuously invalidate every glass surface');
    const idleDraws = await page.evaluate(() => window.GlassRenderer && GlassRenderer.getState().draws);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.GlassRenderer && GlassRenderer.getState().draws), idleDraws,
      'idle glass must not keep issuing GPU draws');
    const result = await page.evaluate(async () => {
      let svgWrites = 0;
      const observer = new MutationObserver(records => svgWrites += records.length);
      const svg = document.querySelector('[data-glass-refraction-svg]');
      if (svg) observer.observe(svg, { attributes: true, childList: true, subtree: true });
      const card = document.querySelector('.word-search-wrapper');
      for (let i = 0; i < 8; i++) {
        card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 400 + i * 10, clientY: 300 }));
        window.dispatchEvent(new Event('scroll'));
        await new Promise(r => setTimeout(r, 40));
      }
      await new Promise(r => setTimeout(r, 300));
      observer.disconnect();
      return { svgWrites, state: LiquidGlass.getState() };
    });
    assert.equal(result.svgWrites, 0, 'unchanged scrolling and pointer movement must not rebuild filter graphs');
    const samples = [];
    for (const iface of ['classic', 'glass']) {
      await page.evaluate(i => { Appearance.set(i); Appearance.setTheme(i === 'classic' ? 'minimal' : 'aurora'); }, iface);
      await page.waitForTimeout(500);
      const sample = await page.evaluate(async () => {
        const gaps = []; let previous, start;
        await new Promise(resolve => {
          function tick(now) {
            if (!start) start = now;
            if (previous) gaps.push(now - previous);
            previous = now;
            document.querySelector('.word-search-wrapper').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 400 + (now % 500), clientY: 300 }));
            if (now - start < 1200) requestAnimationFrame(tick); else resolve();
          }
          requestAnimationFrame(tick);
        });
        gaps.sort((a, b) => a - b);
        return { frames: gaps.length, p95ms: +gaps[Math.floor(gaps.length * .95)].toFixed(1) };
      });
      samples.push({ iface, ...sample });
    }
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => Appearance.setTheme('minimal'));
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    assert.equal(await page.locator('#appearanceBackdrop').evaluate(e => getComputedStyle(e).display), 'none');
    assert.equal(await page.locator('.card').first().evaluate(e => getComputedStyle(e, '::before').backgroundColor), 'rgba(255, 255, 255, 0.9)');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await page.waitForTimeout(100);
    if (await page.evaluate(() => LiquidGlass.getState().renderer === 'webgl')) {
      await page.evaluate(() => document.querySelector('.glass-wallpaper-canvas').getContext('webgl').getExtension('WEBGL_lose_context').loseContext());
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('glass-gpu')), false);
      assert.notEqual(await page.locator('.card').first().evaluate(e => getComputedStyle(e, '::before').filter), 'none',
        'context loss restores a native glass layer');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: static wallpapers never repaint idly, SVG writes and frame pacing hold;', JSON.stringify(samples));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
