const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>document.startViewTransition=undefined); // Legacy fallback.
  await page.evaluate(()=>{GlassWallpaper.motionFor=()=>null; // Isolate control and card motion.
   Appearance.set('glass');Appearance.setTheme('aurora');LiquidGlass.enable({persist:false});
   setVFavs(Array.from({length:12},(_,i)=>({id:'motion-'+i,word:'word'+i,meaning:'释义 '+i})));renderVFavs();
   openModal(document.getElementById('modalVocabFav'),true);
  });
  await page.waitForTimeout(650);
  const slider=page.locator('#favoriteStudyTabs .ws-mode-slider');
  assert.match(await slider.evaluate(el=>getComputedStyle(el).transitionProperty),/translate|transform/,'capsule movement runs as a composited translation');
  await page.evaluate(()=>{
   const slider=document.querySelector('#favoriteStudyTabs .ws-mode-slider');
   slider.dispatchEvent(new TransitionEvent('transitionrun',{propertyName:'translate',bubbles:true}));
  });
  await page.waitForTimeout(50);
  const before=await page.evaluate(()=>{
   document.getElementById('btnStudyExport').dispatchEvent(new TransitionEvent('transitionend',{propertyName:'scale',bubbles:true}));
   return GlassRenderer.getState().draws;
  });
  await page.waitForTimeout(120);
  assert.ok(await page.evaluate(n=>GlassRenderer.getState().draws>n+2,before),'an unrelated transition ending cannot freeze capsule refraction');
  await page.evaluate(()=>{
   closeModal();
   const card=document.querySelector('.word-search-wrapper');
   card._wordData={word:'accountability',definitions:['n. 问责','n. 责任'],sentences:Array.from({length:4},(_,i)=>({en:'The committee requires a clear explanation of every decision and its consequences. '+i,cn:'委员会要求解释每项决定及其后果。'})),mnemonic:{breakdown:'account（交代）+ ability（能力）→ 问责'}};
   StudyToolsUI.renderStudyCard(card,{kind:'mnemonic',word:'accountability',mnemonic:card._wordData.mnemonic});
   const animate=card.animate.bind(card);
   card.animate=function(frames,options){
    const animation=animate(frames,options);
    if(frames.some(frame=>frame.height)){
     const motion={animation,from:parseFloat(frames[0].height),to:parseFloat(frames.at(-1).height)};window.heightMotion=motion;
     function sample(){
      const progress=animation.currentTime/animation.effect.getTiming().duration;
      if(progress>=.2)motion.sample={fraction:Math.abs(card.getBoundingClientRect().height-motion.from)/Math.abs(motion.to-motion.from),range:Math.abs(motion.to-motion.from),progress};
      else requestAnimationFrame(sample);
     }requestAnimationFrame(sample);
    }
    return animation;
   };
   card.querySelector('[data-study-action="flip"]').click();
  });
  await page.waitForFunction(()=>window.heightMotion?.sample);
  const growth=await page.evaluate(()=>heightMotion.sample);
  assert.ok(growth.range>100,'fixture has a real height difference');
  assert.ok(growth.fraction<growth.progress*1.6,'height change starts gently relative to elapsed time: '+JSON.stringify(growth));
  await page.waitForFunction(()=>!document.querySelector('.word-search-wrapper')._flipping);
  const footer=await page.evaluate(async()=>{
   const card=document.querySelector('.word-search-wrapper'),gaps=[];
   card.querySelector('[data-study-action="flip"]').click();
   await new Promise(resolve=>{
    function sample(){
     const actions=card.querySelector('.study-result-actions');
     if(actions&&card.classList.contains('is-resizing'))gaps.push(card.getBoundingClientRect().bottom-actions.getBoundingClientRect().bottom);
     if(card._flipping)requestAnimationFrame(sample);else resolve();
    }requestAnimationFrame(sample);
   });
   return {samples:gaps.length,drift:Math.max(...gaps)-Math.min(...gaps)};
  });
  assert.ok(footer.samples>3&&footer.drift<2,'save action follows the resizing bottom without appearing late: '+JSON.stringify(footer));
  assert.equal(await page.locator('.is-flipping,.is-resizing').count(),0,'animation cleanup returns the card to natural layout');
  assert.deepEqual(errors,[]);
  console.log('PASS: compositor capsule, overlapping transitions, smooth height onset and anchored action',JSON.stringify({growth,footer}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
