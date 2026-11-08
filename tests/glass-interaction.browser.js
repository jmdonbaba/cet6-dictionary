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
      GlassWallpaper.motionFor = () => null; // Isolate lens motion from wallpaper drift.
      Appearance.set('glass'); Appearance.setTheme('aurora'); LiquidGlass.enable({ persist: false });
      const card = document.createElement('div'); card.className = 'card interaction-fixture';
      card.style.cssText = 'position:fixed;left:400px;top:300px;width:500px;height:260px;z-index:8';
      card.innerHTML = '<span>清晰文字 · Glass</span>'; document.body.append(card);
    });
    await page.waitForTimeout(600);
    await page.waitForFunction(() => GlassRenderer.getState().active && GlassRenderer.getState().draws > 0, null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => typeof window.GlassInteraction), 'object', 'glass interaction must be installed');
    const checkModalHover = async () => {
      await page.evaluate(() => {
        setVFavs(Array.from({ length: 45 }, (_, index) => ({ id: String(index), word: `fixture-${index}`, definitions: ['测试'] })));
        renderVFavs();
        openModal($modalVocabFav, true);
        document.getElementById('wordFavPanel').scrollTop = 0;
      });
      const row = await page.locator('.vf-compact[data-vfidx="3"]').boundingBox();
      const point = { x: row.x + 40, y: row.y + row.height / 2 };
      await page.mouse.move(point.x, point.y);
      await page.waitForFunction(() => GlassInteraction.target()?.closest('.vf-compact')?.dataset.vfidx === '3', null, { timeout: 1600 });
      await page.mouse.wheel(0, 360);
      await page.waitForFunction(({ x, y }) => {
        const hit = document.elementFromPoint(x, y)?.closest('.vf-compact');
        return hit && hit.dataset.vfidx !== '3' && GlassInteraction.target()?.closest('.vf-compact') === hit;
      }, point, { timeout: 1600 }).catch(() => assert.fail('nested scrolling must retarget the optics without moving the pointer'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !GlassInteraction.target()?.closest('.modal-card'), null, { timeout: 1600 })
        .catch(() => assert.fail('closing the modal must release the hidden optical target'));
      await page.mouse.move(1, 1);
    };
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

    await page.evaluate(() => {
      const card = document.createElement('div');
      card.className = 'card magnetic-fixture';
      card.style.cssText = 'position:fixed;left:1110px;top:300px;width:230px;height:260px;z-index:8';
      document.body.append(card);
    });
    const magneticCard = page.locator('.magnetic-fixture');
    const magneticBox = await magneticCard.boundingBox();
    const edge = magneticBox.x + magneticBox.width;
    const centerY = magneticBox.y + magneticBox.height / 2;
    const nearPointer = { x: edge + 10, y: centerY };
    const probes = [nearPointer, { x: edge - 4, y: centerY }];
    const initialHits = await page.evaluateHandle(points => points.map(({ x, y }) => document.elementFromPoint(x, y)), probes);
    assert.deepEqual(await initialHits.evaluate(hits => hits.map(hit => Boolean(hit?.closest('.magnetic-fixture')))), [false, true],
      'magnetic probes straddle the real card edge');
    const outsidePixels = async () => {
      // Read the composited page. A DOM-only check cannot prove that glass is drawn outside the card.
      const clip = { x: Math.round(edge) + 2, y: Math.round(magneticBox.y) + 20, width: 8, height: Math.round(magneticBox.height) - 40 };
      const screenshot = await page.screenshot({ clip });
      return page.evaluate(async ({ png, nearY }) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
        const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        return {
          near: Array.from(ctx.getImageData(0, nearY, bitmap.width, 32).data),
          far: Array.from(ctx.getImageData(0, 0, bitmap.width, 32).data)
        };
      }, { png: screenshot.toString('base64'), nearY: Math.round(centerY - clip.y) - 16 });
    };
    await page.mouse.move(1430, 700);
    await page.waitForTimeout(450);
    const restingEdge = await outsidePixels();
    await page.mouse.move(nearPointer.x, nearPointer.y);
    await page.waitForTimeout(450);
    const pulledEdge = await outsidePixels();
    const nearChange = difference(restingEdge.near, pulledEdge.near);
    assert.ok(nearChange > .5, `a pointer 10px outside the card must visibly pull the local glass edge (RGB change ${nearChange})`);
    assert.ok(difference(restingEdge.far, pulledEdge.far) < .2, 'glass away from the pointer remains still');
    assert.deepEqual(await magneticCard.boundingBox(), magneticBox, 'magnetic paint does not resize or move the card');
    assert.ok(await initialHits.evaluate((hits, points) => hits.every((hit, index) => hit === document.elementFromPoint(points[index].x, points[index].y)), probes),
      'the visual edge does not change the card or surrounding hit targets');
    await initialHits.dispose();
    await page.evaluate(() => {
      const neighbor = document.createElement('div');
      neighbor.className = 'card magnetic-neighbor';
      neighbor.style.cssText = 'position:fixed;left:932px;top:325px;width:166px;height:210px;z-index:8';
      document.body.append(neighbor);
    });
    await page.mouse.move(magneticBox.x + 15, centerY);
    await page.waitForTimeout(650);
    const simultaneous = await page.evaluate(() => ['.magnetic-fixture', '.magnetic-neighbor'].map(selector =>
      GlassInteraction.readEdge(document.querySelector(selector))?.element.matches(selector) || false));
    assert.deepEqual(simultaneous, [true, true], 'nearby cards respond even when the pointer is inside another card');
    await page.locator('.magnetic-neighbor').evaluate(card => card.remove());
    await page.mouse.move(edge + 58, centerY);
    await page.waitForTimeout(700);
    const distantDepth = await magneticCard.evaluate(el => GlassInteraction.readEdge(el)?.depth || 0);
    assert.ok(distantDepth > .5 && distantDepth < 6, `the edge still responds gently 58px away: ${distantDepth}`);
    await page.mouse.move(edge - 12, centerY);
    await page.waitForFunction(() => GlassInteraction.readEdge(document.querySelector('.magnetic-fixture'))?.depth < -1, null, { timeout: 1400 });
    await page.mouse.move(1430, 700);
    await page.waitForTimeout(950);
    assert.ok(difference(restingEdge.near, (await outsidePixels()).near) < .2, 'the outside glass edge returns to rest after the pointer leaves');
    await magneticCard.evaluate(card => card.remove());

    const star = page.locator('#btnJumpUnfavorited');
    const starBox = await star.boundingBox();
    await page.mouse.move(starBox.x + starBox.width / 2, starBox.y + 8);
    await page.waitForFunction(() => Math.abs(GlassInteraction.readEdge(document.getElementById('btnJumpUnfavorited'))?.depth) > .5);
    const stationary = await star.evaluate(el => new Promise(resolve => {
      const start = performance.now(), original = el.getBoundingClientRect();
      function check(now) {
        const box = el.getBoundingClientRect();
        if (box.x !== original.x || box.y !== original.y) return resolve(false);
        if (now - start < 600) requestAnimationFrame(check); else resolve(true);
      }
      requestAnimationFrame(check);
    }));
    assert.ok(stationary, 'double-star stays under a stationary pointer throughout attraction');
    assert.deepEqual(await star.boundingBox(), starBox, 'the star retains its resting position');
    const footer = page.locator('#btnOpenVocabFav');
    await footer.scrollIntoViewIfNeeded();
    const footerBox = await footer.boundingBox();
    await page.mouse.move(footerBox.x + footerBox.width / 2, footerBox.y + 7);
    await page.waitForFunction(() => GlassInteraction.readEdge(document.getElementById('btnOpenVocabFav'))?.depth < -.5);
    const footerLayers = await footer.evaluate(el => ({
      host: getComputedStyle(el).backgroundImage,
      shadow: getComputedStyle(el).boxShadow,
      plate: getComputedStyle(el, '::before').clipPath,
      extra: getComputedStyle(el, '::after').content
    }));
    assert.equal(footerLayers.host, 'none');
    assert.equal(footerLayers.shadow, 'none');
    assert.equal(footerLayers.extra, 'none');
    assert.match(footerLayers.plate, /glass-edge-contour/);

    const button = page.locator('.word-search-submit').first();
    const buttonBox = await button.boundingBox();
    await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + 6);
    await page.waitForFunction(() => GlassInteraction.readEdge(document.querySelector('.word-search-submit'))?.depth < -.5,
      null, { timeout: 1400 });
    assert.deepEqual(await button.boundingBox(), buttonBox, 'glass button material bends independently of its hit target');
    assert.match(await button.evaluate(el => getComputedStyle(el, '::before').clipPath), /glass-edge-contour/);
    const field = page.locator('.word-search-input').first();
    const fieldBox = await field.boundingBox();
    await page.mouse.move(fieldBox.x + fieldBox.width / 2, fieldBox.y + 7);
    await page.waitForFunction(() => GlassInteraction.readEdge(document.querySelector('.word-search-input'))?.depth < -.5,
      null, { timeout: 1400 });
    assert.equal(await field.getAttribute('data-glass-edge'), 'field');
    assert.deepEqual(await field.boundingBox(), fieldBox, 'the input frame bends around its fixed text field');
    const shoulder = await field.evaluate(el => {
      const shape = GlassInteraction.readEdge(el);
      const id = el.style.getPropertyValue('--glass-edge-clip').match(/#([^)]*)/)[1];
      const path = document.getElementById(id).querySelector('path');
      const points = Array.from({ length: Math.ceil(path.getTotalLength()) }, (_, i) => path.getPointAtLength(i));
      const topAt = offset => points.filter(p => Math.abs(p.x - (shape.x + 20 + offset)) < 1.1)
        .reduce((top, p) => Math.min(top, p.y), Infinity) - 20;
      return [topAt(65), topAt(170)];
    });
    assert.ok(shoulder[0] > .2 && Math.abs(shoulder[1]) < .05,
      `the bend fades through a long shoulder before joining the straight edge: ${shoulder}`);
    await page.mouse.move(fieldBox.x + fieldBox.width / 2, fieldBox.y + fieldBox.height / 2);
    await page.waitForTimeout(500);
    const twoRims = await field.evaluate(el => {
      const shape = GlassInteraction.readEdge(el);
      const id = el.style.getPropertyValue('--glass-edge-clip').match(/#([^)]*)/)[1];
      const path = document.getElementById(id).querySelector('path');
      const ys = [];
      for (let i = 0, length = path.getTotalLength(); i < length; i++) {
        const point = path.getPointAtLength(i);
        if (Math.abs(point.x - (shape.width / 2 + 20)) < 1.1) ys.push(point.y);
      }
      return [Math.min(...ys) - 20, shape.height + 20 - Math.max(...ys)];
    });
    assert.ok(twoRims.every(depth => depth > 1), `both rims bend inward at once: ${twoRims}`);
    await page.evaluate(() => {
      const card = document.createElement('div');
      card.id = 'distanceCard';
      card.className = 'card';
      card.style.cssText = 'position:fixed;left:1140px;top:475px;width:250px;height:125px;z-index:8';
      const search = document.createElement('input');
      search.id = 'distanceSearch';
      search.className = 'comparison-search';
      search.style.cssText = 'position:fixed;left:1140px;top:656px;width:250px;height:40px;z-index:8';
      document.body.append(card, search);
    });
    for (const y of [636, 671]) {
      await page.mouse.move(1265, y);
      await page.waitForTimeout(650);
      const [card, search] = await page.evaluate(() => ['distanceCard', 'distanceSearch'].map(id =>
        Math.abs(GlassInteraction.readEdge(document.getElementById(id))?.depth || 0)));
      assert.ok(search > card && search > 1, `the nearer search responds more than the distant card at y=${y}: ${search} vs ${card}`);
    }
    await page.evaluate(() => ['distanceCard', 'distanceSearch'].forEach(id => document.getElementById(id).remove()));
    await page.locator('#btnOpenSettings').click();
    const attraction = page.getByRole('switch', { name: '鼠标吸引' });
    await page.locator('#mouseAttractionSetting .appearance-switch-track').click();
    assert.equal(await attraction.isChecked(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('cet6_mouse_attraction')), 'off');
    await page.keyboard.press('Escape');
    await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + 6);
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => GlassInteraction.readEdge()), null, 'the switch disables hover attraction immediately');
    await page.locator('#btnOpenSettings').click();
    assert.equal(await attraction.isChecked(), false, 'the setting is retained when reopening settings');
    await attraction.press('Space');
    assert.equal(await attraction.isChecked(), true);
    await page.keyboard.press('Escape');

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
    const restingClip = await page.locator('.interaction-fixture').evaluate(card => getComputedStyle(card, '::before').clipPath);
    const [compressed,rebound] = await page.evaluate(async () => {
      const capture = () => new Promise(resolve => {
        GlassRenderer.render();requestAnimationFrame(() => {
          const source=document.querySelector('.glass-wallpaper-canvas'),copy=document.createElement('canvas');
          copy.width=source.width;copy.height=source.height;const ctx=copy.getContext('2d');ctx.drawImage(source,0,0);
          const box=source.getBoundingClientRect(),sx=source.width/box.width,sy=source.height/box.height;
          const card = document.querySelector('.interaction-fixture');
          const { x, y, width, height } = card.getBoundingClientRect();
          const style = getComputedStyle(card, '::before');
          const material = { content: style.content, background: style.backgroundImage, scale: style.scale,
            transform: style.transform, animation: style.animationName };
          const clipId = style.clipPath.match(/#([^"')]+)/)?.[1];
          const contour = clipId ? document.getElementById(clipId)?.querySelector('path')?.getAttribute('d') : style.clipPath;
          resolve({
            pixels: Array.from(ctx.getImageData(Math.round((555-box.left)*sx),Math.round((385-box.top)*sy),Math.round(90*sx),Math.round(90*sy)).data),
            material, contour, bounds: { x, y, width, height }, clickTarget: document.elementFromPoint(600, 430) === card,
            separateRim: getComputedStyle(card, '::after').content, fixedShadow: getComputedStyle(card).boxShadow
          });
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
    assert.ok(difference(compressed.pixels,rebound.pixels) > .2, 'click must produce a changing spring refraction');
    for (const phase of [compressed, rebound]) {
      assert.notEqual(phase.material.content, 'none', 'the card material remains drawn through the spring');
      assert.notEqual(phase.material.background, 'none', 'the material layer carries the reflections');
      assert.equal(phase.separateRim, 'none', 'card reflections are not drawn as a separate edge layer');
      assert.equal(phase.fixedShadow, 'none', 'the old card boundary does not paint a stationary seam');
      assert.ok(phase.material.scale === 'none' && phase.material.transform === 'none' && phase.material.animation === 'none',
        `card material follows the contour through the spring: ${JSON.stringify(phase.material)}`);
      assert.ok(phase.contour && phase.contour !== 'none', 'click temporarily reshapes the actual card contour');
      assert.deepEqual(phase.bounds, box, 'hit target does not wobble with the optical surface');
      assert.equal(phase.clickTarget, true, 'a card still receives the click at its original position');
    }
    assert.notEqual(compressed.contour, rebound.contour, 'compression and rebound deform the same contour in different ways');
    assert.equal(await page.locator('.interaction-fixture span').evaluate(e=>getComputedStyle(e).filter),'none');

    await page.locator('.interaction-fixture').evaluate(card => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-sm native-spring-fixture';
      button.textContent = 'Button spring';
      card.append(button);
    });
    const springButton = page.locator('.native-spring-fixture');
    const idleAnimation = await springButton.evaluate(button => getComputedStyle(button, '::after').animationName);
    await springButton.click();
    const activeAnimation = await springButton.evaluate(button => getComputedStyle(button, '::after').animationName);
    assert.notEqual(activeAnimation, idleAnimation, 'ordinary buttons retain their click spring');
    assert.notEqual(activeAnimation, 'none', 'the button spring paints an animated layer');
    await springButton.evaluate(button => button.remove());

    await page.locator('.interaction-fixture').dispatchEvent('pointerout', { relatedTarget:null,bubbles:true });
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('.interaction-fixture').evaluate(card => getComputedStyle(card, '::before').clipPath), restingClip,
      'the shared click contour returns to rest');
    const draws = await page.evaluate(()=>GlassRenderer.getState().draws);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>GlassRenderer.getState().draws),draws,'interaction must settle back to idle');
    await checkModalHover();
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
    await page.evaluate(()=>{GlassRenderer.destroy();window.GlassRenderer=null;LiquidGlass.refresh()});
    await page.locator('#btnOpenSettings').click();await page.waitForTimeout(500);
    await page.locator('#modalSettings').dispatchEvent('pointermove',{clientX:650,clientY:350,pointerType:'mouse',bubbles:true});
    await page.waitForTimeout(350);
    assert.ok(await page.locator('[data-interactive]').count()>0,'native modal creates a local pressure field');
    await page.locator('#modalSettings').dispatchEvent('pointerout',{relatedTarget:null,bubbles:true});
    await page.waitForTimeout(950);
    assert.equal(await page.locator('[data-interactive]').count(),0,'native pressure field is released on leave');
    await page.keyboard.press('Escape');
    await checkModalHover();
    await page.emulateMedia({ reducedMotion:'reduce' });
    await page.locator('.interaction-fixture').dispatchEvent('click',{clientX:600,clientY:430,bubbles:true,detail:1});
    assert.equal(await page.locator('.glass-jelly').count(),0,'reduced motion suppresses jelly');
    assert.deepEqual(errors,[]);
    console.log('PASS: local hover deformation, magnetic outside edge, nested modal scroll, click spring, sharp text, stable hit target, settling and reduced motion');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
