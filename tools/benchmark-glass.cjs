// Compare glass/aurora and classic/minimal with ten cards in an isolated browser.
// Set PLAYWRIGHT_MODULE and optionally EDGE_EXECUTABLE before running.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.gstack', 'glass-perf');

async function measure(page, action) {
  return page.evaluate(async action => {
    const gaps = [];
    let previous, start, writes = 0;
    const observer = new MutationObserver(records => writes += records.length);
    const svg = document.querySelector('[data-glass-refraction-svg]');
    if (svg) observer.observe(svg, { subtree: true, attributes: true, childList: true });
    await new Promise(resolve => {
      function tick(now) {
        if (!start) start = now;
        if (previous) gaps.push(now - previous);
        previous = now;
        const elapsed = now - start;
        if (action === 'scroll') scrollTo(0, (Math.sin(elapsed / 650) + 1) * 750);
        if (action === 'pointer') {
          const card = document.querySelector('.word-search-wrapper');
          const r = card.getBoundingClientRect();
          card.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerType: 'mouse', clientX: r.left + 100 + (elapsed % 450), clientY: r.top + 40
          }));
        }
        if (elapsed < 1800) requestAnimationFrame(tick); else resolve();
      }
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    gaps.sort((a, b) => a - b);
    return {
      frames: gaps.length, p95ms: +gaps[Math.floor(gaps.length * .95)].toFixed(1),
      slowFrames: gaps.filter(n => n > 25).length, svgMutations: writes
    };
  }, action);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true
  });
  const results = [];
  try {
    for (const iface of ['classic', 'glass']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto('file:///' + ROOT.replaceAll('\\', '/') + '/index.html');
      await page.evaluate(iface => {
        Appearance.set(iface); Appearance.setTheme(iface === 'classic' ? 'minimal' : 'aurora');
        if (iface === 'glass') LiquidGlass.enable({ persist: false });
        const container = document.querySelector('.word-search-wrapper').parentNode;
        for (let i = 0; i < 10; i++) {
          const card = document.createElement('div');
          card.className = 'card word-search-wrapper';
          card.style.cssText = 'height:280px;padding:24px';
          card.innerHTML = '<div class="word-result"><h2>refraction · 折射</h2><p>Light passes through glass. 玻璃背景与清晰的正文。</p><div class="word-forms">forms · 变形</div><div class="sentences"><div class="sen-item">An example with clear text.</div><div class="sen-item">Each panel refracts the previous layer.</div></div></div>';
          container.append(card);
        }
      }, iface);
      await page.waitForTimeout(700);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const metric = (values, name) => values.find(v => v.name === name)?.value || 0;
      for (const action of ['idle', 'pointer', 'scroll']) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(250);
        const before = (await cdp.send('Performance.getMetrics')).metrics;
        const result = await measure(page, action);
        const after = (await cdp.send('Performance.getMetrics')).metrics;
        const row = {
          iface, action, ...result,
          taskMs: Math.round((metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000)
        };
        results.push(row); console.log(JSON.stringify(row));
      }
      await page.close();
    }
    fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify({ browser: browser.version(), results }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
