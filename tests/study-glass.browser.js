const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>{
   Appearance.set('glass');Appearance.setTheme('aurora');LiquidGlass.enable({persist:false});
   StudyToolsUI.renderStudyCard(document.querySelector('.word-search-wrapper'),{kind:'mnemonic',word:'accountability',mnemonic:{breakdown:'account（账目）+ able（能）→ 问责'}});
  });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.word-search-result').first().evaluate(el=>el.matches(GlassOptics.layers)),false,'mnemonic content shares its outer card instead of another glass plate');
  assert.equal(await page.evaluate(()=>GlassRenderer.getState().layers),0);
  await page.evaluate(()=>{
   setVFavs(Array.from({length:12},(_,i)=>({id:'study-glass-'+i,word:'word'+i,meaning:'释义 '+i,pos:'n.'})));
   renderVFavs();openModal(document.getElementById('modalVocabFav'),true);
  });
  await page.waitForTimeout(700);
  const tabs=page.locator('#favoriteStudyTabs');
  assert.equal(await tabs.locator('.ws-mode-slider').count(),1,'favorites reuses the real search-mode capsule');
  assert.equal(await tabs.evaluate(el=>getComputedStyle(el,'::before').content),'none','no second pseudo capsule');
  const initialColors=await tabs.locator('button').evaluateAll(items=>items.map(el=>getComputedStyle(el).color));
  assert.equal(initialColors[0],initialColors[1],'glass tab selection is conveyed by the capsule');
  const work=await page.evaluate(async()=>{
   const child=document.querySelector('#comparisonFavList').firstChild;
   let reads=0,maps=0;
   const get=getVFavs,put=CanvasRenderingContext2D.prototype.putImageData;
   window.getVFavs=function(...args){reads++;return get(...args)};
   CanvasRenderingContext2D.prototype.putImageData=function(...args){maps++;return put.apply(this,args)};
   const start=performance.now();document.getElementById('comparisonFavoritesTab').click();const handler=performance.now()-start;
   await new Promise(resolve=>setTimeout(resolve,500));
   window.getVFavs=get;CanvasRenderingContext2D.prototype.putImageData=put;
   return {reads,maps,handler,sameList:child===document.querySelector('#comparisonFavList').firstChild};
  });
  assert.equal(work.reads,0,'changing tabs does not reload unchanged favorites or rebuild study-button state');
  assert.equal(work.maps,0,'GPU tab changes do not generate unused native displacement maps');
  assert.equal(work.sameList,true,'tab changes preserve the rendered comparison list');
  assert.equal(await page.locator('#comparisonFavoritesTab').getAttribute('aria-selected'),'true');
  const aligned=()=>tabs.evaluate(el=>{
   const a=el.querySelector('button[aria-selected="true"]').getBoundingClientRect(),b=el.querySelector('.ws-mode-slider').getBoundingClientRect();
   return Math.abs(a.left-b.left)<1&&Math.abs(a.width-b.width)<1;
  });
  assert.equal(await aligned(),true,'capsule finishes at the selected tab');
  await page.locator('#comparisonFavoritesTab').focus();await page.keyboard.press('ArrowLeft');await page.waitForTimeout(400);
  assert.equal(await page.locator('#wordFavoritesTab').getAttribute('aria-selected'),'true');
  const first=await page.locator('#wordFavoritesTab').boundingBox(),second=await page.locator('#comparisonFavoritesTab').boundingBox();
  await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();
  await page.mouse.move(second.x+second.width/2,second.y+second.height/2,{steps:8});await page.mouse.up();await page.waitForTimeout(450);
  assert.equal(await page.locator('#comparisonFavoritesTab').getAttribute('aria-selected'),'true','shared capsule supports dragging');
  assert.equal(await aligned(),true);
  await page.setViewportSize({width:390,height:900});await page.waitForTimeout(500);
  assert.equal(await aligned(),true,'capsule fits the active tab when the open modal becomes narrow');
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(500);
  assert.equal(await aligned(),true,'capsule fits again after returning to desktop');
  await page.evaluate(()=>{closeModal();const card=document.querySelector('.word-search-wrapper');renderWordResult(card,card.querySelector('.word-search-result'),'accountability',{word:'accountability',definitions:['n. 问责'],mnemonic:{breakdown:'account + able → 问责'}})});
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>GlassRenderer.getState().layers),1,'the definition face retains its normal result plate');
  assert.deepEqual(errors,[]);
  console.log('PASS: single mnemonic plate, shared draggable capsule and tab changes without rebuilding',JSON.stringify(work));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
