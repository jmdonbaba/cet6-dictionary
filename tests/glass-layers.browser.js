const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, ignoreDefaultArgs:['--hide-scrollbars'] });
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:900},deviceScaleFactor:1.25 });
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
    await page.addStyleTag({content:'html{overflow-y:scroll;scrollbar-gutter:stable both-edges}body{min-height:2400px}'});
    await page.evaluate(()=>{Appearance.set('glass');LiquidGlass.enable({persist:false});
      document.querySelector('.word-search-result').innerHTML='<div class="word-result" style="height:400px"><h2>refraction</h2><div class="word-forms">forms · 变形</div><div class="sentences"><div class="sen-item">A transparent glass layer.</div></div></div>';
    });
    await page.waitForTimeout(700);
    const alignment=await page.evaluate(()=>({box:document.querySelector('.glass-wallpaper-canvas').getBoundingClientRect().width,state:GlassRenderer.getState().width}));
    assert.ok(Math.abs(alignment.box-alignment.state)<.1,'refraction coordinates must use the actual canvas width including scrollbar gutters');
    assert.equal(await page.evaluate(()=>GlassRenderer.getState().layers),1,'the complete result must share one inner plate, without lenses around forms or examples');
    const styles=await page.locator('.word-result,.word-forms,.sen-item').evaluateAll(items=>items.map(e=>({bg:getComputedStyle(e).backgroundColor,shadow:getComputedStyle(e).boxShadow,border:getComputedStyle(e).borderColor})));
    assert.ok(styles.every(s=>s.bg==='rgba(0, 0, 0, 0)'&&s.shadow==='none'&&s.border==='rgba(0, 0, 0, 0)'),'nested glass layers must not use opaque white blocks');
    const capture=()=>page.evaluate(()=>new Promise(resolve=>{GlassRenderer.render();requestAnimationFrame(()=>{
      const source=document.querySelector('.glass-wallpaper-canvas'),copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;
      const ctx=copy.getContext('2d');ctx.drawImage(source,0,0);window.__glassSamples=window.__glassSamples||[];window.__glassSamples.push(ctx.getImageData(0,0,copy.width,copy.height).data);resolve(window.__glassSamples.length-1);
    })}));
    // Plain wallpaper: removing synthetic lighting means optical hover cannot paint a dark circle.
    await page.evaluate(()=>Appearance.setTheme('minimal'));await page.waitForTimeout(400);
    const before=await capture();
    const button=await page.locator('#btnJumpBottom').boundingBox();
    await page.locator('#btnJumpBottom').dispatchEvent('pointermove',{clientX:button.x+button.width/2,clientY:button.y+button.height/2,pointerType:'mouse',bubbles:true});
    await page.waitForTimeout(450);const hovered=await capture();
    const mean=(a,b)=>page.evaluate(([ai,bi])=>{const a=window.__glassSamples[ai],b=window.__glassSamples[bi];let sum=0;for(let i=0;i<a.length;i++)if(i%4!==3)sum+=Math.abs(a[i]-b[i]);return sum/(a.length*.75);},[a,b]);
    const regionMean=(a,b,region)=>page.evaluate(([ai,bi,r])=>{
      const a=window.__glassSamples[ai],b=window.__glassSamples[bi],canvas=document.querySelector('.glass-wallpaper-canvas'),box=canvas.getBoundingClientRect();
      const sx=canvas.width/box.width,sy=canvas.height/box.height;let sum=0,n=0;
      for(let y=Math.floor((r.y-box.top)*sy);y<Math.ceil((r.y+r.height-box.top)*sy);y++)for(let x=Math.floor((r.x-box.left)*sx);x<Math.ceil((r.x+r.width-box.left)*sx);x++){
        if(x<0||y<0||x>=canvas.width||y>=canvas.height)continue;const i=(y*canvas.width+x)*4;sum+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);n+=3;
      }return sum/n;
    },[a,b,region]);
    assert.ok(await regionMean(before,hovered,{x:button.x-25,y:button.y-25,width:button.width+50,height:button.height+50})<.05,'hover must not paint a fake shadow or extra circle on a plain background');
    await page.locator('#btnJumpBottom').dispatchEvent('pointerout',{relatedTarget:null,bubbles:true});await page.waitForTimeout(500);
    await page.evaluate(()=>Appearance.setTheme('water'));await page.waitForTimeout(600);
    const layered=await capture();
    await page.locator('.word-forms,.sen-item').evaluateAll(items=>items.forEach(e=>e.style.transform='translateY(28px)'));
    const movedSections=await capture();
    assert.ok(await mean(layered,movedSections)<.05,'moving internal sections must not break the continuous background refraction');
    await page.locator('.word-forms,.sen-item').evaluateAll(items=>items.forEach(e=>e.style.transform='none'));
    await page.locator('.word-forms').dispatchEvent('pointermove',{clientX:600,clientY:400,pointerType:'mouse',bubbles:true});
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>GlassInteraction.target()===document.querySelector('.word-result')),true,'forms hover belongs to the complete inner plate');
    await page.locator('.word-forms').dispatchEvent('pointerout',{relatedTarget:null,bubbles:true});await page.waitForTimeout(500);
    await page.evaluate(()=>GlassRenderer.setLayerIntensity(0));const flat=await capture();
    assert.ok(await mean(layered,flat)>.05,'the single inner plate must still refract the outer card background');
    await page.evaluate(()=>GlassRenderer.setLayerIntensity(1));
    await page.evaluate(()=>{
      document.querySelector('.container').style.display='none';
      const parent=document.createElement('div');parent.className='card clip-fixture';parent.style.cssText='position:fixed;left:420px;top:300px;width:420px;height:220px';
      parent.innerHTML='<div class="word-result" style="position:absolute;left:-40px;top:30px;width:240px;height:140px"></div>';document.body.append(parent);
    });
    await page.waitForTimeout(300);
    const parent=await page.locator('.clip-fixture').boundingBox();
    const clipped=await capture();await page.evaluate(()=>GlassRenderer.setLayerIntensity(0));const noLayers=await capture();
    assert.ok(await regionMean(clipped,noLayers,{x:parent.x-34,y:parent.y+50,width:28,height:70})<.05,'nested refraction cannot draw outside its parent glass');
    assert.ok(await regionMean(clipped,noLayers,{x:parent.x+10,y:parent.y+36,width:40,height:25})>.2,'the clipped child still refracts inside its parent');
    await page.evaluate(()=>GlassRenderer.setLayerIntensity(1));
    for(const width of [1280,1536]) {
      await page.setViewportSize({width,height:900});await page.waitForTimeout(250);
      assert.ok(await page.evaluate(()=>Math.abs(document.querySelector('.glass-wallpaper-canvas').getBoundingClientRect().width-GlassRenderer.getState().width)<.1));
    }
    await page.addStyleTag({content:'body{zoom:1.25}'});await page.waitForTimeout(250);
    assert.ok(await page.evaluate(()=>Math.abs(document.querySelector('.glass-wallpaper-canvas').getBoundingClientRect().width-GlassRenderer.getState().width)<.1),'CSS zoom also aligns the real canvas bounds');
    await page.evaluate(()=>{
      document.body.style.zoom='1';
      const modal=document.querySelector('#modalSettings');Appearance.openSettings();
      const layer=document.createElement('div');layer.className='word-result layer-modal-fixture';
      layer.innerHTML='<div class="word-forms">Transparent modal layer</div><div class="sentences"><div class="sen-item">One continuous plate.</div></div>';
      modal.querySelector('.modal-body').prepend(layer);LiquidGlass.refresh();
    });
    await page.waitForTimeout(400);
    assert.ok(await page.locator('.layer-modal-fixture').evaluate(e=>e.classList.contains('glass-layer-optics')&&getComputedStyle(e,'::before').filter!=='none'),'modal nested surfaces receive a native refraction filter');
    assert.equal(await page.locator('.layer-modal-fixture .glass-layer-optics').count(),0,'native modal also shares one result plate');
    await page.evaluate(()=>LiquidGlass.disable({persist:false}));
    assert.equal(await page.locator('.glass-layer-optics').count(),0,'disabling releases native nested lenses');
    assert.deepEqual(errors,[]);
    console.log('PASS: one continuous inner plate, scrollbar/DPR alignment, clipping and native modal fallback');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
