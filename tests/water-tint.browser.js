// Browser QA for the water colour slider (cet6_water_hue): live hue tint,
// theme scoping, persistence, keyboard control and glass/GPU layering.
//
// Run from the Cet6Dictionary directory:
//   PLAYWRIGHT_MODULE=C:/Users/<you>/agents/skills/gstack/node_modules/playwright \
//   EDGE_EXECUTABLE="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
//   node tests/water-tint.browser.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.gstack', 'water-tint');
const EDGE = process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const missing = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
    const file = path.join(ROOT, name);
    if (!/^[\w./-]+$/.test(name) || name.includes('..') || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      missing.push(name); res.writeHead(404).end(); return;
    }
    const type = name.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : name.endsWith('.css') ? 'text/css; charset=utf-8'
        : name.endsWith('.webp') ? 'image/webp'
          : name.endsWith('.svg') ? 'image/svg+xml'
            : name.endsWith('.png') ? 'image/png'
              : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: EDGE, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
    await page.addInitScript(() => {
      // Seed only the first load; later reloads keep whatever the page persisted.
      if (localStorage.getItem('cet6_interface_style')) return;
      localStorage.setItem('cet6_interface_style', 'classic');
      localStorage.setItem('cet6_theme_classic', 'water');
    });
    await page.goto(url);

    const tintState = () => page.evaluate(() => {
      const tint = document.querySelector('.appearance-water-tint');
      const slider = document.getElementById('waterHueSlider');
      return {
        hue: document.documentElement.dataset.waterHue,
        tint: document.documentElement.dataset.waterTint,
        opacity: getComputedStyle(tint).opacity,
        display: getComputedStyle(tint).display,
        background: getComputedStyle(tint).backgroundColor,
        blend: getComputedStyle(tint).mixBlendMode,
        controlHidden: document.getElementById('waterTintControl').hidden,
        sliderValue: slider.value,
        stored: localStorage.getItem('cet6_water_hue')
      };
    });

    // -------------------------------------------------- default water state
    await page.waitForTimeout(400);
    let state = await tintState();
    assert.equal(state.hue, '174', 'the default aqua hue is applied');
    assert.equal(state.tint, 'off');
    assert.equal(state.opacity, '0', 'the default water is not tinted');
    assert.equal(state.controlHidden, false, 'the slider is offered on the water theme');
    assert.equal(state.sliderValue, '174');
    assert.equal(await page.evaluate(() => window.Appearance.getWaterHue()), 174);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--water-hue').trim()), '174');

    // The slider lives inside the settings modal: open it before interacting.
    await page.locator('#btnOpenSettings').click();
    await page.locator('#modalSettings.active').waitFor();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#waterHueSlider').isVisible(), true, 'the slider is visible in the settings panel');

    // ------------------------------------------------- live slider change
    await page.locator('#waterHueSlider').fill('300');
    await page.waitForTimeout(120);
    state = await tintState();
    assert.equal(state.hue, '300');
    assert.equal(state.tint, 'on');
    assert.equal(state.opacity, '0.92', 'a custom hue enables the hue-blend tint');
    assert.equal(state.blend, 'hue', 'the tint blends hue while keeping water luminance');
    assert.equal(state.stored, '300', 'the slider persists the hue');
    assert.equal(await page.locator('#waterHueValue').textContent(), '品红 300°');
    assert.match(await page.locator('#waterHueChip').evaluate(el => getComputedStyle(el).backgroundColor), /^rgb\(255, 26, 255\)$/);
    const expected300 = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.background = 'hsl(300, 100%, 50%)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    assert.equal(state.background, expected300, 'the tint uses the chosen hue');
    await page.screenshot({ path: path.join(OUT, 'settings-water-hue-300.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, 'classic-water-hue-300.png'), animations: 'disabled' });

    // -------------------------------------------- keyboard + reset to default
    await page.locator('#btnOpenSettings').click();
    await page.locator('#modalSettings.active').waitFor();
    await page.waitForTimeout(150);
    await page.locator('#waterHueSlider').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);
    state = await tintState();
    assert.equal(state.sliderValue, '301', 'keyboard arrows adjust the hue');
    assert.equal(state.hue, '301');
    assert.equal(state.stored, '301');
    await page.evaluate(() => window.Appearance.setWaterHue(174));
    await page.waitForTimeout(120);
    state = await tintState();
    assert.equal(state.tint, 'off', 'resetting to 174 removes the tint');
    assert.equal(state.opacity, '0');
    assert.equal(state.hue, '174');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // ------------------------------------------------- theme scoping + hide
    await page.evaluate(() => window.Appearance.setWaterHue(240));
    await page.evaluate(() => window.Appearance.setTheme('aurora'));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.getElementById('waterTintControl').hidden), true,
      'aurora hides the water slider');
    assert.equal(await page.locator('.appearance-water-tint').evaluate(el => getComputedStyle(el).display), 'none',
      'the tint itself is water-only');
    await page.evaluate(() => window.Appearance.setTheme('water'));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.getElementById('waterTintControl').hidden), false);
    assert.equal((await tintState()).hue, '240', 'the hue survives theme switches');
    assert.equal((await tintState()).tint, 'on');

    // ------------------------------------------ settings panel + persistence
    await page.locator('#btnOpenSettings').click();
    await page.locator('#modalSettings.active').waitFor();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#waterTintControl').isVisible(), true, 'the slider is visible in the settings panel');
    assert.equal(await page.locator('#waterHueSlider').inputValue(), '240');
    await page.screenshot({ path: path.join(OUT, 'settings-water-hue.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.reload();
    await page.waitForTimeout(400);
    state = await tintState();
    assert.equal(state.hue, '240', 'the hue survives a reload');
    assert.equal(state.sliderValue, '240');
    assert.equal(state.tint, 'on');

    // Selecting water in the panel scrolls the freshly revealed slider into view.
    await page.locator('#btnOpenSettings').click();
    await page.locator('#modalSettings.active').waitFor();
    await page.evaluate(() => window.Appearance.setTheme('aurora'));
    await page.waitForTimeout(200);
    await page.locator('#modalSettings .theme-option:has(input[value="water"])').click();
    await page.waitForTimeout(700);
    const sliderInView = await page.evaluate(() => {
      const control = document.getElementById('waterTintControl');
      const body = document.querySelector('#modalSettings .modal-body').getBoundingClientRect();
      const rect = control.getBoundingClientRect();
      return !control.hidden && rect.top >= body.top - 1 && rect.bottom <= body.bottom + 1;
    });
    assert.equal(sliderInView, true, 'selecting water scrolls the new colour slider into view');
    await page.screenshot({ path: path.join(OUT, 'settings-water-revealed.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // --------------------------------------------------- glass GPU layering
    // The GPU wallpaper only runs without reduced motion, so open a dedicated context.
    const gpuContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const gpu = await gpuContext.newPage();
    gpu.on('pageerror', error => errors.push(error.message));
    gpu.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
    await gpu.addInitScript(() => {
      localStorage.setItem('cet6_interface_style', 'glass');
      localStorage.setItem('cet6_theme_glass', 'water');
      localStorage.setItem('cet6_water_hue', '240');
    });
    await gpu.goto(url);
    await gpu.waitForTimeout(1500);
    const glass = await gpu.evaluate(() => {
      const tint = document.querySelector('.appearance-water-tint');
      const canvas = document.querySelector('.glass-wallpaper-canvas');
      return {
        gpu: document.documentElement.classList.contains('glass-gpu'),
        canvas: Boolean(canvas),
        tintDisplay: getComputedStyle(tint).display,
        tintZ: getComputedStyle(tint).zIndex,
        tintOpacity: getComputedStyle(tint).opacity,
        canvasZ: canvas ? getComputedStyle(canvas).zIndex : null,
        hue: document.documentElement.dataset.waterHue
      };
    });
    assert.equal(glass.hue, '240');
    assert.equal(glass.tintDisplay, 'block');
    assert.equal(glass.tintOpacity, '0.92');
    if (glass.canvas) {
      assert.equal(glass.gpu, true, 'the shared wallpaper canvas is active');
      assert.equal(glass.tintZ, '2', 'the tint paints above the shared wallpaper canvas');
      assert.ok(Number(glass.tintZ) > Number(glass.canvasZ),
        'the colour layer must stay above the GPU wallpaper canvas');
      await gpu.evaluate(() => window.Appearance.setWaterHue(120));
      await gpu.waitForTimeout(600);
      assert.equal(await gpu.evaluate(() => document.documentElement.dataset.waterHue), '120');
      await gpu.screenshot({ path: path.join(OUT, 'glass-water-hue-120.png'), animations: 'disabled' });
      console.log('PASS: glass GPU wallpaper follows the water hue tint');
    } else {
      console.log('SKIP: WebGL wallpaper canvas unavailable, checked the native glass fallback');
    }
    await gpuContext.close();

    assert.deepEqual(missing.filter(name => !name.endsWith('favicon.ico')), [], 'all referenced assets were served');
    assert.deepEqual(errors, [], `no console or page errors: ${errors.join(' | ')}`);
    console.log('PASS: water colour slider tints, persists, hides outside water and stacks above glass canvases');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
