const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>{Appearance.set('glass');Appearance.setTheme('aurora');LiquidGlass.enable({persist:false});setVFavs([{id:'focus',word:'focus',meaning:'焦点'}]);renderVFavs()});
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
  const selectors=['.word-search-input','#mnemonicInput','#compareLeft','#compareRight','#apiKeyInput','#favSearchInput','#comparisonSearch'];
  for(const selector of selectors){
   if(selector==='#favSearchInput')await page.evaluate(()=>openModal(document.getElementById('modalVocabFav'),true));
   if(selector==='#comparisonSearch')await page.evaluate(()=>StudyToolsUI.selectFavoriteTab('comparisons'));
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
   assert.deepEqual(focused,before,selector+': focus changes optics, not CSS fill, blur or text');
   assert.equal(focused.blur,'none');assert.equal(focused.filter,'none');assert.equal(focused.outline,'none');
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
  console.log('PASS: all seven input families focus through real refraction, restore on blur, keep sharp text and settle idly; native and mobile fallback covered');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
