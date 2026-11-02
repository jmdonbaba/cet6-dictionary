const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>{Appearance.set('glass');Appearance.setTheme('water');LiquidGlass.enable({persist:false});window.motionWord={word:'accountability',definitions:['n. 问责','n. 责任'],sentences:Array.from({length:7},()=>({en:'The committee requires a clear explanation of every decision and its consequences.',cn:'委员会要求解释每项决定及其后果。'})),mnemonic:{word:'accountability',breakdown:'account + ability → 问责'}};const card=document.querySelector('.word-search-wrapper');card._wordData=motionWord;StudyToolsUI.renderStudyCard(card,{kind:'mnemonic',word:motionWord.word,mnemonic:motionWord.mnemonic});setVFavs(Array.from({length:12},(_,i)=>({...motionWord,id:'motion-'+i,word:i?'word'+i:motionWord.word,meaning:'问责',examples:motionWord.sentences,mnemonic:{...motionWord.mnemonic,word:i?'word'+i:motionWord.word}})));renderVFavs()});
  await page.waitForTimeout(800);
  for(const where of ['main','favorite-first','favorite-last']){
   if(where!=='main')await page.evaluate(last=>{closeModal();renderVFavs();openModal(document.getElementById('modalVocabFav'),true);const rows=document.querySelectorAll('.vf-compact'),row=rows[last?rows.length-1:0];row.click();row.scrollIntoView({block:'start'});document.getElementById('wordFavPanel').scrollTop=last?99999:0},where.endsWith('last'));
   await page.waitForTimeout(400);
   const motion=await page.evaluate(async where=>{
    const card=where==='main'?document.querySelector('.word-search-wrapper'):Array.from(document.querySelectorAll('.vf-detail')).find(el=>el.classList.contains('open'));
    const modal=card.closest('.modal-card'),canvas=modal?.querySelector('.glass-modal-canvas');let copies=0;let original;
    if(canvas){const ctx=canvas.getContext('2d');original=ctx.drawImage;ctx.drawImage=function(...args){copies++;return original.apply(this,args)}}
    const samples=[];card.querySelector(where==='main'?'[data-study-action="flip"]':'.vf-flip').click();
    await new Promise(resolve=>{function frame(){samples.push({height:card.offsetHeight,modal:modal?.offsetHeight,visual:parseFloat(getComputedStyle(document.documentElement,'::view-transition-group(study-turn)').height)});if(card._flipping)requestAnimationFrame(frame);else resolve()}requestAnimationFrame(frame)});
    if(canvas)canvas.getContext('2d').drawImage=original;
    return {frames:samples.length,heights:[...new Set(samples.map(s=>s.height))],modalHeights:[...new Set(samples.map(s=>s.modal))],visualHeights:[...new Set(samples.map(s=>s.visual).filter(Number.isFinite))],copies};
   },where);
   assert.ok(motion.frames>10,where+': real visible transition runs');
   assert.ok(motion.heights.length<=2&&motion.modalHeights.length<=2,where+': document layout changes once instead of every animation frame '+JSON.stringify(motion));
   assert.ok(motion.visualHeights.length>5,where+': compositor still interpolates visible height');
   assert.ok(motion.copies<=5,where+': no per-frame popup redraw '+motion.copies);
   assert.equal(await page.locator('[data-snapshot-turning],.card-motion-plate').count(),0,'snapshot state cleans up');
   console.log('PASS:',where,JSON.stringify({frames:motion.frames,layouts:motion.heights.length,copies:motion.copies}));
  }
  // Named snapshots live above the document and must retain the scroll pane's
  // clipping while the final layout clamps its scroll position.
  await page.evaluate(()=>{
   closeModal();Appearance.setTheme('minimal');renderVFavs();
   openModal(document.getElementById('modalVocabFav'),true);
   document.querySelectorAll('.vf-compact')[11].click();
   document.getElementById('wordFavPanel').scrollTop=99999;
  });
  await page.addStyleTag({content:'html[data-interface="glass"] #modalVocabFav :is(.vf-compact,.vf-detail),html[data-interface="glass"] #modalVocabFav :is(.vf-compact,.vf-detail) *{color:rgb(224,0,0)!important;-webkit-text-fill-color:rgb(224,0,0)!important}'});
  await page.waitForTimeout(350);
  const pane=await page.locator('#wordFavPanel').boundingBox();
  await page.evaluate(async()=>{
   const start=document.startViewTransition.bind(document);
   document.startViewTransition=function(...args){document.startViewTransition=start;return window.clipTransition=start(...args)};
   document.querySelector('#vfDetail11 .vf-flip').click();
   await clipTransition.ready;
   document.getAnimations().forEach(animation=>{
    if(animation.effect?.pseudoElement?.includes('view-transition')){animation.pause();animation.currentTime=260;}
   });
  });
  const screenshot=await page.screenshot();
  const ink=await page.evaluate(async([encoded,pane])=>{
   const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+encoded)).blob());
   const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   let outside=0,inside=0;
   for(let y=0;y<canvas.height;y++)for(let x=Math.ceil(pane.x);x<Math.floor(pane.x+pane.width);x++){
    const i=(y*canvas.width+x)*4;
    if(pixels[i]>pixels[i+1]+80&&pixels[i]>pixels[i+2]+80){
     if(y<pane.y-1||y>pane.y+pane.height+1)outside++;else inside++;
    }
   }
   return {outside,inside};
  },[screenshot.toString('base64'),pane]);
  assert.ok(ink.inside>20,'the paused frame contains visible snapshot text');
  assert.equal(ink.outside,0,'snapshot rows must stay inside their scrolling pane: '+JSON.stringify(ink));
  await page.evaluate(async()=>{
   document.getAnimations().forEach(animation=>{if(animation.effect?.pseudoElement?.includes('view-transition'))animation.play()});
   await clipTransition.finished;delete window.clipTransition;
  });
  assert.equal(await page.locator('[data-snapshot-turning],.card-motion-plate').count(),0,'clipped snapshots clean up after finishing');
  console.log('PASS: paused row snapshots retain scroll-panel clipping',JSON.stringify(ink));
  await page.evaluate(async()=>{
   const start=document.startViewTransition.bind(document);
   document.startViewTransition=function(...args){document.startViewTransition=start;return window.cancelTransition=start(...args)};
   document.querySelector('#vfDetail11 .vf-flip').click();await cancelTransition.ready;
   document.getAnimations().forEach(animation=>{if(animation.effect?.pseudoElement?.includes('view-transition')){animation.pause();animation.currentTime=130}});
   document.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100}));
  });
  assert.equal(await page.locator('[data-snapshot-turning]').count(),1,'synthetic wheel events do not interrupt normal snapshot work');
  await page.mouse.wheel(0,100);await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-snapshot-turning],.card-motion-plate').count(),0,'a real wheel gesture cancels viewport-fixed snapshots');
  assert.equal(await page.locator('[style*="study-follow-"],[style*="study-turn"],[style*="study-shell"]').count(),0,'manual cancellation restores transition names');
  console.log('PASS: real scrolling cancels snapshots and releases their state');
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
