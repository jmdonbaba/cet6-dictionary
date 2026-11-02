const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>{Appearance.set('glass');Appearance.setTheme('water');LiquidGlass.enable({persist:false})});
  await page.waitForTimeout(600);
  const out=path.resolve(__dirname,'../.gstack/glass-sections');fs.mkdirSync(out,{recursive:true});
  assert.equal(await page.locator('.study-toolbox.card').count(),0,'tools no longer share one outer card');
  assert.equal(await page.locator('.study-tool-form.card').count(),3,'each tool has its own glass card');
  const first=await page.locator('#mnemonicForm').boundingBox(),second=await page.locator('#comparisonForm').boundingBox();
  assert.ok(second.y-first.y-first.height>=12,'desktop tools have a visible gap');
  await page.locator('.study-toolbox').screenshot({path:path.join(out,'tools.png')});
  await page.evaluate(()=>{
   setVFavs([{id:'section-test',word:'endorse',meaning:'支持；认可',mnemonic:{word:'endorse',breakdown:'en-（在上）+ dorse（背部）→ 背书',parts:[{part:'dorse',source:'词根 dors-：背部'}]},forms:'第三人称单数 endorses；现在分词 endorsing',examples:[{en:'The committee endorsed the proposal.',cn:'委员会支持该提案。'}]}]);
   renderVFavs();openModal(document.getElementById('modalVocabFav'),true);
  });
  await page.locator('.vf-compact').click();await page.waitForTimeout(300);
  const detail=page.locator('.vf-detail.open');
  assert.equal(await detail.locator('.study-breakdown').count(),0,'detail starts on definitions');
  assert.equal(await detail.locator('.vf-forms').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px','remove the dashed separator');
  assert.equal(await detail.evaluate(el=>el.matches(GlassOptics.layers)),true,'keep the complete outer detail plate');
  assert.equal(await detail.locator('*').evaluateAll(items=>items.filter(el=>el.matches(GlassOptics.layers)).length),0,'each face uses one continuous detail plate');
  assert.equal(await detail.locator('[data-act="flipvfav"]').count(),1,'saved memory is available on the reverse face');
  await page.screenshot({path:path.join(out,'details.png')});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1000,height:900});await page.waitForTimeout(250);
  const tablet=await page.locator('.study-tool-form').evaluateAll(items=>items.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top}}));
  assert.ok(Math.abs(tablet[0].top-tablet[1].top)<1&&tablet[1].left-tablet[0].right>=12,'tablet tools form two separate columns');
  await page.setViewportSize({width:390,height:900});await page.waitForTimeout(250);
  await page.locator('#comparisonToolTab').click();await page.waitForTimeout(500);
  assert.equal(await page.locator('#comparisonToolTab').getAttribute('aria-selected'),'true');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile remains within the viewport');
  assert.deepEqual(errors,[]);
  console.log('PASS: separate tool cards, one detail plate per face, no dividers and responsive tools');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
