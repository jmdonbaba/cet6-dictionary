const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('file:///' + path.resolve(__dirname, '../index.html').replaceAll('\\', '/'));
    await page.evaluate(() => { Appearance.set('glass'); Appearance.setTheme('aurora'); LiquidGlass.enable({ persist: false }); });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await page.waitForFunction(() => window.GlassRenderer && GlassRenderer.getState().buttons > 0, null, { timeout: 10000 });
    assert.ok(await page.evaluate(() => GlassRenderer.getState().buttons > 0), 'visible buttons must participate in real refraction');
    // Read the renderer directly: no text, sheen or hover animation can fake a pixel change.
    const difference = await page.evaluate(async () => {
      const canvas = document.querySelector('.glass-wallpaper-canvas');
      const capture = () => new Promise(resolve => {
        GlassRenderer.render();
        requestAnimationFrame(() => {
          const output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height;
          output.getContext('2d').drawImage(canvas,0,0);
          resolve(output.getContext('2d').getImageData(0,0,output.width,output.height).data);
        });
      });
      const on = await capture();
      // Native DOM dimensions/labels are untouched; this disables only the optical button pass.
      GlassRenderer.setButtonIntensity(0);
      const off = await capture();
      GlassRenderer.setButtonIntensity(1);
      const r = document.querySelector('.word-search-submit').getBoundingClientRect();
      const scale = canvas.width / innerWidth;
      let center = 0, edge = 0, centerN = 0, edgeN = 0;
      for(let y = 3; y < r.height-3; y++) for(let x = 3; x < r.width-3; x++) {
        const i = (Math.floor((r.top+y)*scale)*canvas.width+Math.floor((r.left+x)*scale))*4;
        const d = Math.abs(on[i]-off[i])+Math.abs(on[i+1]-off[i+1])+Math.abs(on[i+2]-off[i+2]);
        if(x>r.width*.3&&x<r.width*.7&&y>r.height*.45&&y<r.height*.55){center+=d;centerN++;}
        if(y<r.height*.2||y>r.height*.8){edge+=d;edgeN++;}
      }
      return { center: center/centerN, edge: edge/edgeN };
    });
    assert.ok(difference.edge > 1, `edge must bend the wallpaper: ${JSON.stringify(difference)}`);
    assert.ok(difference.center < .5, `center core must stay flat: ${JSON.stringify(difference)}`);
    await page.evaluate(()=>{GlassRenderer.destroy();window.GlassRenderer=null;LiquidGlass.refresh()});
    await page.locator('#btnOpenSettings').click(); await page.waitForTimeout(400);
    assert.notEqual(await page.locator('#modalSettings .modal-close').evaluate(e => getComputedStyle(e,'::before').filter), 'none', 'modal button refraction belongs above the overlay');
    assert.equal(await page.locator('#modalSettings .modal-close').evaluate(e => getComputedStyle(e).filter), 'none', 'button text/icons must remain sharp');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { setVFavs([{ id: 'optics-fixture', word: 'glass', meaning: '玻璃', pos: 'n.' }]); renderVFavs(); });
    await page.locator('#btnOpenVocabFav').click(); await page.waitForTimeout(500);
    await page.locator('#btnStudyExport').click(); await page.waitForTimeout(250);
    assert.ok(await page.locator('#studyExportMenu button').evaluateAll(buttons => buttons.every(e => getComputedStyle(e,'::before').filter !== 'none')),
      'revealing an export menu must initialize its button optics without manual refresh');
    assert.deepEqual(errors, []);
    console.log('PASS: button edge bends while center stays flat, sharp labels and modal optics;', JSON.stringify(difference));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
