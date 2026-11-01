const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('file:///'+path.resolve(__dirname,'../index.html').replaceAll('\\','/'));
  await page.evaluate(()=>{Appearance.set('glass');Appearance.setTheme('minimal');LiquidGlass.enable({persist:false})});
  await page.waitForTimeout(600);
  const result=await page.evaluate(()=>{
   GlassRenderer.setIntensity(0);GlassRenderer.setButtonIntensity(0);GlassRenderer.setLayerIntensity(0);GlassRenderer.flush();
   const source=document.querySelector('.glass-wallpaper-canvas'),gl=source.getContext('webgl');
   const resources={created:0,deleted:0},createTexture=gl.createTexture.bind(gl),deleteTexture=gl.deleteTexture.bind(gl);
   gl.createTexture=function(){resources.created++;return createTexture()};
   gl.deleteTexture=function(texture){resources.deleted++;return deleteTexture(texture)};
   window.modalBlurResources=resources;
   const errors=[],draw=gl.drawArrays.bind(gl);
   gl.drawArrays=function(...args){
    draw(...args);const error=gl.getError();if(error)errors.push(error);
   };
   const pattern=document.createElement('canvas');pattern.width=source.width;pattern.height=source.height;
   const ctx=pattern.getContext('2d');
   for(let y=0;y<pattern.height;y+=4)for(let x=0;x<pattern.width;x+=4){ctx.fillStyle=((x+y)/4)%2?'#fff':'#000';ctx.fillRect(x,y,4,4)}
   gl.activeTexture(gl.TEXTURE0);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,pattern);
   const capture=()=>{
    GlassRenderer.flush();const canvas=document.querySelector('.glass-modal-canvas');
    return {canvas,pixels:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data};
   };
   openModal(document.getElementById('modalSettings'),true);
   GlassRenderer.setIntensity(0);
   const blurred=capture();let sharpness=0,n=0;
   for(let y=60;y<blurred.canvas.height-60;y++)for(let x=60;x<blurred.canvas.width-61;x++){
    const i=(y*blurred.canvas.width+x)*4;sharpness+=Math.abs(blurred.pixels[i]-blurred.pixels[i+4]);n++;
   }
   const canvasFilter=getComputedStyle(blurred.canvas).filter,textFilter=getComputedStyle(document.getElementById('modalSettings')).filter;
   // A larger pattern retains enough shape after blur to measure real bending.
   for(let y=0;y<pattern.height;y+=64)for(let x=0;x<pattern.width;x+=64){ctx.fillStyle=((x+y)/64)%2?'#fff':'#000';ctx.fillRect(x,y,64,64)}
   gl.activeTexture(gl.TEXTURE0);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,pattern);
   const flat=capture();GlassRenderer.setIntensity(1);const curved=capture();
   let bend=0;for(let i=0;i<flat.pixels.length;i+=4)bend+=Math.abs(flat.pixels[i]-curved.pixels[i]);
   let min=255,max=0;for(let i=0;i<flat.pixels.length;i+=4){min=Math.min(min,flat.pixels[i]);max=Math.max(max,flat.pixels[i]);}
   return {sharpness:sharpness/n,bend:bend/(flat.pixels.length/4),range:max-min,errors,canvasFilter,textFilter};
  });
  assert.ok(result.sharpness<2,'modal refraction must sample a blurred background, observed '+JSON.stringify(result));
  assert.ok(result.bend>.5,'blurred shapes still bend through the modal edge, observed '+JSON.stringify(result));
  assert.ok(result.range>100,'blur preserves large background shapes instead of painting a flat fill');
  assert.deepEqual(result.errors,[],'blur passes must not produce GL errors');
  assert.equal(result.canvasFilter,'none','do not blur the finished refracted plate');
  assert.equal(result.textFilter,'none','modal text stays sharp');
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>document.body.style.zoom='1.25');
  const state=await page.evaluate(()=>{
   GlassRenderer.flush();const source=document.querySelector('.glass-wallpaper-canvas'),gl=source.getContext('webgl');
   const viewport=Array.from(gl.getParameter(gl.VIEWPORT)),error=gl.getError();
   closeModal();LiquidGlass.flush();
   return {viewport,size:[source.width,source.height],error,resources:window.modalBlurResources,canvases:document.querySelectorAll('.glass-modal-canvas').length};
  });
  assert.deepEqual(state.viewport,[0,0,...state.size],'blur restores the display viewport after resizing and zoom');
  assert.equal(state.error,0);
  assert.ok(state.resources.created>0&&state.resources.created===state.resources.deleted,'closing releases all temporary blur textures');
  assert.equal(state.canvases,0);
  console.log('PASS: modal samples blurred wallpaper before refraction, sharp text and visible bending',JSON.stringify(result));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
