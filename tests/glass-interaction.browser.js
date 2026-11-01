const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('file:///' + path.resolve(__dirname, '../index.html').replaceAll('\\', '/'));
    await page.evaluate(() => {
      Appearance.set('glass'); LiquidGlass.enable({ persist: false });
      const card = document.createElement('div'); card.className = 'card interaction-fixture';
      card.style.cssText = 'position:fixed;left:400px;top:300px;width:500px;height:260px;z-index:8';
      card.innerHTML = '<span>清晰文字 · Glass</span>'; document.body.append(card);
    });
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => typeof window.GlassInteraction), 'object', 'glass interaction must be installed');
    const pixels = () => page.evaluate(() => new Promise(resolve => {
      GlassRenderer.render(); requestAnimationFrame(() => {
        const source = document.querySelector('.glass-wallpaper-canvas');
        const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
        const ctx = copy.getContext('2d'); ctx.drawImage(source,0,0);
        const box=source.getBoundingClientRect(),sx=source.width/box.width,sy=source.height/box.height;
        const data = ctx.getImageData(Math.round((555-box.left)*sx),Math.round((385-box.top)*sy),Math.round(90*sx),Math.round(90*sy)).data;
        resolve(Array.from(data));
      });
    }));
    const before = await pixels();
    await page.locator('.interaction-fixture').dispatchEvent('pointermove', { clientX:600,clientY:430,pointerType:'mouse',bubbles:true });
    await page.waitForTimeout(500);
    const hovered = await pixels();
    const difference = (a,b) => a.reduce((n,v,i) => n+(i%4===3?0:Math.abs(v-b[i])),0)/(a.length*.75);
    assert.ok(difference(before,hovered) > .2, 'hover must change real local background refraction');
    await page.evaluate(()=>Appearance.setTheme('minimal'));await page.waitForTimeout(300);
    const flatBefore=await pixels();
    await page.locator('.interaction-fixture').dispatchEvent('pointermove',{clientX:600,clientY:430,pointerType:'mouse',bubbles:true});
    await page.waitForTimeout(450);const flatAfter=await pixels();
    // Bilinear texture sampling can round a channel by one; a painted shadow is larger.
    assert.ok(flatBefore.every((v,i)=>Math.abs(v-flatAfter[i])<=1),'plain wallpaper hover must not paint synthetic light or shadow');
    await page.evaluate(()=>Appearance.setTheme('aurora'));await page.waitForTimeout(200);
    await page.locator('.interaction-fixture').dispatchEvent('pointermove',{clientX:600,clientY:430,pointerType:'mouse',bubbles:true});
    await page.waitForTimeout(350);
    const box = await page.locator('.interaction-fixture').boundingBox();
    const [compressed,rebound] = await page.evaluate(async () => {
      const capture = () => new Promise(resolve => {
        GlassRenderer.render();requestAnimationFrame(() => {
          const source=document.querySelector('.glass-wallpaper-canvas'),copy=document.createElement('canvas');
          copy.width=source.width;copy.height=source.height;const ctx=copy.getContext('2d');ctx.drawImage(source,0,0);
          const box=source.getBoundingClientRect(),sx=source.width/box.width,sy=source.height/box.height;
          resolve(Array.from(ctx.getImageData(Math.round((555-box.left)*sx),Math.round((385-box.top)*sy),Math.round(90*sx),Math.round(90*sy)).data));
        });
      });
      const waitForPhase = predicate => new Promise((resolve,reject) => {
        const start=performance.now();
        function check(){if(predicate())resolve();else if(performance.now()-start>1500)reject(new Error('spring phase timeout'));else requestAnimationFrame(check);}
        requestAnimationFrame(check);
      });
      document.querySelector('.interaction-fixture').dispatchEvent(new MouseEvent('click',{clientX:600,clientY:430,detail:1,bubbles:true}));
      await waitForPhase(()=>GlassInteraction.getState().spring>.7);const first=await capture();
      await waitForPhase(()=>GlassInteraction.getState().spring<-.2);const second=await capture();
      return [first,second];
    });
    assert.ok(difference(compressed,rebound) > .2, 'click must produce a changing spring refraction');
    assert.deepEqual(await page.locator('.interaction-fixture').boundingBox(),box,'hit target does not wobble with the optical surface');
    assert.equal(await page.locator('.interaction-fixture span').evaluate(e=>getComputedStyle(e).filter),'none');
    await page.locator('.interaction-fixture').dispatchEvent('pointerout', { relatedTarget:null,bubbles:true });
    await page.waitForTimeout(1100);
    const draws = await page.evaluate(()=>GlassRenderer.getState().draws);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>GlassRenderer.getState().draws),draws,'interaction must settle back to idle');
    await page.evaluate(()=>LiquidGlass.setIntensity(0,{persist:false}));
    const zeroBefore=await pixels();
    await page.locator('.interaction-fixture').dispatchEvent('pointermove',{clientX:600,clientY:430,pointerType:'mouse',bubbles:true});
    await page.waitForTimeout(350);
    assert.ok(difference(zeroBefore,await pixels())<.2,'zero intensity also disables interactive optical distortion');
    await page.evaluate(()=>LiquidGlass.setIntensity(1,{persist:false}));
    await page.locator('.interaction-fixture').dispatchEvent('pointermove',{clientX:600,clientY:430,pointerType:'mouse',bubbles:true});
    await page.waitForTimeout(350);
    await page.evaluate(()=>LiquidGlass.disable({persist:false}));
    assert.equal(await page.evaluate(()=>GlassInteraction.getState().hover),0,'disable clears a settled dent');
    await page.evaluate(()=>LiquidGlass.enable({persist:false}));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>GlassInteraction.getState().hover),0,'enable does not resurrect the dent');
    await page.locator('#btnOpenSettings').click();await page.waitForTimeout(500);
    await page.locator('#modalSettings').dispatchEvent('pointermove',{clientX:650,clientY:350,pointerType:'mouse',bubbles:true});
    await page.waitForTimeout(350);
    assert.ok(await page.locator('[data-interactive]').count()>0,'native modal creates a local pressure field');
    await page.locator('#modalSettings').dispatchEvent('pointerout',{relatedTarget:null,bubbles:true});
    await page.waitForTimeout(950);
    assert.equal(await page.locator('[data-interactive]').count(),0,'native pressure field is released on leave');
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion:'reduce' });
    await page.locator('.interaction-fixture').dispatchEvent('click',{clientX:600,clientY:430,bubbles:true,detail:1});
    assert.equal(await page.locator('.glass-jelly').count(),0,'reduced motion suppresses jelly');
    assert.deepEqual(errors,[]);
    console.log('PASS: local hover deformation, click spring, sharp text, stable hit target, settling and reduced motion');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
