const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>{GlassWallpaper.motionFor=()=>null; // Keep the optical target fixed.
   Appearance.set('glass');Appearance.setTheme('aurora');LiquidGlass.enable({persist:false});setVFavs([{id:'focus',word:'focus',meaning:'焦点'}]);renderVFavs()});
  await page.waitForTimeout(600);
  const style=selector=>page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el);return {fill:s.backgroundColor,image:s.backgroundImage,shadow:s.boxShadow,blur:s.backdropFilter,filter:s.filter,border:s.borderTopColor,outline:s.outlineStyle}});
  const pixels=selector=>page.evaluate(selector=>new Promise(resolve=>{
   GlassRenderer.render();requestAnimationFrame(()=>{
    const input=document.querySelector(selector),source=input.closest('.modal-card')?.querySelector('.glass-modal-canvas')||document.querySelector('.glass-wallpaper-canvas');
    const box=source.getBoundingClientRect(),r=input.getBoundingClientRect(),sx=source.width/box.width,sy=source.height/box.height;
    const copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;const ctx=copy.getContext('2d');ctx.drawImage(source,0,0);
    resolve(Array.from(ctx.getImageData((r.left-box.left)*sx,(r.top-box.top)*sy,r.width*sx,r.height*sy).data));
   });
  }),selector);
  const diff=(a,b)=>a.reduce((sum,value,i)=>sum+(i%4===3?0:Math.abs(value-b[i])),0)/(a.length*.75);
  // Recover the lens's local magnification from a known grayscale ramp. This
  // distinguishes a convex rim from simply shifting the whole input harder.
  await page.evaluate(()=>{
   const input=document.createElement('input');input.className='comparison-search rim-fixture';input.setAttribute('aria-label','Rim optical fixture');
   input.style.cssText='position:fixed;left:360px;top:24px;width:600px;height:60px;border-radius:30px;margin:0;z-index:9999';document.body.append(input);
  });await page.waitForTimeout(400);
  await page.evaluate(()=>{
   const source=document.querySelector('.glass-wallpaper-canvas'),gl=source.getContext('webgl'),pattern=document.createElement('canvas');
   pattern.width=source.width;pattern.height=source.height;const ctx=pattern.getContext('2d'),sy=source.height/source.getBoundingClientRect().height;
   for(let y=0;y<pattern.height;y++){const v=Math.min(255,Math.round(y/sy*2));ctx.fillStyle=`rgb(${v},${v},${v})`;ctx.fillRect(0,y,pattern.width,1)}
   gl.activeTexture(gl.TEXTURE0);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,pattern);
  });
  const slope=async()=>{const data=await pixels('.rim-fixture');const width=await page.locator('.rim-fixture').evaluate(el=>Math.round(el.getBoundingClientRect().width));
   const green=y=>data[(y*width+Math.floor(width/2))*4+1];return {rim:(green(6)-green(2))/8,shoulder:(green(20)-green(16))/8,center:(green(32)-green(28))/8};};
  const restingRim=await slope();await page.locator('.rim-fixture').focus();await page.waitForTimeout(330);const focusedRim=await slope();
  assert.ok(focusedRim.rim<restingRim.rim*.65,'focus concentrates real magnification at the outside rim: '+JSON.stringify({restingRim,focusedRim}));
  assert.ok(focusedRim.rim<focusedRim.shoulder*.7&&Math.abs(focusedRim.center-1)<.15,'the convex rim must blend into an undistorted center');
  await page.locator('.rim-fixture').evaluate(el=>el.remove());
  const selectors=['.word-search-input','#mnemonicInput','#compareLeft','#compareRight','#sentenceInput','#sentenceQuestion','#apiKeyInput','#favSearchInput','#comparisonSearch','#sentenceSearch'];
  for(const selector of selectors){
   if(selector==='#favSearchInput')await page.evaluate(()=>openModal(document.getElementById('modalVocabFav'),true));
   if(selector==='#comparisonSearch')await page.evaluate(()=>StudyToolsUI.selectFavoriteTab('comparisons'));
   if(selector==='#sentenceSearch')await page.evaluate(()=>StudyToolsUI.selectFavoriteTab('sentences'));
   await page.locator(selector).first().scrollIntoViewIfNeeded();
   // A repeatable high-contrast backdrop lets modal blur and empty wallpaper
   // regions keep the same measurable optical signal.
   await page.evaluate(()=>{
    const source=document.querySelector('.glass-wallpaper-canvas'),gl=source.getContext('webgl'),pattern=document.createElement('canvas');
    pattern.width=source.width;pattern.height=source.height;const ctx=pattern.getContext('2d');
    ctx.fillStyle='#202050';ctx.fillRect(0,0,pattern.width,pattern.height);
    const extent=pattern.width+pattern.height;ctx.translate(pattern.width/2,pattern.height/2);ctx.rotate(Math.PI/4);ctx.fillStyle='#fff';
    for(let x=-extent;x<extent;x+=64)ctx.fillRect(x,-extent,32,extent*2);
    gl.activeTexture(gl.TEXTURE0);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,pattern);
   });
   await page.evaluate(()=>document.activeElement.blur());await page.waitForTimeout(350);
   const before=await style(selector),rest=await pixels(selector);
   await page.locator(selector).first().focus();await page.waitForTimeout(330);
   const focused=await style(selector),bent=await pixels(selector);
   assert.deepEqual(focused,{...before,outline:'solid'},selector+': focus adds an outline while retaining the clear optical plate');
   assert.equal(focused.blur,'none');assert.equal(focused.filter,'none');
   assert.ok(diff(rest,bent)>.08,selector+': real input refraction gets stronger, measured '+diff(rest,bent));
   await page.evaluate(()=>document.activeElement.blur());await page.waitForTimeout(350);
   assert.ok(diff(rest,await pixels(selector))<.03,selector+': blur restores the original optical field');
  }
  await page.waitForTimeout(500);const draws=await page.evaluate(()=>GlassRenderer.getState().draws);
  await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>GlassRenderer.getState().draws),draws,'settled focus does not keep repainting');
  await page.evaluate(()=>{closeModal();GlassRenderer.destroy();window.GlassRenderer=null;LiquidGlass.refresh()});await page.waitForTimeout(400);
  const input=page.locator('.word-search-input').first();
  const scale=()=>input.evaluate(el=>{const filter=document.querySelector(el.style.getPropertyValue('--glass-filter').match(/#[^)]+/)[0]);return +filter.querySelector('feDisplacementMap').getAttribute('scale')});
  const rest=await scale();await input.focus();await page.waitForTimeout(330);const focused=await scale();
  assert.ok(focused>rest*1.25,'native fallback focus also increases refraction');
  await input.blur();await page.waitForTimeout(330);assert.ok(Math.abs(await scale()-rest)<.01,'cached native filter restores its original strength');
  await page.setViewportSize({width:390,height:900});await page.waitForTimeout(400);
  assert.ok(await page.locator('.glass-input-optics').count()>0,'small screens keep only the small input lenses');
  assert.deepEqual(errors,[]);
  console.log('PASS: convex outer rim, flat center; all input families focus/restore with sharp text and idle settlement; native/mobile covered',JSON.stringify({restingRim,focusedRim}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
