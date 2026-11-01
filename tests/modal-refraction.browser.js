const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>{Appearance.set('glass');Appearance.setTheme('aurora');LiquidGlass.enable({persist:false})});
  await page.waitForTimeout(600);
  for(const id of ['modalSettings','modalVocabFav','modalRestorePage','modalImportChoice']){
   const immediate=await page.evaluate(id=>{
    openModal(document.getElementById(id),true);
    const modal=document.getElementById(id),canvas=modal.querySelector('.glass-modal-canvas');
    const style=getComputedStyle(modal,'::before');
    return {canvas:!!canvas,width:canvas?.width,filter:style.filter,blur:style.backdropFilter,textFilter:getComputedStyle(modal).filter};
   },id);
   assert.ok(immediate.canvas&&immediate.width>0,id+' uses the card renderer before its first paint');
   assert.equal(immediate.filter,'none','do not distort a decorative gradient in place of the wallpaper');
   assert.equal(immediate.blur,'none','the modal plate stays as clear as page cards');
   assert.equal(immediate.textFilter,'none','modal text stays sharp');
   const diff=await page.evaluate(()=>{
    const capture=()=>{
     GlassRenderer.flush();
     const canvas=document.querySelector('.modal-card.active .glass-modal-canvas');
     return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    };
    const curved=capture();GlassRenderer.setIntensity(0);const flat=capture();
    GlassRenderer.setIntensity(1);
    return curved.reduce((sum,v,i)=>sum+(i%4===3?0:Math.abs(v-flat[i])),0)/(curved.length*.75);
   });
   assert.ok(diff>.1,id+' must bend real wallpaper pixels, observed '+diff);
   await page.evaluate(()=>{GlassRenderer.setIntensity(1);closeModal();LiquidGlass.flush()});
   assert.equal(await page.locator('.glass-modal-canvas').count(),0,'closed modal releases its canvas');
  }
  await page.evaluate(()=>Appearance.openSettings());
  await page.waitForTimeout(650);
  const hoverBefore=await page.evaluate(()=>{
   const canvas=document.querySelector('#modalSettings .glass-modal-canvas');
   window.modalPixelFixture=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
   return GlassRenderer.getState().draws;
  });
  await page.locator('#modalSettings').dispatchEvent('pointermove',{clientX:700,clientY:260,pointerType:'mouse',bubbles:true});
  await page.waitForTimeout(350);
  const hover=await page.evaluate(()=>{
   const canvas=document.querySelector('#modalSettings .glass-modal-canvas'),before=window.modalPixelFixture;
   const after=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
   delete window.modalPixelFixture;
   return {draws:GlassRenderer.getState().draws,diff:before.reduce((sum,v,i)=>sum+Math.abs(v-after[i]),0)/before.length};
  });
  assert.ok(hover.draws>hoverBefore&&hover.diff>.001,'modal hover changes the visible GPU optical layer: '+JSON.stringify(hover));
  await page.locator('#modalSettings').dispatchEvent('pointerout',{relatedTarget:null,bubbles:true});
  await page.waitForTimeout(650);
  fs.mkdirSync(path.resolve(__dirname,'../.gstack/modal-clear'),{recursive:true});
  await page.screenshot({path:path.resolve(__dirname,'../.gstack/modal-clear/settings.png')});
  await page.evaluate(()=>{
   closeModal();
   setVFavs(Array.from({length:12},(_,i)=>({id:'modal-test-'+i,word:'glass'+i,meaning:'透明玻璃',pos:'n.'})));
   renderVFavs();openModal(document.getElementById('modalVocabFav'),true);
  });
  await page.waitForTimeout(300);
  const scroll=await page.evaluate(async()=>{
   const modal=document.getElementById('modalVocabFav'),canvas=modal.querySelector('.glass-modal-canvas');
   const header=modal.querySelector('.modal-header'),height=Math.floor(header.getBoundingClientRect().height*canvas.height/modal.getBoundingClientRect().height);
   const before=canvas.getContext('2d').getImageData(0,0,canvas.width,height).data;
   const draws=GlassRenderer.getState().draws;
   document.getElementById('wordFavPanel').scrollTop=170;
   await new Promise(resolve=>setTimeout(resolve,150));
   const after=canvas.getContext('2d').getImageData(0,0,canvas.width,height).data;
   return {draws:GlassRenderer.getState().draws-draws,headerDiff:before.reduce((sum,v,i)=>sum+Math.abs(v-after[i]),0)/before.length};
  });
  assert.ok(scroll.draws>0,'scrolling a modal body updates the shared lenses');
  assert.ok(scroll.headerDiff<.05,'scrolled row lenses stay clipped to the body and cannot corrupt the header: '+JSON.stringify(scroll));
  const popupClip=await page.evaluate(()=>{
   const pane=document.getElementById('wordFavPanel'),modal=document.getElementById('modalVocabFav');
   pane.scrollTop=0;
   const menu=pane.querySelector('.more-menu');menu.style.animation='none';menu.classList.add('open');
   const button=menu.querySelector('button');
   pane.scrollTop=button.getBoundingClientRect().bottom-pane.getBoundingClientRect().top+12;
   const r=button.getBoundingClientRect(),p=modal.getBoundingClientRect();
   const canvas=modal.querySelector('.glass-modal-canvas'),sx=canvas.width/p.width,sy=canvas.height/p.height;
   const capture=()=>{GlassRenderer.flush();return canvas.getContext('2d').getImageData((r.left-p.left)*sx,(r.top-p.top)*sy,r.width*sx,r.height*sy).data};
   const before=capture();menu.classList.remove('open');const after=capture();
   return {clipped:r.bottom<pane.getBoundingClientRect().top,diff:before.reduce((sum,v,i)=>sum+Math.abs(v-after[i]),0)/before.length};
  });
  assert.ok(popupClip.clipped&&popupClip.diff<.02,'an off-pane menu cannot leave glass on the tabs: '+JSON.stringify(popupClip));
  await page.screenshot({path:path.resolve(__dirname,'../.gstack/modal-clear/favorites.png')});
  await page.evaluate(()=>Appearance.set('classic'));
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.glass-modal-canvas').count(),0,'classic does not keep a glass modal canvas');
  await page.evaluate(()=>{Appearance.set('glass');LiquidGlass.enable({persist:false})});await page.waitForTimeout(300);
  await page.setViewportSize({width:600,height:900});await page.waitForTimeout(350);
  assert.equal(await page.locator('.glass-modal-canvas').count(),0,'small screens use native refraction');
  assert.match(await page.locator('#modalSettings').evaluate(el=>getComputedStyle(el,'::before').backdropFilter),/blur\(4px\)/,'mobile keeps the established lightweight glass fallback');
  const native=await browser.newPage({viewport:{width:1440,height:1000}});
  await native.addInitScript(()=>{
   const original=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'||type==='webgl2'?null:original.call(this,type,...args)};
  });
  await native.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await native.evaluate(()=>{Appearance.set('glass');Appearance.setTheme('aurora');LiquidGlass.enable({persist:false});Appearance.openSettings()});
  assert.equal(await native.locator('.glass-modal-canvas').count(),0);
  assert.match(await native.locator('#modalSettings').evaluate(el=>getComputedStyle(el,'::before').filter),/cet6-liquid-refract/,'WebGL unavailable retains native refraction');
  await native.close();
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{Appearance.setTheme('water');Appearance.openSettings()});
  await page.waitForTimeout(650);
  const water=await page.evaluate(async()=>{
   const canvas=document.querySelector('#modalSettings .glass-modal-canvas'),ctx=canvas.getContext('2d');
   const before=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   await new Promise(resolve=>setTimeout(resolve,140));
   const after=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   return before.reduce((sum,v,i)=>sum+Math.abs(v-after[i]),0)/before.length;
  });
  assert.ok(water>.01,'modal wallpaper follows the existing water animation: '+water);
  await page.screenshot({path:path.resolve(__dirname,'../.gstack/modal-clear/water-settings.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: all four modals share card refraction, real wallpaper pixels, sharp text, first paint and lifecycle');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
