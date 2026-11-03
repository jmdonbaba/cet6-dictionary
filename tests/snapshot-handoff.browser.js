const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  for(const [dpr,zoom] of [[1,1],[1.25,1],[1.5,1],[2,1],[1.5,1.25]]){
   const page=await browser.newPage({viewport:{width:1100,height:900},deviceScaleFactor:dpr});
   await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
   await page.evaluate(zoom=>document.body.style.zoom=String(zoom),zoom);
   await page.evaluate(()=>{Appearance.set('glass');Appearance.setTheme('minimal');LiquidGlass.enable({persist:false});setVFavs(Array.from({length:3},(_,i)=>({id:'handoff-'+i,word:'accountability'+i,meaning:'责任；问责；应作解释的义务',definitions:['n. 问责'],examples:Array.from({length:4},()=>({en:'The committee requires a clear explanation of every decision and its consequences.',cn:'委员会要求解释每项决定及其后果。'})),mnemonic:{word:'accountability'+i,breakdown:'account + ability → 问责'}})));renderVFavs();openModal(document.getElementById('modalVocabFav'),true);document.querySelector('.vf-compact').click()});
   await page.addStyleTag({content:'.vf-compact,.vf-compact *{color:rgb(224,0,0)!important;-webkit-text-fill-color:rgb(224,0,0)!important}'});
   await page.waitForTimeout(500);
   for(const direction of ['to-memory','to-definition']){
    await page.evaluate(async()=>{const start=document.startViewTransition.bind(document);document.startViewTransition=function(...args){document.startViewTransition=start;return window.handoff=start(...args)};document.querySelector('.vf-flip').click();await handoff.ready;document.getAnimations().forEach(a=>{a.pause();a.currentTime=439.999})});
    const row=await page.locator('.vf-compact').nth(1).boundingBox();
    // Keep the screenshot inside the scrollport when the expanded face is long.
    const pane=await page.locator('#wordFavPanel').boundingBox();
    const clip={x:row.x,y:row.y,width:row.width,height:Math.min(row.height,pane.y+pane.height-row.y)};
    const endpoint=(await page.screenshot({clip})).toString('base64');
    await page.evaluate(async()=>{document.getAnimations().forEach(a=>a.play());await handoff.finished});
    await page.waitForTimeout(80);
    const live=(await page.screenshot({clip})).toString('base64');
    const difference=await page.evaluate(async images=>{const pixels=[];for(const encoded of images){const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+encoded)).blob()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);pixels.push(ctx.getImageData(0,0,canvas.width,canvas.height).data)}let sum=0;for(let i=0;i<pixels[0].length;i++)if(i%4!==3)sum+=Math.abs(pixels[0][i]-pixels[1][i]);return sum/(pixels[0].length*.75)},[endpoint,live]);
    assert.ok(difference<1,`DPR ${dpr}/zoom ${zoom}/${direction}: final frame must line up with the settled row, pixel difference ${difference}`);
    console.log('PASS:',dpr,zoom,direction,'handoff pixel difference',difference.toFixed(3));
   }
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
