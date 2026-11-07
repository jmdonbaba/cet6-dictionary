/* Shared event-driven GPU wallpaper/card pass and scissored button lenses.
 * Text and controls stay in the DOM. No DOM capture, per-card render targets or
 * backdrop reads. Animated themes follow the desktop display refresh. Narrow
 * screens render fewer lenses and cap idle wallpaper motion at 60 fps.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var canvas, gl, program, texture, buttonTexture, source, buffer;
  var parallelCompile=null, programReady=false, compileTimer=0;
  var modalElement = null, modalCanvas = null;
  var modalBlurTexture = null, modalBlurOutput = null, modalFramebuffer = null, modalBlurWidth = 0, modalBlurHeight = 0;
  var modalBlurFrozen=false,modalBlurScene='';
  var active = false, failed = false, frame = 0, intensity = 1, lensScale = 1, lensBand = 63;
  var originX=0,originY=0,pixelRatio=0,layerCount=0,layerIntensity=1;
  var width = 0, height = 0, theme = '', draws = 0, lenses = 0, buttonCount = 0, buttonIntensity = 1;
  var selector = '.card, .modal-card, .btn-fav-nav';
  var observed = new Set(), resizeObserver;
  var water = null, waterLoading = false, waterFailed = false;
  var locations = {};
  var motionUntil = 0, waterAnimating = false;
  var ambientAnimating = false, ambientElapsed = 0, ambientTick = null;
  var wallpaperFrame = false, nextMobileFrame = 0;
  var mobileFrameInterval = 1000 / 60;
  var motionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var controlCount=0,controlIntensity=1;
  var MAX_LENSES = 16;
  var vertex = 'attribute vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }';
  var fragment = [
    'precision mediump float;',
    'uniform sampler2D wallpaper;',
    'uniform sampler2D underGlass;',
    'uniform float uTime;',
    'uniform float waterMotion;',
    'uniform vec3 ambientMotion;',
    'uniform float buttonLens;',
    'uniform float inputLens;',
    'uniform float overlayPass;',
    'uniform vec2 blurDirection;',
    'uniform float downsamplePass;',
    'uniform vec4 parentRects[4];',
    'uniform float parentRadii[4];',
    'uniform int parentCount;',
    'uniform vec2 viewport;',
    'uniform vec4 rects[16];',
    'uniform vec2 shapes[16];',
    'uniform int count;',
    'uniform float intensity;',
    'uniform float lensBand;',
    'uniform int touchIndex;',
    'uniform int recoilIndex;',
    'uniform vec4 touch;',
    'uniform vec4 recoil;',
    GlassOptics.glsl,
    'float sdf(vec2 p, vec2 h, float r){vec2 q=abs(p)-h+r; return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}',
    'vec3 waterAt(vec2 uv){',
    ' float t=uTime;',
    ' vec2 flow=vec2(sin(uv.y*8.0+t*0.90)+0.55*sin(uv.y*19.0-t*0.55+uv.x*3.0),',
    '                 cos(uv.x*7.0-t*0.80)+0.55*cos(uv.x*17.0+t*0.50+uv.y*2.5));',
    ' vec2 warped=clamp(uv+flow*0.0032,vec2(.001),vec2(.999));',
    ' vec3 c1=texture2D(wallpaper,warped).rgb;',
    ' vec3 c2=texture2D(wallpaper,clamp(warped+flow*0.0016,vec2(.001),vec2(.999))).rgb;',
    ' float shimmer=0.5+0.5*sin(uv.x*90.0+uv.y*70.0+t*2.4);',
    ' return mix(c1,c2,0.35)*(1.0+0.05*(shimmer-0.5));',
    '}',
    'vec3 sampleAt(vec2 p){',
    ' vec2 uv=clamp(p/viewport,vec2(.001),vec2(.999));',
    ' if(overlayPass>.5)return texture2D(underGlass,vec2(uv.x,1.-uv.y)).rgb;',
    ' if(waterMotion>.5)return waterAt(uv);',
    ' vec2 drift=ambientMotion.xy+ambientMotion.z*vec2(uv.y-.5,.5-uv.x);',
    ' return texture2D(wallpaper,uv+4.*uv*(1.-uv)*drift).rgb;',
    '}',
    'void main(){',
    ' vec2 pixel=vec2(gl_FragCoord.x,viewport.y-gl_FragCoord.y);',
    ' if(downsamplePass>.5){',
    '  vec3 average=vec3(0.);',
    '  for(int y=0;y<4;y++)for(int x=0;x<4;x++)average+=sampleAt(pixel+(vec2(float(x),float(y))-1.5)*.25);',
    '  gl_FragColor=vec4(average/16.,1.);return;',
    ' }',
    ' if(blurDirection.x>0.||blurDirection.y>0.){',
    '  vec3 blurred=sampleAt(pixel)*.2270270270;',
    '  blurred+=(sampleAt(pixel+blurDirection*1.3846153846)+sampleAt(pixel-blurDirection*1.3846153846))*.3162162162;',
    '  blurred+=(sampleAt(pixel+blurDirection*3.2307692308)+sampleAt(pixel-blurDirection*3.2307692308))*.0702702703;',
    '  gl_FragColor=vec4(blurred,1.);return;',
    ' }',
    ' if(overlayPass>.5){',
    '  if(sdf(pixel-rects[0].xy-rects[0].zw*.5,rects[0].zw*.5,shapes[0].x)>=0.)discard;',
    '  for(int j=0;j<4;j++){if(j>=parentCount)break;if(sdf(pixel-parentRects[j].xy-parentRects[j].zw*.5,parentRects[j].zw*.5,parentRadii[j])>=0.)discard;}',
    ' }',
    ' vec3 color=sampleAt(pixel);',
    ' for(int i=0;i<16;i++){',
    '  if(i>=count)break;',
    '  vec4 rect=rects[i]; vec2 halfSize=rect.zw*.5;',
    '  vec2 p=pixel-rect.xy-halfSize; float radius=shapes[i].x;',
    '  float d=sdf(p,halfSize,radius);',
    '  if(d<0.){',
    '   float unit=shapes[i].y;',
    '   float band=min(lensBand*unit*3.,min(halfSize.x,halfSize.y)*.98);',
    '   vec2 field=inputLens>.5?inputOffset(p,halfSize,band):edgeOffset(p,halfSize,band);',
    '   float gain=mix(1.,clamp(72.*unit/min(rect.z,rect.w),1.,2.6),buttonLens);',
    '   float ratio=mix(.36,min(.4,.32+.05*(gain-1.)),buttonLens);',
    '   ratio=mix(ratio,.30,inputLens);',
    '   float bend=min(min(80.*unit,band*ratio)*intensity,band*mix(.4,.30,inputLens));',
    '   vec2 point=pixel-field*bend;',
    '   if(i==touchIndex){',
    '    vec2 v=pixel-touch.xy;float g=exp(-dot(v,v)/max(1.,touch.z*touch.z));float depth=touch.w*intensity;     point+=v*g*.26*depth;',
    '   }',
    '   if(i==recoilIndex){',
    '    vec2 q=pixel-recoil.xy;float g=exp(-dot(q,q)/max(1.,recoil.z*recoil.z));float depth=recoil.w*intensity;     point+=q*g*.32*depth;',
    '   }',
    '   vec2 dispersion=field*min(2.2*unit*intensity,band*.025);',
    '   color=vec3(sampleAt(point+dispersion).r,sampleAt(point).g,sampleAt(point-dispersion).b);',
    '  }',
    ' }',
    ' gl_FragColor=vec4(color,1.);',
    '}'
  ].join('\n');

  function motionAllowed() {
    return !(motionQuery && motionQuery.matches);
  }

  function compile(type, code) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!parallelCompile && !gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('glass-shader');
    return shader;
  }

  function init() {
    if (failed) return false;
    if (gl) return true;
    try {
      canvas = document.createElement('canvas');
      canvas.className = 'glass-wallpaper-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
      if (!gl) throw new Error('no-webgl');
      parallelCompile=gl.getExtension('KHR_parallel_shader_compile');
      program = gl.createProgram();
      var shaderSource = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision > 0
        ? fragment.replace('precision mediump float;', 'precision highp float;') : fragment;
      var vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, shaderSource);
      gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if(parallelCompile&&!gl.getProgramParameter(program,parallelCompile.COMPLETION_STATUS_KHR)){
        compileTimer=setTimeout(pollProgram,8);return true;
      }
      finishProgram();
      return true;
    } catch (error) {
      failed = true; disable();
      return false;
    }
  }

  function finishProgram(){
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('glass-program');
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      var position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      ['wallpaper','underGlass','buttonLens','inputLens','viewport','rects[0]','shapes[0]','count','intensity','lensBand','touchIndex','recoilIndex','touch','recoil','overlayPass','blurDirection','downsamplePass','parentRects[0]','parentRadii[0]','parentCount','uTime','waterMotion','ambientMotion'].forEach(function (name) {
        locations[name] = gl.getUniformLocation(program, name);
      });
      gl.uniform1i(locations.wallpaper, 0);
      gl.uniform1i(locations.underGlass, 1);
      buttonTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, buttonTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      source = document.createElement('canvas');
      canvas.addEventListener('webglcontextlost', function (event) {
        event.preventDefault(); failed = true; disable();
        if (window.LiquidGlass) window.LiquidGlass.refresh();
      });
      document.getElementById('appearanceBackdrop').appendChild(canvas);
      if (window.ResizeObserver) resizeObserver = new ResizeObserver(requestRender);
    programReady=true;requestRender();
  }
  function pollProgram(){
    compileTimer=0;if(!gl||failed)return;
    if(gl.isContextLost()){failed=true;disable();window.LiquidGlass?.refresh();return;}
    if(!gl.getProgramParameter(program,parallelCompile.COMPLETION_STATUS_KHR)){compileTimer=setTimeout(pollProgram,8);return;}
    try{finishProgram();}catch(error){failed=true;disable();window.LiquidGlass?.refresh();}
  }

  function buildWallpaper(mobile) {
    GlassWallpaper.refresh();
    var dpr = Math.min(window.devicePixelRatio || 1, mobile ? .85 : 1.5);
    var pixelBudget = mobile ? 420000 : 2400000;
    // Bound texture size on high DPI screens; one shared texture, not one per card.
    var maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    var scale = Math.min(dpr, Math.sqrt(pixelBudget / (width * height)), maxSize / width, maxSize / height);
    canvas.width = source.width = Math.max(1, Math.round(width * scale));
    canvas.height = source.height = Math.max(1, Math.round(height * scale));
    var ctx = source.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    GlassWallpaper.paint(ctx,width,height,theme,water);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, buttonTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, canvas.width, canvas.height, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(locations.viewport, width, height);
  }

  function loadWater() {
    if(water||waterLoading||waterFailed)return;waterLoading=true;
    GlassWallpaper.waterReady().then(function(image){
      water=image;waterFailed=!image;waterLoading=false;theme='';requestRender();
    });
  }

  function updateAmbient(now, motion) {
    ambientAnimating = !!motion;
    if (!motion) {
      ambientElapsed = 0;
      ambientTick = null;
      gl.uniform3f(locations.ambientMotion, 0, 0, 0);
      return;
    }
    if (ambientTick !== null) {
      now = Math.max(ambientTick, now);
      ambientElapsed += (now - ambientTick) / 1000;
    }
    ambientTick = now;
    // Ease in from the preview pixels, then vary the warp without uploading a new texture.
    var amount = Math.min(1, ambientElapsed / 1.2);
    var phase = ambientElapsed * 2 * Math.PI / motion.period;
    gl.uniform3f(locations.ambientMotion,
      motion.x * amount * Math.sin(phase),
      motion.y * amount * Math.sin(phase + .9),
      motion.bend * amount * Math.sin(phase * .85 + .55));
  }

  function draw(now) {
    frame = 0;
    wallpaperFrame = false;
    if (!active || !programReady || document.hidden) return;
    ambientAnimating = waterAnimating = false;
    if (root.dataset.interface !== 'glass') { clearModal();root.classList.remove('glass-gpu'); return; }
    var mobile = innerWidth <= 720;
    var lensLimit = mobile ? 6 : MAX_LENSES;
    try {
      if (!root.classList.contains('glass-gpu')) root.classList.add('glass-gpu');
      var box=canvas.getBoundingClientRect();
      if(!box.width||!box.height){clearModal();root.classList.remove('glass-gpu');return;}
      if(root.dataset.wallpaper==='water'&&!water&&!waterFailed){root.classList.remove('glass-gpu');loadWater();return;}
      originX=box.left;originY=box.top;
      if (width !== box.width || height !== box.height || pixelRatio !== (devicePixelRatio||1) || theme !== root.dataset.wallpaper) {
        if (theme !== root.dataset.wallpaper) { ambientElapsed = 0; ambientTick = null; }
        width=box.width;height=box.height;pixelRatio=devicePixelRatio||1;theme=root.dataset.wallpaper;
        buildWallpaper(mobile);
      }
      var rects = new Float32Array(MAX_LENSES * 4), shapes = new Float32Array(MAX_LENSES * 2);
      var count = 0;
      var hoverElement=null,hoverIndex=-1,recoilElement=null,recoilIndex=-1;
      document.querySelectorAll(selector).forEach(function (element) {
        if (count >= lensLimit || element.matches('.modal-card, button')) return;
        if (resizeObserver && !observed.has(element)) { resizeObserver.observe(element); observed.add(element); }
        var r = element.getBoundingClientRect();
        if (r.width < 32 || r.height < 32 || r.bottom < originY || r.top > originY+height) return;
        if (getComputedStyle(element).visibility === 'hidden') return;
        rects.set([r.left-originX,r.top-originY,r.width,r.height],count*4);
        shapes.set([materialRadius(element,r),0],count*2);
        if (window.GlassInteraction && GlassInteraction.matches(element)) {
          var effect=GlassInteraction.read(element);
          if(effect.hover[3]){hoverElement=element;hoverIndex=count;}
          if(effect.pulse[3]){recoilElement=element;recoilIndex=count;}
        }
        count++;
      });
      observed.forEach(function (element) { if (!element.isConnected) { resizeObserver.unobserve(element); observed.delete(element); } });
      setTouch(hoverElement,hoverIndex,recoilElement,recoilIndex,canvas.width/width,canvas.height/height);
      gl.disable(gl.SCISSOR_TEST);
      gl.uniform1f(locations.overlayPass,0);
      gl.uniform1i(locations.parentCount,0);
      gl.uniform1f(locations.buttonLens, 0);
      gl.uniform1f(locations.inputLens, 0);
      gl.uniform1i(locations.count, count);
      gl.uniform1f(locations.intensity, intensity * lensScale);
      gl.uniform1f(locations.lensBand, lensBand);
      // gl_FragCoord is in framebuffer pixels; viewport uniforms use the same space.
      lenses = count;
      gl.uniform2f(locations.viewport, canvas.width, canvas.height);
      var canAnimate = motionAllowed();
      waterAnimating = theme === 'water' && !!water && canAnimate;
      gl.uniform1f(locations.uTime, (now || performance.now()) / 1000);
      gl.uniform1f(locations.waterMotion, waterAnimating ? 1 : 0);
      updateAmbient(now, canAnimate && GlassWallpaper.motionFor(theme));
      var sx = canvas.width / width, sy = canvas.height / height;
      for (var i=0;i<count;i++) { rects[i*4]*=sx;rects[i*4+1]*=sy;rects[i*4+2]*=sx;rects[i*4+3]*=sy;shapes[i*2]*=sx;shapes[i*2+1]=sx; }
      gl.uniform4fv(locations['rects[0]'], rects); gl.uniform2fv(locations['shapes[0]'], shapes);
      gl.drawArrays(gl.TRIANGLES,0,3);
      if (mobile) {
        layerCount = 0;
        clearModal();
      } else drawLayers(sx,sy,rects,shapes);
      drawButtons(sx, sy, rects, shapes, mobile);
      if (!mobile) drawModal(sx,sy,rects,shapes);
      draws++;
      if (!root.classList.contains('glass-gpu')) root.classList.add('glass-gpu');
      if (performance.now() < motionUntil) requestRender();
      else if (waterAnimating || ambientAnimating) {
        if (mobile) requestMobileWallpaperFrame();
        else requestRender();
      }
    } catch (error) { failed = true; disable(); if (window.LiquidGlass) window.LiquidGlass.refresh(); }
  }

  function copyComposite() {
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,buttonTexture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,canvas.width,canvas.height);
    gl.activeTexture(gl.TEXTURE0);
  }
  function clearModal() {
    if(modalCanvas)modalCanvas.remove();
    if(modalElement)modalElement.classList.remove('glass-modal-gpu');
    modalCanvas=modalElement=null;
    if(modalBlurTexture)gl.deleteTexture(modalBlurTexture);
    if(modalBlurOutput)gl.deleteTexture(modalBlurOutput);
    if(modalFramebuffer)gl.deleteFramebuffer(modalFramebuffer);
    modalBlurTexture=modalBlurOutput=modalFramebuffer=null;modalBlurWidth=modalBlurHeight=0;modalBlurFrozen=false;
  }
  function blurModalBackdrop(element,sx,sy) {
    var overlay=element.closest('.modal-overlay'),style=overlay&&getComputedStyle(overlay);
    var match=style&&(style.backdropFilter||style.webkitBackdropFilter||'').match(/blur\(([\d.]+)px\)/);
    var radius=match?Number(match[1]):0;
    if(!radius)return;
    radius*=overlay.getBoundingClientRect().width/(overlay.offsetWidth||width);
    var factor=Math.max(1,radius*Math.max(sx,sy)/1.7);
    var w=Math.max(1,Math.ceil(canvas.width/factor)),h=Math.max(1,Math.ceil(canvas.height/factor));
    var turning=!!element.querySelector('.vf-detail.is-flipping');
    var scene=[theme,canvas.width,canvas.height,originX,originY,radius].join(':');
    if(turning&&modalBlurFrozen&&modalBlurScene===scene&&modalBlurWidth===w&&modalBlurHeight===h){
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,modalBlurTexture);gl.activeTexture(gl.TEXTURE0);return;
    }
    if(!modalBlurTexture){
      modalBlurTexture=gl.createTexture();modalBlurOutput=gl.createTexture();modalFramebuffer=gl.createFramebuffer();
    }
    if(modalBlurWidth!==w||modalBlurHeight!==h){
      [modalBlurTexture,modalBlurOutput].forEach(function(texture){
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      });
      modalBlurWidth=w;modalBlurHeight=h;
    }
    // Prefilter into a small texture, then blur horizontally and vertically.
    // The lens samples that blurred result. Nothing blurs the completed optics
    // or the DOM text, and the page outside the modal is never overwritten.
    var tx=w/width,ty=h/height,r=element.getBoundingClientRect();
    var mx=(128+radius*3)*tx,my=(128+radius*3)*ty;
    var x=Math.max(0,Math.floor((r.left-originX)*tx-mx)),y=Math.max(0,Math.floor(h-(r.bottom-originY)*ty-my));
    var right=Math.min(w,Math.ceil((r.right-originX)*tx+mx)),top=Math.min(h,Math.ceil(h-(r.top-originY)*ty+my));
    gl.scissor(x,y,Math.max(0,right-x),Math.max(0,top-y));
    // Cache the complete blurred backdrop for this finite turn. The refracting
    // plates still move; the wallpaper outside the popup keeps moving normally.
    if(turning)gl.scissor(0,0,w,h);
    gl.uniform1f(locations.overlayPass,1);
    gl.viewport(0,0,w,h);gl.uniform2f(locations.viewport,w,h);
    gl.bindFramebuffer(gl.FRAMEBUFFER,modalFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,modalBlurTexture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('modal-blur-framebuffer');
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,buttonTexture);
    gl.uniform1f(locations.downsamplePass,1);gl.drawArrays(gl.TRIANGLES,0,3);
    gl.uniform1f(locations.downsamplePass,0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,modalBlurOutput,0);
    gl.bindTexture(gl.TEXTURE_2D,modalBlurTexture);
    gl.uniform2f(locations.blurDirection,radius*tx/1.7,0);gl.drawArrays(gl.TRIANGLES,0,3);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,modalBlurTexture,0);
    gl.bindTexture(gl.TEXTURE_2D,modalBlurOutput);
    gl.uniform2f(locations.blurDirection,0,radius*ty/1.7);gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.bindTexture(gl.TEXTURE_2D,modalBlurTexture);gl.activeTexture(gl.TEXTURE0);
    gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(locations.viewport,canvas.width,canvas.height);
    gl.uniform2f(locations.blurDirection,0,0);
    modalBlurFrozen=turning;
    modalBlurScene=scene;
  }
  function drawModal(sx,sy,rects,shapes) {
    var element=document.querySelector('.modal-card.active');
    if(!element||!element.getBoundingClientRect().width){clearModal();return;}
    if(element.querySelector('[data-snapshot-turning]'))return;
    if(element!==modalElement){
      clearModal();modalElement=element;
      modalCanvas=document.createElement('canvas');
      modalCanvas.className='glass-modal-canvas';modalCanvas.setAttribute('aria-hidden','true');
      element.prepend(modalCanvas);element.classList.add('glass-modal-gpu');
    }
    // Refract the blurred background, then present this plate above the overlay.
    // Text stays sharp on its own DOM layer above the completed optics.
    // This is one shared GL context, with no DOM capture or per-control canvas.
    copyComposite();gl.enable(gl.SCISSOR_TEST);
    blurModalBackdrop(element,sx,sy);
    drawSurface(element,false,1,sx,sy,rects,shapes);
    if(layerIntensity){
      var selector=GlassOptics.modalLayers+', '+GlassOptics.layers;
      drawLayerGroups(element.querySelectorAll(':is('+selector+'):not([hidden], [hidden] *)'),selector,sx,sy,rects,shapes);
    }
    if(buttonIntensity||controlIntensity){
      copyComposite();
      if(controlIntensity)element.querySelectorAll(GlassOptics.inputs).forEach(function(input){
        drawSurface(input,true,controlIntensity*GlassOptics.inputStrength(input,performance.now()),sx,sy,rects,shapes);
      });
      copyComposite();
      element.querySelectorAll(':is(button, '+GlassOptics.controls+'):not([hidden], [hidden] *)').forEach(function(button){
        if(button.matches('input, textarea, .ws-mode-toggle button'))return;
        var strength=button.matches(GlassOptics.controls)?controlIntensity:buttonIntensity;
        if(strength)drawSurface(button,true,strength,sx,sy,rects,shapes);
      });
    }
    gl.disable(gl.SCISSOR_TEST);
    var r=element.getBoundingClientRect(),w=Math.max(1,Math.round(r.width*sx)),h=Math.max(1,Math.round(r.height*sy));
    var turning=!!element.querySelector('.vf-detail.is-flipping');
    var bufferHeight=turning?Math.max(h,Math.ceil(height*sy*.8)):h;
    if(modalCanvas.width!==w)modalCanvas.width=w;
    if(modalCanvas.height!==bufferHeight)modalCanvas.height=bufferHeight;
    // Keep backing storage stable while CSS height changes. Clip unused rows
    // instead of reallocating and clearing the graphics buffer every frame.
    var modalStyle=getComputedStyle(element),scaleY=r.height/parseFloat(modalStyle.height),scaleX=r.width/parseFloat(modalStyle.width);
    var cssHeight=bufferHeight/sy/scaleY+'px',clip='inset(0 0 '+Math.max(0,(bufferHeight-h)/sy/scaleY)+'px 0 round '+materialRadius(element,r)/Math.min(scaleX,scaleY)+'px)';
    if(modalCanvas.style.height!==cssHeight)modalCanvas.style.height=cssHeight;
    if(modalCanvas._glassClip!==clip){modalCanvas.style.clipPath=clip;modalCanvas._glassClip=clip;}
    var ctx=modalCanvas.getContext('2d');ctx.clearRect(0,0,w,bufferHeight);
    ctx.drawImage(canvas,(r.left-originX)*sx,(r.top-originY)*sy,r.width*sx,r.height*sy,0,0,w,h);
  }
  function materialRadius(element,r) {
    var radius=getComputedStyle(element).borderTopLeftRadius;
    var value=parseFloat(radius)||0;
    if(radius.indexOf('%')>=0)value=Math.min(r.width,r.height)*value/100;
    else value*=Math.min(r.width/(element.offsetWidth||r.width),r.height/(element.offsetHeight||r.height));
    return Math.min(value,r.width/2,r.height/2);
  }
  function setParents(element,sx,sy) {
    var rectangles=new Float32Array(16),radii=new Float32Array(4),count=0;
    var popup=element.closest('.more-menu,.study-export-menu,.ws-search-dropdown,.fav-search-dropdown');
    var parents=element.closest('.modal-card')?'.modal-card, .modal-body, [role="tabpanel"], '+GlassOptics.modalLayers+', '+GlassOptics.layers:'.card, '+GlassOptics.layers;
    // A menu may escape its row, but it still belongs inside the scrolling pane.
    if(popup)parents=element.closest('.modal-card')?'.modal-card, .modal-body, [role="tabpanel"]':'';
    var parent=popup || element.parentElement?.closest(parents);
    while(parent&&count<4){
      var r=parent.getBoundingClientRect();
      rectangles.set([(r.left-originX)*sx,(r.top-originY)*sy,r.width*sx,r.height*sy],count*4);
      radii[count]=materialRadius(parent,r)*sx;count++;
      parent=parents?parent.parentElement?.closest(parents):null;
    }
    gl.uniform1i(locations.parentCount,count);
    gl.uniform4fv(locations['parentRects[0]'],rectangles);gl.uniform1fv(locations['parentRadii[0]'],radii);
  }
  function drawSurface(element,isButton,strength,sx,sy,rects,shapes) {
    if (element.hasAttribute('data-favorites-handoff-cover')) return false;
    var r=element.getBoundingClientRect();
    if(r.width<8||r.height<8||r.bottom<=originY||r.top>=originY+height||r.right<=originX||r.left>=originX+width)return false;
    var style=getComputedStyle(element);
    if(style.visibility==='hidden'||style.display==='none')return false;
    // A fading control must fade its sampled lens along with its CSS material.
    var opacity=Number(style.opacity);if(opacity<=0)return false;strength*=opacity;
    if(resizeObserver&&!observed.has(element)){resizeObserver.observe(element);observed.add(element);}
    rects.set([(r.left-originX)*sx,(r.top-originY)*sy,r.width*sx,r.height*sy],0);
    shapes.set([materialRadius(element,r)*sx,sx],0);
    gl.uniform1f(locations.buttonLens,isButton?1:0);
    gl.uniform1f(locations.inputLens,element.matches(GlassOptics.inputs)?1:0);
    gl.uniform1f(locations.overlayPass,1);
    gl.uniform1f(locations.intensity,intensity*lensScale*strength);
    gl.uniform1i(locations.count,1);
    setTouch(element,0,element,0,sx,sy);setParents(element,sx,sy);
    gl.uniform4fv(locations['rects[0]'],rects);gl.uniform2fv(locations['shapes[0]'],shapes);
    var x=Math.max(0,Math.floor((r.left-originX)*sx)),y=Math.max(0,Math.floor(canvas.height-(r.bottom-originY)*sy));
    var right=Math.min(canvas.width,Math.ceil((r.right-originX)*sx)),top=Math.min(canvas.height,Math.ceil(canvas.height-(r.top-originY)*sy));
    gl.scissor(x,y,Math.max(0,right-x),Math.max(0,top-y));gl.drawArrays(gl.TRIANGLES,0,3);return true;
  }
  // Each depth reads the already-composited glass, not the raw wallpaper. Ancestor
  // masks keep refracted content inside its real rounded material boundaries.
  function drawLayers(sx,sy,rects,shapes) {
    layerCount=0;if(!layerIntensity)return;
    var elements=Array.from(document.querySelectorAll(GlassOptics.layers)).filter(function(element){return !element.closest('.modal-card');});
    gl.enable(gl.SCISSOR_TEST);
    layerCount=drawLayerGroups(elements,GlassOptics.layers,sx,sy,rects,shapes);
    gl.disable(gl.SCISSOR_TEST);
  }
  function drawLayerGroups(elements,selector,sx,sy,rects,shapes) {
    var count=0;
    var groups=[];
    elements.forEach(function(element){
      var depth=0,parent=element.parentElement?.closest(selector);
      while(parent&&depth<3){depth++;parent=parent.parentElement?.closest(selector);}
      (groups[depth]||(groups[depth]=[])).push(element);
    });
    groups.forEach(function(group){
      if(!group)return;copyComposite();
      group.forEach(function(element){if(drawSurface(element,false,layerIntensity,sx,sy,rects,shapes))count++;});
    });
    return count;
  }
  function drawButtons(sx,sy,rects,shapes,mobile) {
    buttonCount=0;controlCount=0;if(!controlIntensity&&(mobile||!buttonIntensity))return;
    copyComposite();gl.enable(gl.SCISSOR_TEST);
    if(controlIntensity)document.querySelectorAll(GlassOptics.inputs).forEach(function(input){
      if(!input.closest('.modal-card')&&drawSurface(input,true,controlIntensity*GlassOptics.inputStrength(input,performance.now()),sx,sy,rects,shapes))controlCount++;
    });
    if (mobile) { gl.disable(gl.SCISSOR_TEST); return; }
    // Clear buttons inside a search box sample its completed input plate.
    copyComposite();
    document.querySelectorAll('button, '+GlassOptics.controls).forEach(function(button){
      if(button.closest('.modal-card')||button.matches('.ws-mode-toggle button')||button.matches('input, textarea'))return;
      var control=button.matches(GlassOptics.controls),strength=control?controlIntensity:buttonIntensity;
      // Focused inputs/sliders bend their whole silhouette harder instead of
      // drawing a CSS focus border; the boost is visible even without hover.
      if(strength&&button===document.activeElement)strength*=2.4;
      if(strength&&drawSurface(button,true,strength,sx,sy,rects,shapes)){if(control)controlCount++;else buttonCount++;}
    });
    gl.disable(gl.SCISSOR_TEST);
  }

  function setTouch(hoverElement,hoverIndex,recoilElement,recoilIndex,sx,sy) {
    var h=hoverElement&&window.GlassInteraction ? GlassInteraction.read(hoverElement).hover : [0,0,1,0];
    var p=recoilElement&&window.GlassInteraction ? GlassInteraction.read(recoilElement).pulse : [0,0,1,0];
    gl.uniform1i(locations.touchIndex,h[3] ? hoverIndex : -1);
    gl.uniform1i(locations.recoilIndex,p[3] ? recoilIndex : -1);
    gl.uniform4f(locations.touch,(h[0]-originX)*sx,(h[1]-originY)*sy,h[2]*sx,h[3]);
    gl.uniform4f(locations.recoil,(p[0]-originX)*sx,(p[1]-originY)*sy,p[2]*sx,p[3]);
  }

  function onMaterialAnimation(event) {
    if(!active||event.pseudoElement||event.target.closest('.modal-card')||!event.target.closest('.card, '+GlassOptics.layers))return;
    if(event.type==='animationstart')motionUntil=Math.max(motionUntil,performance.now()+450);
    requestRender();
  }

  function onControlTransition(event) {
    if (!active || !event.target.matches('button, '+GlassOptics.controls+', '+GlassOptics.modalLayers) ||
        ['scale','transform','translate','left','width'].indexOf(event.propertyName) < 0) return;
    if(event.type === 'transitionrun')motionUntil = Math.max(motionUntil,performance.now()+450);
    requestRender();
  }

  function requestRender() {
    if (!active || document.hidden || (frame && !wallpaperFrame)) return;
    cancelRender();
    frame = requestAnimationFrame(draw);
  }
  function requestMobileWallpaperFrame() {
    wallpaperFrame = true;
    frame = requestAnimationFrame(drawMobileWallpaperFrame);
  }
  function drawMobileWallpaperFrame(now) {
    if (now + 1 < nextMobileFrame) {
      requestMobileWallpaperFrame();
      return;
    }
    // Keep the cadence on the display clock while avoiding catch-up bursts.
    nextMobileFrame = Math.max(now - 8, nextMobileFrame) + mobileFrameInterval;
    draw(now);
  }
  function cancelRender() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    wallpaperFrame = false;
  }
  function onVisibilityChange() {
    if (document.hidden) {
      cancelRender();
      nextMobileFrame = 0;
      ambientTick = null;
      ambientAnimating = waterAnimating = false;
    } else requestRender();
  }
  function flush() {
    if(!active||failed)return false;
    cancelRender();
    draw(performance.now());return !failed;
  }
  function enable(options) {
    if (!init()) return false;
    active = true;
    if(resizeObserver)resizeObserver.observe(canvas);
    if (options && options.selector) selector = options.selector;
    if (options && options.intensity !== undefined) intensity = options.intensity;
    if (options && options.scale !== undefined) lensScale = options.scale / 64;
    if (options && options.band !== undefined) lensBand = options.band * 1.75;
    requestRender(); return true;
  }
  function disable() {
    clearModal();
    active = false;
    cancelRender();
    nextMobileFrame = 0;
    ambientElapsed = 0;
    ambientTick = null;
    ambientAnimating = waterAnimating = false;
    root.classList.remove('glass-gpu');
    if (resizeObserver) resizeObserver.disconnect(); observed.clear();
  }
  function destroy() {
    clearTimeout(compileTimer);programReady=false;
    disable();
    document.removeEventListener('scroll', requestRender, true);
    window.removeEventListener('resize', requestRender);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    motionQuery?.removeEventListener?.('change', requestRender);
    document.removeEventListener('focusin', onInputFocus);
    document.removeEventListener('focusout', onInputFocus);
    document.removeEventListener('animationstart',onMaterialAnimation);document.removeEventListener('animationend',onMaterialAnimation);
    document.removeEventListener('transitionrun', onControlTransition);
    document.removeEventListener('transitionend', onControlTransition);
    if (gl) { gl.deleteTexture(texture); gl.deleteTexture(buttonTexture); gl.deleteProgram(program); gl.deleteBuffer(buffer); }
    if (canvas) canvas.remove();
    canvas = gl = source = null;
  }
  document.addEventListener('scroll', requestRender, { passive: true, capture: true });
  window.addEventListener('resize', requestRender, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  motionQuery?.addEventListener?.('change', requestRender);
  function onInputFocus(event) {
    if(root.dataset.interface==='glass'&&event.target.matches(GlassOptics.inputs)){
      var now=performance.now();
      GlassOptics.setFocus(event.target,event.type==='focusin',now,!motionAllowed());
      if(motionAllowed())motionUntil=Math.max(motionUntil,now+GlassOptics.focusDuration+30);
    }
    requestRender();
  }
  document.addEventListener('focusin', onInputFocus);
  document.addEventListener('focusout', onInputFocus);
  document.addEventListener('animationstart',onMaterialAnimation);document.addEventListener('animationend',onMaterialAnimation);
  document.addEventListener('transitionrun', onControlTransition);
  document.addEventListener('transitionend', onControlTransition);
  window.GlassRenderer = {
    animateFor: function(duration) { if(!active||failed)return;motionUntil=Math.max(motionUntil,performance.now()+Math.max(0,Math.min(1000,Number(duration)||0)));requestRender(); },
    enable: enable, disable: disable, destroy: destroy, render: requestRender, flush: flush,
    setControlIntensity:function(value){controlIntensity=Math.max(0,Math.min(2,Number(value)||0));requestRender();},
    setLayerIntensity: function(value){layerIntensity=Math.max(0,Math.min(2,Number(value)||0));requestRender();},
    setButtonIntensity: function (value) { buttonIntensity = Math.max(0,Math.min(2,Number(value)||0)); requestRender(); },
    setIntensity: function (value) { intensity = value; requestRender(); },
    getState: function () { return { active: active && !failed, failed: failed, draws: draws, lenses:lenses+layerCount+buttonCount+controlCount,layers:layerCount,controls:controlCount,originX:originX,originY:originY,buttons: buttonCount, width: width, height: height, waterMotion: waterAnimating, ambientMotion: ambientAnimating }; }
  };
})();
