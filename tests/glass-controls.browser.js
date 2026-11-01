const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>{Appearance.set('glass');Appearance.setTheme('water');LiquidGlass.enable({persist:false})});await page.waitForTimeout(700);
  const modes=page.locator('.ws-mode-toggle').first();
  const colors=()=>modes.locator('button').evaluateAll(items=>items.map(e=>getComputedStyle(e).color));
  const initialColors=await colors();assert.equal(initialColors[0],initialColors[1],'mode labels have the same color');
  await modes.locator('button').last().click();await page.waitForTimeout(400);
  const selectedColors=await colors();assert.equal(selectedColors[0],selectedColors[1],'switching only moves the capsule');
  for(const selector of ['.word-search-input','#mnemonicInput','.ws-mode-slider','.btn-favorite','#btnOpenSettings']){
   const element=page.locator(selector).first();if(!await element.count())continue;
   assert.equal(await element.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)',selector+' has no white fill');
  }
  assert.ok(await page.evaluate(()=>GlassRenderer.getState().controls>=1),'the slider control still uses the GPU lens');
  const input=page.locator('.word-search-input').first();
  assert.match(await input.evaluate(e=>getComputedStyle(e).backgroundImage),/linear-gradient/,'search inputs keep the CSS glass tint');
  await page.evaluate(()=>Appearance.setTheme('aurora'));await page.waitForTimeout(450);
  const inputCanvas=()=>page.evaluate(()=>new Promise(resolve=>{GlassRenderer.render();requestAnimationFrame(()=>{
   const source=document.querySelector('.glass-wallpaper-canvas'),box=source.getBoundingClientRect(),r=document.querySelector('.word-search-input').getBoundingClientRect();
   const copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;const ctx=copy.getContext('2d');ctx.drawImage(source,0,0);
   const sx=source.width/box.width,sy=source.height/box.height;resolve(Array.from(ctx.getImageData((r.left-box.left)*sx,(r.top-box.top)*sy,r.width*sx,r.height*sy).data));
  })}));
  const inputBefore=await inputCanvas();
  await page.evaluate(()=>GlassRenderer.setControlIntensity(0));const inputAfter=await inputCanvas();
  const inputDiff=inputBefore.reduce((sum,v,i)=>sum+(i%4===3?0:Math.abs(v-inputAfter[i])),0)/(inputAfter.length*.75);
  assert.ok(inputDiff<.05,'text inputs no longer use a displacement lens (avoids the seam), observed '+inputDiff);
  await page.evaluate(()=>GlassRenderer.setControlIntensity(1));
  await page.locator('#btnOpenVocabFav').click();await page.waitForTimeout(350);
  const close=await page.locator('#modalVocabFav .modal-close').boundingBox();assert.ok(Math.abs(close.width-close.height)<.1,'favorite close target is square');await page.keyboard.press('Escape');
  await page.evaluate(()=>{GlassRenderer.destroy();window.GlassRenderer=null;Appearance.openSettings();const host=document.createElement('div');host.className='input-area input-native-fixture';host.innerHTML='<input aria-label="Native glass test" value="clear text">';document.querySelector('#modalSettings .modal-body').prepend(host);LiquidGlass.refresh()});
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.input-native-fixture input').evaluate(e=>getComputedStyle(e).filter),'none','input text is never displaced');
  assert.notEqual(await page.locator('.input-native-fixture .glass-input-optics').evaluate(e=>getComputedStyle(e).filter),'none','native input owns a separate optical background');
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
  assert.equal(await page.locator('.input-native-fixture .glass-input-optics').evaluate(e=>getComputedStyle(e).filter),'none','reduced transparency disables even the inline native input filter');
  assert.equal(await page.locator('.input-native-fixture .glass-input-optics').evaluate(e=>getComputedStyle(e).backdropFilter),'none');
  await cdp.send('Emulation.setEmulatedMedia',{features:[]});
  await page.evaluate(()=>LiquidGlass.disable({persist:false}));assert.equal(await page.locator('.glass-input-optics').count(),0);
  assert.equal(await page.locator('.glass-input-host').count(),0,'disabling releases input host styles');
  assert.deepEqual(errors,[]);console.log('PASS: transparent buttons/inputs, sliding capsule, CSS-glass text inputs without lens seam, native modal input refraction, square close');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
