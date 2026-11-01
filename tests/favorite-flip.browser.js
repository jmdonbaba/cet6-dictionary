const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let requests=0;page.on('request',request=>{if(request.url().includes('api.deepseek.com'))requests++});
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>{
   Appearance.set('glass');Appearance.setTheme('aurora');LiquidGlass.enable({persist:false});
   setVFavs([{id:'has-memory',word:'endorse',meaning:'支持；认可',definitions:['v. 支持；认可','v. 背书'],forms:'第三人称单数 endorses',examples:[{en:'They endorsed the proposal.',cn:'他们支持该提案。'}],mnemonic:{word:'endorse',breakdown:'en- + dorse → 背书',parts:[{part:'dorse',source:'词根：背'}]}},{id:'plain',word:'plain',meaning:'简单的',definitions:'legacy definition field'}]);
   renderVFavs();openModal(document.getElementById('modalVocabFav'),true);
  });
  await page.waitForTimeout(500);
  const stored=await page.evaluate(()=>localStorage.getItem('cet6_vocab_favorites'));
  await page.locator('[data-vfavid="has-memory"]').click();await page.waitForTimeout(250);
  const detail=page.locator('#vfDetail0'),flip=detail.locator('[data-act="flipvfav"]');
  assert.equal(await flip.count(),1,'a saved mnemonic gets a flip button');
  assert.equal(await detail.locator('.vf-def').count(),2,'favorites open on complete definitions');
  assert.equal(await detail.locator('.study-breakdown').count(),0,'memory is not shown alongside definitions');
  await flip.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.getElementById('vfDetail0').dataset.face==='memory'&&!document.getElementById('vfDetail0')._flipping);
  assert.equal(await detail.locator('.vf-def,.vf-forms,.vf-sen').count(),0);
  assert.match(await detail.locator('.study-breakdown').textContent(),/en- \+ dorse/);
  assert.match(await flip.textContent(),/单词释义/);
  assert.equal(await flip.evaluate(el=>document.activeElement===el),true,'keyboard focus follows the new face');
  await flip.click();await page.waitForFunction(()=>document.getElementById('vfDetail0').dataset.face==='definition'&&!document.getElementById('vfDetail0')._flipping);
  assert.equal(await detail.locator('.vf-def').count(),2);
  await page.locator('[data-vfavid="plain"]').click();
  assert.equal(await page.locator('#vfDetail1 [data-act="flipvfav"]').count(),0,'no mnemonic means no flip button');
  assert.equal(await page.locator('#vfDetail1 .vf-def').textContent(),'简单的','malformed legacy definitions fall back to meaning');
  for (const delay of [50, 250]) {
   await flip.click();await page.waitForTimeout(delay);
   await page.evaluate(()=>{closeModal();openModal(document.getElementById('modalVocabFav'),true)});
   await page.waitForTimeout(600);
   assert.equal(await detail.getAttribute('data-face'),'definition','reopening starts with definitions even if a flip was interrupted');
   assert.equal(await page.locator('.vf-detail.is-flipping,.vf-detail.is-resizing').count(),0);
   assert.equal(await page.locator('#modalVocabFav').evaluate(el=>el.getAnimations().length),0,'closing cancels the popup height motion too');
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem('cet6_vocab_favorites')),stored,'viewing either face never writes favorites');
  assert.equal(requests,0,'saved memory is reused without an API request');
  assert.deepEqual(errors,[]);
  console.log('PASS: definition-first favorite flips, conditional memory action, keyboard focus and interruption cleanup');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
