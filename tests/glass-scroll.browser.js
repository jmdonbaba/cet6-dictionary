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
   const scroll=window.scrollTo.bind(window),calls=[];
   window.scrollTo=function(options){calls.push({top:options.top,behavior:options.behavior});return scroll(options)};
   const journey=edge=>new Promise((resolve,reject)=>{
    let previous=scrollY,maxStep=0,frames=0,movingFrames=0;const start=performance.now();
    const before=calls.length,draws=GlassRenderer.getState().draws;
    document.querySelector(edge==='bottom'?'#btnJumpBottom':'#btnJumpTop').click();
    function tick(){const step=Math.abs(scrollY-previous);maxStep=Math.max(maxStep,step);if(step>0)movingFrames++;previous=scrollY;frames++;
     const target=edge==='top'?0:document.documentElement.scrollHeight-innerHeight;
     if(Math.abs(scrollY-target)<2&&frames>2)resolve({maxStep,frames,movingFrames,calls:calls.slice(before),draws:GlassRenderer.getState().draws-draws});
     else if(performance.now()-start>10000)reject(new Error('scroll did not reach '+edge));else requestAnimationFrame(tick);
    }requestAnimationFrame(tick);
   });
   const bottom=await journey('bottom'),top=await journey('top');
   return {bottom,top,active:GlassRenderer.getState().active};
  });
  for(const [edge,result] of Object.entries({bottom:sample.bottom,top:sample.top})){
   assert.equal(result.calls.length,1,edge+' must use one native scroll request, without per-frame speed limits');
   assert.equal(result.calls[0].behavior,'smooth',edge+' retains the browser acceleration and deceleration');
   assert.ok(result.movingFrames>3,edge+' animates rather than jumping instantly');
   assert.ok(result.draws>1,'glass continues repainting during native scrolling');
  }
  assert.equal(sample.active,true);
  await page.waitForTimeout(1000); // Let the button's finite click spring finish.
  const draws=await page.evaluate(()=>GlassRenderer.getState().draws);await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>GlassRenderer.getState().draws),draws,'navigation returns to idle');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#btnJumpBottom').click();
  await page.waitForFunction(()=>Math.abs(scrollY-(document.documentElement.scrollHeight-innerHeight))<2);
  await page.locator('#btnJumpTop').click();
  await page.waitForFunction(()=>scrollY<2);
  console.log('PASS: native 100-card top/bottom journeys, glass repainting, idle and reduced motion',JSON.stringify(sample));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
