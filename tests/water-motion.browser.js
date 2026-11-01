// Real rendering regression: the water wallpaper must animate smoothly on the GPU,
// while every other wallpaper stays idle and reduced motion freezes it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.gstack', 'water-motion');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('file:///' + ROOT.replaceAll('\\', '/') + '/index.html');
    await page.evaluate(() => { Appearance.set('glass'); Appearance.setTheme('water'); LiquidGlass.enable({ persist: false }); });
    await page.waitForTimeout(900);

    const initial = await page.evaluate(() => GlassRenderer.getState());
    assert.equal(initial.waterMotion, true, 'the glass water wallpaper must enter shader motion');

    // Frame pacing: the render loop follows the display refresh (headless may exceed 60Hz).
    const pacing = await page.evaluate(async () => {
      const gaps = []; let previous = 0, start = 0;
      await new Promise(resolve => {
        function tick(now) {
          if (!start) start = now;
          if (previous) gaps.push(now - previous);
          previous = now;
          if (now - start < 1000) requestAnimationFrame(tick); else resolve();
        }
        requestAnimationFrame(tick);
      });
      gaps.sort((a, b) => a - b);
      const draws = GlassRenderer.getState().draws;
      await new Promise(resolve => setTimeout(resolve, 900));
      return { frames: gaps.length, p95: gaps[Math.floor(gaps.length * .95)], before: draws, after: GlassRenderer.getState().draws };
    });
    assert.ok(pacing.frames >= 45, `water motion must hold a high frame rate, saw ${pacing.frames} frames/s`);
    assert.ok(pacing.after - pacing.before >= 30, 'water motion must keep issuing GPU frames');
    assert.ok(pacing.p95 < 30, `water motion frame gaps should stay smooth, p95=${pacing.p95}ms`);

    // The composited canvas must visibly change over time.
    const frameA = await page.locator('.glass-wallpaper-canvas').screenshot();
    await page.waitForTimeout(450);
    const frameB = await page.locator('.glass-wallpaper-canvas').screenshot();
    assert.notEqual(frameA.toString('base64'), frameB.toString('base64'),
      'the water wallpaper must actually move between frames');
    await page.screenshot({ path: path.join(OUT, 'glass-water-motion.png'), animations: 'disabled' });

    // Static wallpapers must return to a fully idle GPU.
    await page.evaluate(() => Appearance.setTheme('aurora'));
    await page.waitForTimeout(500);
    const idleA = await page.evaluate(() => GlassRenderer.getState().draws);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => GlassRenderer.getState().draws), idleA,
      'non-water wallpapers must not keep repainting');

    // Reduced motion freezes the water.
    await page.evaluate(() => Appearance.setTheme('water'));
    await page.waitForTimeout(400);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(500);
    const stillA = await page.evaluate(() => GlassRenderer.getState().draws);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => GlassRenderer.getState().draws), stillA,
      'reduced motion must freeze the water animation');
    assert.equal(await page.evaluate(() => GlassRenderer.getState().waterMotion), false);
    await page.screenshot({ path: path.join(OUT, 'glass-water-reduced-motion.png'), animations: 'disabled' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(350);

    // Classic interface: a compositor-only flow layer with the same reduced-motion contract.
    await page.evaluate(() => { Appearance.set('classic'); Appearance.setTheme('water'); });
    await page.waitForTimeout(500);
    const classicA = await page.evaluate(() => {
      const after = getComputedStyle(document.querySelector('.appearance-water'), '::after');
      return { name: after.animationName, duration: after.animationDuration, transform: after.transform };
    });
    await page.waitForTimeout(500);
    const classicB = await page.evaluate(() => getComputedStyle(document.querySelector('.appearance-water'), '::after').transform);
    assert.match(classicA.name, /water-flow/, 'classic water must use the flow keyframes');
    assert.equal(classicA.duration, '14s');
    assert.notEqual(classicA.transform, classicB, 'classic water flow transform must advance');
    await page.screenshot({ path: path.join(OUT, 'classic-water-motion.png'), animations: 'disabled' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.appearance-water'), '::after').animationName), 'none',
      'reduced motion must remove the classic flow animation');

    assert.deepEqual(errors, []);
    console.log(`PASS: water flows at ${pacing.frames} fps (p95 ${pacing.p95.toFixed(1)}ms) on the GPU, static wallpapers stay idle, reduced motion freezes both interfaces; screenshots in ${OUT}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
