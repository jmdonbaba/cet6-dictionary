// Real rendering regression for GPU wallpaper motion and its static fallbacks.
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
    await page.evaluate(() => { Appearance.set('glass'); Appearance.setTheme('water'); LiquidGlass.enable(); });
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

    const sampleScene = () => page.evaluate(() => {
      const canvas = document.querySelector('.glass-wallpaper-canvas');
      const copy = document.createElement('canvas');
      copy.width = 96;
      copy.height = 60;
      const ctx = copy.getContext('2d');
      GlassRenderer.flush();
      ctx.drawImage(canvas, 0, 0, copy.width, copy.height);
      return Array.from(ctx.getImageData(0, 0, copy.width, copy.height).data);
    });
    const difference = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / (a.length * .75);
    const ambient = {};
    for (const theme of ['aurora', 'peach', 'night', 'minimal']) {
      await page.evaluate(value => Appearance.setTheme(value), theme);
      await page.waitForTimeout(250);
      const start = await page.evaluate(() => GlassRenderer.getState());
      assert.equal(start.waterMotion, false, theme + ' must stop the water shader');
      assert.equal(start.ambientMotion, true, theme + ' must enter ambient motion');
      const before = await sampleScene();
      await page.waitForTimeout(850);
      const after = await sampleScene();
      const draws = await page.evaluate(() => GlassRenderer.getState().draws) - start.draws;
      ambient[theme] = { difference: difference(before, after), draws };
      assert.ok(ambient[theme].difference > .04, theme + ' must visibly change its wallpaper pixels');
      assert.ok(ambient[theme].difference < 6, theme + ' motion must stay subtle');
      assert.ok(draws > 5 && draws < pacing.frames, theme + ' must use a lower idle cadence than water');
    }

    // A background tab stops the loop and resumes when it is visible again.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = await page.evaluate(() => GlassRenderer.getState().draws);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => GlassRenderer.getState().draws), hidden);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => GlassRenderer.getState().ambientMotion);

    // Reduced motion makes all GPU wallpapers static.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    const idleA = await page.evaluate(() => GlassRenderer.getState());
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => GlassRenderer.getState().draws), idleA.draws);
    assert.equal(idleA.ambientMotion, false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => GlassRenderer.getState().ambientMotion);

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

    const broken = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await broken.addInitScript(() => {
      localStorage.setItem('cet6_interface_style', 'glass');
      localStorage.setItem('cet6_theme_glass', 'water');
      localStorage.setItem('cet6_liquid_glass', 'on');
      const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        ...src,
        set(value) {
          src.set.call(this, value.startsWith('data:image/webp;') ? 'data:image/webp;base64,AA==' : value);
        }
      });
    });
    await broken.goto('file:///' + ROOT.replaceAll('\\', '/') + '/index.html');
    await broken.waitForFunction(() => document.documentElement.classList.contains('glass-gpu'));
    await broken.waitForTimeout(350);
    const fallback = await broken.evaluate(() => GlassRenderer.getState());
    await broken.waitForTimeout(250);
    assert.equal(fallback.waterMotion, false, 'a missing water texture uses the static fallback');
    assert.equal(await broken.evaluate(() => GlassRenderer.getState().draws), fallback.draws,
      'a missing water texture must not retry the draw on each frame');
    await broken.close();

    assert.deepEqual(errors, []);
    console.log(`PASS: water flows at ${pacing.frames} fps (p95 ${pacing.p95.toFixed(1)}ms) on the GPU, the other glass themes drift subtly, and reduced motion freezes both interfaces; screenshots in ${OUT}`, ambient);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
