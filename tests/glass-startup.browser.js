const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

function isWaterBlue(rgb) {
 return rgb[2]>rgb[1]+15&&rgb[1]>rgb[0];
}

async function visibleWallpaperColor(page) {
 const session = await page.context().newCDPSession(page);
 let data;
 try {
  // Capture the compositor while the image request is still blocked.
  ({data}=await session.send('Page.captureScreenshot',{format:'png',clip:{x:4,y:4,width:12,height:page.viewportSize().height-8,scale:1}}));
 } finally { await session.detach(); }
 return page.evaluate(async base64=>{
  const screenshot = new Image();
  screenshot.src = `data:image/png;base64,${base64}`;
  await screenshot.decode();
  const canvas = document.createElement('canvas');
  canvas.width = screenshot.width;
  canvas.height = screenshot.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(screenshot,0,0);
  const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const sums = [0,0,0];
  for(let i=0;i<pixels.length;i+=4) {
   for(let channel=0;channel<3;channel++) sums[channel]+=pixels[i+channel];
  }
  return sums.map(sum=>Math.round(sum/(pixels.length/4)));
 },data);
}

(async()=>{
 const base=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const name=decodeURIComponent(req.url.split('?')[0]);const file=path.join(base,name==='/'?'index.html':name);const send=()=>{try{res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.webp')?'image/webp':'text/html');res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}};setTimeout(send,file.endsWith('appearance.css')?250:file.endsWith('.webp')?500:0)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  for(const theme of ['minimal','aurora','peach','night','water']){
   const page=await browser.newPage({viewport:{width:1100,height:900},reducedMotion:'reduce'});
   await page.addInitScript(theme=>{localStorage.setItem('cet6_interface_style','glass');localStorage.setItem('cet6_theme_glass',theme);localStorage.setItem('cet6_liquid_glass','on');window.visibleFrames=[];function sample(){if(document.body&&getComputedStyle(document.body).visibility!=='hidden')visibleFrames.push({preview:document.documentElement.classList.contains('glass-preview'),theme:document.documentElement.dataset.wallpaper});requestAnimationFrame(sample)}requestAnimationFrame(sample)},theme);
   let releaseWater;
   if(theme==='water') {
    const blockedWater = new Promise(resolve=>{releaseWater=resolve;});
    await page.route('**/water-caustics.webp*',async route=>{await blockedWater;await route.continue();});
   }
   const pending=page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
   pending.catch(()=>{});
   await page.waitForRequest(url=>url.url().includes('appearance.css'));
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.wallpaper),theme,'stored theme applies before slow CSS can block parsing');
   const bootColor=theme==='water' ? await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor) : null;
   await pending;
   assert.equal(await page.evaluate(()=>getComputedStyle(document.body).visibility),'visible','UI does not wait hidden for graphics or water');
   await page.locator('.word-search-input').first().fill('immediately usable');
   let fallbackColor;
   if(theme==='water') {
    try { fallbackColor=await visibleWallpaperColor(page); }
    finally { releaseWater(); }
    await page.evaluate(()=>GlassWallpaper.waterReady());
   }
   await page.waitForFunction(()=>document.documentElement.classList.contains('glass-gpu')&&getComputedStyle(document.body).visibility==='visible');
   await page.waitForTimeout(200);
   const frames=await page.evaluate(()=>visibleFrames);
   assert.ok(frames.length>0&&frames.every(frame=>frame.preview&&frame.theme===theme),theme+': first visible UI uses the same wallpaper recipe, without a hidden startup gate');
   const pixels=await page.evaluate(()=>{const a=document.querySelector('.glass-preview-canvas'),b=document.querySelector('.glass-wallpaper-canvas'),copy=document.createElement('canvas');copy.width=b.width;copy.height=b.height;const ctx=copy.getContext('2d');GlassRenderer.flush();ctx.drawImage(b,0,0);return {preview:Array.from(a.getContext('2d').getImageData(20,20,1,1).data),gpu:Array.from(ctx.getImageData(20,20,1,1).data)}});
   assert.ok(pixels.preview.every((v,i)=>Math.abs(v-pixels.gpu[i])<3),theme+': GPU handoff keeps wallpaper pixels unchanged '+JSON.stringify(pixels));
   if(theme==='water') {
    const loadedColor=await visibleWallpaperColor(page);
    assert.ok([bootColor.match(/\d+/g).map(Number),fallbackColor,loadedColor].every(isWaterBlue)
      &&fallbackColor.every((channel,index)=>Math.abs(channel-loadedColor[index])<25),
    `slow water startup should already match the blue wallpaper (before CSS ${bootColor}, before image ${fallbackColor}, loaded ${loadedColor})`);
   }
   await page.close();
  }
  const missingWater=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await missingWater.addInitScript(()=>{
   localStorage.setItem('cet6_interface_style','glass');
   localStorage.setItem('cet6_theme_glass','water');
   localStorage.setItem('cet6_liquid_glass','on');
  });
  await missingWater.route('**/water-caustics.webp*',route=>route.fulfill({status:404,body:''}));
  await missingWater.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  assert.equal(await missingWater.evaluate(()=>GlassWallpaper.waterReady()),null,'failed image settles without delaying startup');
  await missingWater.locator('.word-search-input').first().fill('usable without a water image');
  const missingColor=await visibleWallpaperColor(missingWater);
  assert.ok(isWaterBlue(missingColor),'missing image keeps the visible fallback blue: '+missingColor);
  await missingWater.close();
  const gutter=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await gutter.addInitScript(()=>{localStorage.setItem('cet6_interface_style','glass');localStorage.setItem('cet6_theme_glass','water');localStorage.setItem('cet6_liquid_glass','on')});
  await gutter.goto(`http://127.0.0.1:${server.address().port}/`);
  await gutter.waitForFunction(()=>document.documentElement.classList.contains('glass-gpu'));
  const match=await gutter.evaluate(()=>{
   document.documentElement.style.scrollbarGutter='stable both-edges';document.body.style.minHeight='150vh';
   GlassRenderer.setIntensity(0);GlassRenderer.setButtonIntensity(0);GlassRenderer.setLayerIntensity(0);GlassRenderer.setControlIntensity(0);GlassRenderer.flush();
   const a=document.querySelector('.glass-preview-canvas'),b=document.querySelector('.glass-wallpaper-canvas'),copy=document.createElement('canvas');copy.width=b.width;copy.height=b.height;const ctx=copy.getContext('2d');ctx.drawImage(b,0,0);
   const before=a.getContext('2d').getImageData(0,0,a.width,a.height).data,after=ctx.getImageData(0,0,b.width,b.height).data;let sum=0;for(let i=0;i<before.length;i++)sum+=Math.abs(before[i]-after[i]);
   return {sizeA:[a.width,a.height],sizeB:[b.width,b.height],mean:sum/before.length};
  });
  assert.deepEqual(match.sizeA,match.sizeB,'preview and GPU share actual gutter-adjusted dimensions');assert.ok(match.mean<.05,'full wallpaper handoff keeps pixels stable: '+match.mean);await gutter.close();
  const compiling=await browser.newPage({viewport:{width:1100,height:900}});
  await compiling.addInitScript(()=>{
   localStorage.setItem('cet6_interface_style','glass');localStorage.setItem('cet6_theme_glass','minimal');localStorage.setItem('cet6_liquid_glass','on');
   const context=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=context.call(this,type,...args);if(type!=='webgl'||!gl)return gl;
    const extension=gl.getExtension('KHR_parallel_shader_compile');if(!extension)return gl;
    const parameter=gl.getProgramParameter.bind(gl);let until;
    gl.getProgramParameter=function(program,key){
     if(key===extension.COMPLETION_STATUS_KHR){if(!until){until=performance.now()+700;window.pendingGraphics=true}if(performance.now()<until)return false;window.pendingGraphics=false;}
     if(key===gl.LINK_STATUS&&performance.now()<until)throw Error('blocking link query during parallel compilation');
     return parameter(program,key);
    };return gl;
   };
  });
  await compiling.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await compiling.waitForFunction(()=>window.pendingGraphics===true);
  await compiling.locator('.word-search-input').first().fill('usable while compiling');
  assert.equal(await compiling.evaluate(()=>window.pendingGraphics),true,'UI accepts input while GPU program is still compiling');
  await compiling.waitForFunction(()=>document.documentElement.classList.contains('glass-gpu'));
  await compiling.close();
  const page=await browser.newPage({viewport:{width:1100,height:900}});
  await page.addInitScript(()=>{localStorage.setItem('cet6_interface_style','glass');localStorage.setItem('cet6_theme_glass','night');const context=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'?null:context.call(this,type,...args)}});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>getComputedStyle(document.body).visibility==='visible'&&!document.documentElement.classList.contains('glass-starting'));
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.wallpaper),'night','fallback keeps the stored theme and releases the startup gate');
  await page.waitForFunction(()=>LiquidGlass.getState().surfaces>0);
  for(const pref of ['off','auto']){
   const fallback=await browser.newPage({viewport:{width:1100,height:900},reducedMotion:'reduce'});
   await fallback.addInitScript(pref=>{localStorage.setItem('cet6_interface_style','glass');localStorage.setItem('cet6_theme_glass','night');localStorage.setItem('cet6_liquid_glass',pref)},pref);
   await fallback.goto(`http://127.0.0.1:${server.address().port}/`);
   assert.equal(await fallback.evaluate(()=>document.documentElement.classList.contains('glass-starting')),false,'disabled refraction releases startup immediately');
   await fallback.close();
  }
  console.log('PASS: five cold glass themes, matching blue water startup with slow CSS and delayed or missing image, and GPU fallback');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
