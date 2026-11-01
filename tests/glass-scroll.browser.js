const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>{Appearance.set('glass');LiquidGlass.enable({persist:false});
   const holder=document.querySelector('#wordSearchModules');
   for(let i=0;i<100;i++){const card=document.createElement('div');card.className='card word-search-wrapper';card.style.height='380px';card.innerHTML='<div class="word-result" style="height:280px">word '+i+'</div>';holder.append(card);}
  });
  await page.waitForTimeout(600);
  const sample=await page.evaluate(async()=>{
   const gl=document.querySelector('.glass-wallpaper-canvas').getContext('webgl'),draw=gl.drawArrays.bind(gl);
   let painted=scrollY,stale=0,writes=0;
   gl.drawArrays=function(...args){painted=scrollY;return draw(...args)};
   const scroll=window.scrollTo.bind(window);
   window.scrollTo=function(...args){scroll(...args);writes++;queueMicrotask(()=>{if(Math.abs(painted-scrollY)>1)stale++})};
   const journey=edge=>new Promise((resolve,reject)=>{
    let previous=scrollY,maxStep=0,frames=0;const start=performance.now();
    document.querySelector(edge==='bottom'?'#btnJumpBottom':'#btnJumpTop').click();
    function tick(){maxStep=Math.max(maxStep,Math.abs(scrollY-previous));previous=scrollY;frames++;
     const target=edge==='top'?0:document.documentElement.scrollHeight-innerHeight;
     if(Math.abs(scrollY-target)<2&&frames>2)resolve({maxStep,frames});
     else if(performance.now()-start>10000)reject(new Error('scroll did not reach '+edge));else requestAnimationFrame(tick);
    }requestAnimationFrame(tick);
   });
   const bottom=await journey('bottom'),top=await journey('top');
   return {bottom,top,stale,writes,active:GlassRenderer.getState().active};
  });
  assert.ok(sample.bottom.maxStep<900*.65&&sample.top.maxStep<900*.65,'long jumps must retain overlapping viewports, observed '+JSON.stringify(sample));
  assert.ok(sample.writes>20,'glass navigation advances in frames instead of compositor-only scrolling');
  assert.equal(sample.stale,0,'every programmatic scroll position must be painted in the same task');
  assert.equal(sample.active,true);
  await page.locator('#btnJumpBottom').click();await page.waitForTimeout(150);await page.mouse.wheel(0,-120);await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>GlassRenderer.getState().scrolling),false,'manual wheel input cancels the journey');
  await page.waitForTimeout(1000); // Let the button's finite click spring finish.
  const draws=await page.evaluate(()=>GlassRenderer.getState().draws);await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>GlassRenderer.getState().draws),draws,'navigation returns to idle');
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
  assert.equal(await page.evaluate(()=>GlassRenderer.scrollTo(5000)),false,'a hidden glass canvas must let navigation use native scrolling');
  const prior=await page.evaluate(()=>scrollY);await page.locator('#btnJumpBottom').click();await page.waitForTimeout(300);
  assert.ok(await page.evaluate(y=>scrollY>y,prior),'reduced-transparency navigation still moves');
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  await cdp.send('Emulation.setEmulatedMedia',{features:[]});await page.waitForTimeout(500);
  await page.locator('#btnJumpBottom').click();await page.waitForTimeout(150);
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>GlassRenderer.getState().scrolling),false,'hiding the canvas mid-journey releases custom scrolling');
  console.log('PASS: 100-card top/bottom journeys, synchronized glass, overlapping viewports and manual cancellation',JSON.stringify(sample));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
