const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const shortcut = page.locator('#btnOpenFavoritesShortcut');
  const source = page.locator('#btnOpenVocabFav');
  const snapshot = () => page.evaluate(() => localStorage.getItem('cet6_vocab_favorites'));
  const settle = visible => page.waitForFunction(visible => {
    const button = document.querySelector('#btnOpenFavoritesShortcut');
    const style = getComputedStyle(button);
    const width = document.querySelector('#favoritesShortcutSlot').getBoundingClientRect().width;
    return visible ? !document.querySelector('#favoritesShortcuts').hidden && button.getBoundingClientRect().width > 0 && style.visibility === 'visible' && Number(style.opacity) > .99 && Math.abs(width - button.offsetWidth) < .5 : style.visibility === 'hidden' && width < .5;
  }, visible);
  async function scrollToSource(visible) {
    await page.evaluate(visible => {
      const source = document.querySelector('#btnOpenVocabFav');
      scrollTo({ top: visible ? source.getBoundingClientRect().top + scrollY - innerHeight + 130 : 0, behavior: 'instant' });
    }, visible);
    await settle(!visible);
  }
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await shortcut.count(), 1, 'the all-favorites shortcut must exist');
    await page.evaluate(() => {
      Appearance.set('classic');
      setVFavs([{ id: 'kept', word: 'retained', definitions: ['保留'] }]); renderVFavs();
      applyWordSearchCards([{ input: 'example', result: { word: 'example', definitions: Array.from({ length: 45 }, (_, i) => `释义 ${i + 1}：用于检验长页面里的收藏入口。`) } }]);
      scrollTo(0, 0);
    });
    await settle(true);
    assert.equal((await shortcut.textContent()).trim(), '收藏夹');
    assert.equal(await shortcut.locator('span').count(), 0, 'the compact entry has no favorite count');
    assert.match(await source.textContent(), /^收藏夹/);
    let jump = await page.locator('#btnJumpUnfavorited').boundingBox();
    let entry = await shortcut.boundingBox();
    assert.ok(entry.x >= jump.x + jump.width + 6, `favorites entry sits to the right of the navigation icon: ${JSON.stringify({ jump, entry, layout: await page.locator('#favoritesShortcuts').evaluate(el => ({ width: el.offsetWidth, position: getComputedStyle(el.firstElementChild).position })) })}`);
    const before = await snapshot();
    const scrollBefore = await page.evaluate(() => scrollY);
    await shortcut.click();
    assert.equal(await page.locator('#modalVocabFav.active').count(), 1, 'the shortcut opens the existing all-favorites popup');
    assert.match(await page.locator('#favListContainer .vf-word').textContent(), /^retained/);
    assert.equal(await snapshot(), before, 'opening favorites never changes favorite records');
    assert.equal(await page.evaluate(() => scrollY), scrollBefore, 'opening favorites does not scroll to the footer');
    assert.equal(await page.locator('#favoritesShortcuts').isVisible(), false);
    await page.keyboard.press('Escape');
    await settle(true);
    console.log('PASS: right-side shortcut opens the same collection without writing favorites or scrolling');

    await shortcut.focus();
    await page.evaluate(() => {
      const source = document.querySelector('#btnOpenVocabFav');
      scrollTo({ top: source.getBoundingClientRect().top + scrollY - innerHeight + 130, behavior: 'instant' });
    });
    await page.waitForFunction(() => document.querySelector('.favorites-handoff'));
    const handoff = await page.locator('.favorites-handoff').evaluate(el => ({
      interactive: getComputedStyle(el).pointerEvents,
      duration: el.getAnimations()[0].effect.getTiming().duration
    }));
    assert.equal(handoff.interactive, 'none');
    assert.ok(handoff.duration >= 250 && handoff.duration <= 600);
    const landingError = await page.evaluate(async () => {
      const ghost = document.querySelector('.favorites-handoff');
      const animation = ghost.getAnimations()[0], start = performance.now(), top = scrollY;
      return new Promise(resolve => {
        function sample() {
          const elapsed = performance.now() - start;
          if (elapsed < 160) scrollTo({ top: top + elapsed * .5, behavior: 'instant' });
          if (animation.currentTime >= 370) {
            const a = ghost.getBoundingClientRect(), b = document.querySelector('#btnOpenVocabFav').getBoundingClientRect();
            resolve(Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2));
          } else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
    });
    assert.ok(landingError < 30, `the handoff follows the real entry while scrolling continues (${landingError}px)`);
    await settle(false);
    assert.equal(await source.evaluate(el => el === document.activeElement), true, 'keyboard focus follows the visible entry');
    await page.waitForFunction(() => !document.querySelector('.favorites-handoff'));
    await scrollToSource(false);
    await page.waitForFunction(() => !document.querySelector('.favorites-handoff'));
    assert.equal(await snapshot(), before);
    console.log('PASS: entering/leaving the footer smoothly hands off the entry and keyboard focus');

    // Reverse during a flight: only the latest handoff remains, then all effects clean up.
    await page.evaluate(() => document.querySelector('#btnOpenVocabFav').scrollIntoView({ block: 'end', behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('.favorites-handoff'));
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await settle(true);
    assert.ok(await page.locator('.favorites-handoff').count() <= 1);
    await page.waitForFunction(() => !document.querySelector('.favorites-handoff'));
    await page.evaluate(() => {
      const source = document.querySelector('#btnOpenVocabFav');
      scrollTo({ top: source.getBoundingClientRect().top + scrollY - innerHeight + 130, behavior: 'instant' });
    });
    await page.waitForFunction(() => document.querySelector('.favorites-handoff'));
    await source.click();
    await page.waitForFunction(() => !document.querySelector('.favorites-handoff'));
    await page.keyboard.press('Escape');
    await settle(false);
    console.log('PASS: rapid direction changes and modal opening cancel obsolete motion');

    for (const width of [320, 390, 768, 1240, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await scrollToSource(false);
      jump = await page.locator('#btnJumpUnfavorited').boundingBox(); entry = await shortcut.boundingBox();
      assert.ok(jump.x >= 0 && entry.x + entry.width <= width - 8, `both controls stay within a ${width}px viewport`);
      assert.ok(entry.x >= jump.x + jump.width + 6);
      assert.ok(entry.width >= 44 && entry.height >= 44);
    }
    await shortcut.screenshot({ path: path.join(process.env.TEMP, 'cet6-favorites-shortcut-button.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await scrollToSource(false);
    for (const sourceVisible of [true, false]) {
      const frames = await page.evaluate(async sourceVisible => {
        const source = document.querySelector('#btnOpenVocabFav');
        scrollTo({ top: sourceVisible ? source.getBoundingClientRect().top + scrollY - innerHeight + 130 : 0, behavior: 'instant' });
        const frames = [], start = performance.now();
        return new Promise(resolve => {
          function sample() {
            const button = document.querySelector('#btnOpenFavoritesShortcut'), rect = button.getBoundingClientRect();
            frames.push({ left: rect.left, right: rect.right, opacity: Number(getComputedStyle(button).opacity) });
            if (performance.now() - start < 500) requestAnimationFrame(sample); else resolve(frames);
          }
          requestAnimationFrame(sample);
        });
      }, sourceVisible);
      const visibleFrames = frames.filter(frame => frame.opacity > .05);
      assert.ok(visibleFrames.length > 3);
      assert.ok(visibleFrames.every(frame => frame.left >= 8 && frame.right <= 382), `mobile ${sourceVisible ? 'hide' : 'reveal'} stays inside the viewport throughout its transition: ${JSON.stringify(visibleFrames)}`);
    }
    await page.locator('#favoritesShortcuts').screenshot({ path: path.join(process.env.TEMP, 'cet6-favorites-shortcuts-mobile.png') });
    await scrollToSource(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await scrollToSource(false);
    await page.locator('#favoritesShortcuts').screenshot({ path: path.join(process.env.TEMP, 'cet6-favorites-shortcuts-desktop.png') });
    console.log('PASS: desktop/tablet/mobile layouts keep both 44px targets inside safe bounds');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await scrollToSource(true);
    assert.equal(await page.locator('.favorites-handoff').count(), 0);
    await scrollToSource(false);
    assert.equal(await page.locator('.favorites-handoff').count(), 0);
    await page.evaluate(() => applyWordSearchCards([{ input: '', result: null }]));
    await settle(false);
    console.log('PASS: reduced motion switches directly and content shrink updates shortcut visibility');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      Appearance.set('glass'); Appearance.setTheme('aurora');
      applyWordSearchCards([{ input: 'glass', result: { word: 'glass', definitions: Array.from({ length: 45 }, () => '玻璃界面的长卡片。') } }]);
      scrollTo(0, 0);
    });
    await settle(true);
    await scrollToSource(true);
    await page.waitForFunction(() => !document.querySelector('.favorites-handoff'));
    await scrollToSource(false);
    await page.waitForFunction(() => !document.querySelector('.favorites-handoff'));
    await page.locator('#favoritesShortcuts').screenshot({ path: path.join(process.env.TEMP, 'cet6-favorites-shortcuts-glass.png') });
    assert.equal(await shortcut.evaluate(el => getComputedStyle(el).visibility), 'visible');
    assert.deepEqual(errors, []);
    assert.equal(await snapshot(), before);
    console.log('PASS: glass theme transitions remain usable and do not alter favorite data');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
