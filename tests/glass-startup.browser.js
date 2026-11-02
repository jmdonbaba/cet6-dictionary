const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const base=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const name=decodeURIComponent(req.url.split('?')[0]);const file=path.join(base,name==='/'?'index.html':name);const send=()=>{try{res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.webp')?'image/webp':'text/html');res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}};setTimeout(send,file.endsWith('appearance.css')?250:file.endsWith('.webp')?500:0)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  for(const theme of ['minimal','aurora','peach','night','water']){
   const page=await browser.newPage({viewport:{width:1100,height:900},reducedMotion:'reduce'});
   await page.addInitScript(theme=>{localStorage.setItem('cet6_interface_style','glass');localStorage.setItem('cet6_theme_glass',theme);localStorage.setItem('cet6_liquid_glass','on');window.visibleFrames=[];function sample(){if(document.body&&getComputedStyle(document.body).visibility!=='hidden')visibleFrames.push({gpu:document.documentElement.classList.contains('glass-gpu'),theme:document.documentElement.dataset.wallpaper});requestAnimationFrame(sample)}requestAnimationFrame(sample)},theme);
   const pending=page.goto(`http://127.0.0.1:${server.address().port}/`);
   pending.catch(()=>{});
   await page.waitForRequest(url=>url.url().includes('appearance.css'));
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.wallpaper),theme,'stored theme applies before slow CSS can block parsing');
   await pending;
   await page.waitForFunction(()=>document.documentElement.classList.contains('glass-gpu')&&getComputedStyle(document.body).visibility==='visible');
   await page.waitForTimeout(200);
   const frames=await page.evaluate(()=>visibleFrames);
   assert.ok(frames.length>0&&frames.every(frame=>frame.gpu&&frame.theme===theme),theme+': first visible UI already uses the final GPU theme');
   await page.close();
  }
  const page=await browser.newPage({viewport:{width:1100,height:900}});
  await page.addInitScript(()=>{localStorage.setItem('cet6_interface_style','glass');localStorage.setItem('cet6_theme_glass','night');const context=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'?null:context.call(this,type,...args)}});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>getComputedStyle(document.body).visibility==='visible'&&!document.documentElement.classList.contains('glass-starting'));
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.wallpaper),'night','fallback keeps the stored theme and releases the startup gate');
  assert.ok(await page.evaluate(()=>LiquidGlass.getState().surfaces>0),'native fallback calibrates visible surfaces before publishing');
  for(const pref of ['off','auto']){
   const fallback=await browser.newPage({viewport:{width:1100,height:900},reducedMotion:'reduce'});
   await fallback.addInitScript(pref=>{localStorage.setItem('cet6_interface_style','glass');localStorage.setItem('cet6_theme_glass','night');localStorage.setItem('cet6_liquid_glass',pref)},pref);
   await fallback.goto(`http://127.0.0.1:${server.address().port}/`);
   assert.equal(await fallback.evaluate(()=>document.documentElement.classList.contains('glass-starting')),false,'disabled refraction releases startup immediately');
   await fallback.close();
  }
  console.log('PASS: five cold glass themes publish only their final first frame; slow CSS, delayed water and GPU fallback covered');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
