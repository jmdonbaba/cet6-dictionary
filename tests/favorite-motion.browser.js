const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto('file:///' + path.resolve(__dirname, '../index.html').replaceAll('\\', '/'));
    await page.evaluate(()=>document.startViewTransition=undefined); // Legacy fallback remains covered.
    for (const [iface, width] of [['glass', 1100], ['glass', 390], ['classic', 1100]]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(iface => {
        closeModal(); Appearance.set(iface); Appearance.setTheme('aurora');
        setVFavs([{ id: 'motion', word: 'endorse', meaning: '支持；认可', definitions: ['v. 支持；认可', 'v. 背书'],
          examples: Array.from({ length: 7 }, () => ({ en: 'They endorsed the proposal and agreed to give it their full support after a thorough assessment.', cn: '他们支持该提案，并同意在全面评估后给予全力支持。' })),
          mnemonic: { word: 'endorse', breakdown: 'en- + dorse → 背书', parts: [{ part: 'dorse', source: '词根：背' }] } }]);
        renderVFavs(); openModal(document.getElementById('modalVocabFav'), true);
        document.querySelector('.vf-compact').click();
      }, iface);
      await page.waitForTimeout(500);
      for (const direction of ['shrink', 'grow']) {
        const motion = await page.evaluate(async () => {
          const detail = document.querySelector('.vf-detail'), modal = document.getElementById('modalVocabFav');
          const from = { height: detail.offsetHeight, modal: modal.offsetHeight, face: detail.dataset.face };
          const samples = [];
          const canvas=modal.querySelector('.glass-modal-canvas');let allocations=0;
          if(canvas){const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'height');Object.defineProperty(canvas,'height',{configurable:true,get(){return descriptor.get.call(this)},set(value){allocations++;descriptor.set.call(this,value)}})}
          detail.querySelector('.vf-flip').click();
          await new Promise(resolve => {
            function sample() {
              const rect = detail.getBoundingClientRect();
              samples.push({ height: rect.height, modal: modal.getBoundingClientRect().height,
                width: rect.width / detail.offsetWidth, face: detail.dataset.face });
              if (detail._flipping) requestAnimationFrame(sample); else resolve();
            }
            requestAnimationFrame(sample);
          });
          if(canvas)delete canvas.height;
          return { from, to: { height: detail.offsetHeight, modal: modal.offsetHeight }, samples, allocations };
        });
        const label = `${iface}/${width}/${direction}`;
        assert.ok(motion.allocations<=2,`${label}: reuse popup backing storage during a turn instead of allocating every frame: ${motion.allocations}`);
        const changed = motion.samples.find(sample => sample.face !== motion.from.face);
        assert.ok(changed.width < .4, `${label}: new face stays edge-on instead of flashing full width: ${changed.width}`);
        const range = motion.to.height - motion.from.height;
        const modalRange = motion.to.modal - motion.from.modal;
        assert.ok(Math.abs(range) > 200 && Math.abs(modalRange) > 100, `${label}: fixture crosses the popup height cap`);
        for (const sample of motion.samples.filter(sample => sample.face !== motion.from.face)) {
          const progress = (sample.height - motion.from.height) / range;
          const modalProgress = (sample.modal - motion.from.modal) / modalRange;
          assert.ok(Math.abs(progress - modalProgress) < .035, `${label}: popup and card resize together: ${JSON.stringify({ progress, modalProgress })}`);
          assert.ok(!(sample.width > .999 && progress > .05 && progress < .95), `${label}: resizing cannot trail behind the completed turn`);
        }
        assert.equal(await page.locator('.is-flipping,.is-resizing').count(), 0);
        assert.equal(await page.locator('#modalVocabFav').evaluate(el => el.getAnimations().length), 0, 'popup returns to natural height');
      }
    }
    const favorite = await page.evaluate(() => getVFavs()[0]);
    for (const action of ['pin', 'delete', 'refresh']) {
      await page.evaluate(favorite => {
        closeModal(); Appearance.set('glass'); setVFavs([favorite]); renderVFavs();
        openModal(document.getElementById('modalVocabFav'), true);
        document.querySelector('.vf-compact').click();
      }, favorite);
      await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelector('.vf-flip').click());
      await page.waitForFunction(() => document.querySelector('.vf-detail.is-resizing'));
      const height = await page.evaluate(async action => {
        if (action === 'pin') pinVFav('motion');
        else if (action === 'delete') delVFav('motion');
        else renderVFavs();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const modal = document.getElementById('modalVocabFav');
        return { height: modal.getBoundingClientRect().height, animations: modal.getAnimations().length };
      }, action);
      assert.equal(height.animations, 0, `${action}: rebuilding the list cancels its old popup motion`);
      await page.waitForTimeout(500);
      assert.ok(Math.abs(await page.locator('#modalVocabFav').evaluate(el => el.getBoundingClientRect().height) - height.height) < 1,
        `${action}: detached cards cannot leave a delayed popup height jump`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: favorite face swap has no full-width flash; popup, card height and turn settle together on desktop/mobile/classic');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
