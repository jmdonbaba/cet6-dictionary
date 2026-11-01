/* Shared event-driven GPU wallpaper/card pass and scissored button lenses.
 * Text and controls stay in the DOM. No DOM capture, per-card render targets or
 * backdrop reads. The water wallpaper animates through the shader (following the
 * display refresh); every other wallpaper stays static. Native glass is the fallback.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var canvas, gl, program, texture, buttonTexture, source, buffer;
  var active = false, failed = false, frame = 0, intensity = 1, lensScale = 1, lensBand = 63;
  var originX=0,originY=0,pixelRatio=0,layerCount=0,layerIntensity=1;
  var width = 0, height = 0, theme = '', draws = 0, lenses = 0, buttonCount = 0, buttonIntensity = 1;
  var selector = '.card, .modal-card, .btn-fav-nav';
  var observed = new Set(), resizeObserver;
  var water = null, waterLoading = false;
  var locations = {};
  var motionUntil = 0, waterAnimating = false;
  var controlCount=0,controlIntensity=1;
  var MAX_LENSES = 16;
  var vertex = 'attribute vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }';
  var fragment = [
    'precision mediump float;',
    'uniform sampler2D wallpaper;',
    'uniform sampler2D underGlass;',
    'uniform float uTime;',
    'uniform float waterMotion;',
    'uniform vec4 focusRect;',
    'uniform float focusBoost;',
    'uniform float buttonLens;',
    'uniform float overlayPass;',
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
    'vec3 sampleAt(vec2 p){ vec2 uv=clamp(p/viewport,vec2(.001),vec2(.999)); if(overlayPass>.5)return texture2D(underGlass,vec2(uv.x,1.-uv.y)).rgb; if(waterMotion>.5)return waterAt(uv); return texture2D(wallpaper,uv).rgb; }',
    'void main(){',
    ' vec2 pixel=vec2(gl_FragCoord.x,viewport.y-gl_FragCoord.y);',
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
    '   float boost=(focusBoost>.5 && abs(rect.x-focusRect.x)<.5 && abs(rect.y-focusRect.y)<.5 && abs(rect.z-focusRect.z)<.5 && abs(rect.w-focusRect.w)<.5)?1.35:1.;',
    '   float lensIntensity=intensity*boost;',
    '   float unit=shapes[i].y;',
    '   float band=min(lensBand*unit*3.,min(halfSize.x,halfSize.y)*.98);',
    '   vec2 field=edgeOffset(p,halfSize,band);',
    '   float gain=mix(1.,clamp(72.*unit/min(rect.z,rect.w),1.,2.6),buttonLens);',
    '   float ratio=mix(.36,min(.4,.32+.05*(gain-1.)),buttonLens);',
    '   float bend=min(min(80.*unit,band*ratio)*lensIntensity,band*.4*boost);',
    '   vec2 point=pixel-field*bend;',
    '   if(i==touchIndex){',
    '    vec2 v=pixel-touch.xy;float g=exp(-dot(v,v)/max(1.,touch.z*touch.z));float depth=touch.w*intensity;     point+=v*g*.26*depth;',
    '   }',
    '   if(i==recoilIndex){',
    '    vec2 q=pixel-recoil.xy;float g=exp(-dot(q,q)/max(1.,recoil.z*recoil.z));float depth=recoil.w*intensity;     point+=q*g*.32*depth;',
    '   }',
    '   vec2 dispersion=field*min(2.2*unit*lensIntensity,band*.025*boost);',
    '   color=vec3(sampleAt(point+dispersion).r,sampleAt(point).g,sampleAt(point-dispersion).b);',
    '  }',
    ' }',
    ' gl_FragColor=vec4(color,1.);',
    '}'
  ].join('\n');

  function motionAllowed() {
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function compile(type, code) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('glass-shader');
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
      program = gl.createProgram();
      var shaderSource = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision > 0
        ? fragment.replace('precision mediump float;', 'precision highp float;') : fragment;
      var vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, shaderSource);
      gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
      gl.deleteShader(vs); gl.deleteShader(fs);
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
      ['wallpaper','underGlass','buttonLens','viewport','rects[0]','shapes[0]','count','intensity','lensBand','touchIndex','recoilIndex','touch','recoil','overlayPass','parentRects[0]','parentRadii[0]','parentCount','uTime','waterMotion','focusRect','focusBoost'].forEach(function (name) {
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
      return true;
    } catch (error) {
      failed = true; disable();
      return false;
    }
  }

  function rgba(token, alpha) { return 'rgba(' + token + ',' + alpha + ')'; }

  function buildWallpaper() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    // Bound texture size on high DPI screens; one shared texture, not one per card.
    var maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    var scale = Math.min(dpr, Math.sqrt(2400000 / (width * height)), maxSize / width, maxSize / height);
    canvas.width = source.width = Math.max(1, Math.round(width * scale));
    canvas.height = source.height = Math.max(1, Math.round(height * scale));
    var ctx = source.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    var palettes = {
      aurora: ['#f1f6ff','#f7f2ff','#eefbf8'], peach: ['#fff8f0','#fff1f2','#f7f3ff'],
      night: ['#0b1026','#131a3a','#0b2130'], water: ['#a7e6df','#8fd8d2','#6fc9c4'],
      minimal: ['#eef0f8','#eef0f8','#eef0f8']
    };
    var palette = palettes[theme] || palettes.aurora;
    var base = ctx.createLinearGradient(0, 0, width * .4, height);
    palette.forEach(function (color, i) { base.addColorStop(i / 2, color); });
    ctx.fillStyle = base; ctx.fillRect(0, 0, width, height);
    if (theme === 'water' && water) {
      var imageScale = Math.max(width / water.width, height / water.height);
      ctx.drawImage(water, (width - water.width * imageScale) / 2, (height - water.height * imageScale) / 2,
        water.width * imageScale, water.height * imageScale);
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, 0, width, height);
    } else if (theme !== 'minimal') {
      var style = getComputedStyle(root), vmax = Math.max(width, height);
      var colors = ['a','b','c','d'].map(function (n) { return style.getPropertyValue('--aurora-' + n).trim() || '125,211,252'; });
      [[.08,.05,.62,.7],[.98,.2,.54,.6],[.86,1.1,.52,.48],[.05,1.15,.5,.44]].forEach(function (blob, i) {
        var x = width * blob[0], y = height * blob[1], r = vmax * blob[2];
        var gradient = ctx.createRadialGradient(x,y,0,x,y,r);
        gradient.addColorStop(0, rgba(colors[i],blob[3])); gradient.addColorStop(1, rgba(colors[i],0));
        ctx.fillStyle = gradient; ctx.fillRect(0,0,width,height);
      });
      // The same contours and palette treatment for every detailed wallpaper.
      ctx.save(); ctx.scale(width / 1440, height / 1000);
      var ribbon = ctx.createLinearGradient(0,0,1440,1000);
      ribbon.addColorStop(0,rgba(colors[0],.45)); ribbon.addColorStop(.5,rgba(colors[1],.4)); ribbon.addColorStop(1,rgba(colors[2],.48));
      ctx.strokeStyle = ribbon;
      ctx.lineWidth = 110; ctx.beginPath(); ctx.moveTo(-160,160); ctx.bezierCurveTo(160,40,380,580,750,340); ctx.bezierCurveTo(1000,180,1190,20,1580,300); ctx.stroke();
      ctx.globalAlpha = .7; ctx.lineWidth = 170; ctx.beginPath(); ctx.moveTo(-120,640); ctx.bezierCurveTo(200,910,400,310,760,560); ctx.bezierCurveTo(1100,800,1170,940,1580,600); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-80,870); ctx.bezierCurveTo(290,630,530,1040,900,820); ctx.bezierCurveTo(1200,650,1290,550,1540,780); ctx.stroke();
      ctx.restore();
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, buttonTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, canvas.width, canvas.height, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(locations.viewport, width, height);
  }

  function loadWater() {
    if (water || waterLoading) return;
    waterLoading = true;
    var image = new Image();
    image.onload = function () { water = image; theme = ''; requestRender(); };
    image.onerror = function () { waterLoading = false; };
    if (location.protocol === 'file:') {
      // A data URL keeps direct local HTML opening origin-clean for WebGL.
      var script = document.createElement('script');
      script.src = 'assets/water-caustics-data.js?v=ed0754fcbddf';
      script.onload = function () { image.src = window.Cet6WaterTexture; script.remove(); };
      script.onerror = function () { waterLoading = false; script.remove(); };
      document.head.appendChild(script);
    } else image.src = 'assets/water-caustics.webp?v=76af31542084';
  }

  function draw(now) {
    frame = 0;
    if (!active || document.hidden) return;
    if (root.dataset.interface !== 'glass' || innerWidth <= 720) { root.classList.remove('glass-gpu'); return; }
    try {
      if (!root.classList.contains('glass-gpu')) root.classList.add('glass-gpu');
      var box=canvas.getBoundingClientRect();
      if(!box.width||!box.height){root.classList.remove('glass-gpu');return;}
      originX=box.left;originY=box.top;
      if (width !== box.width || height !== box.height || pixelRatio !== (devicePixelRatio||1) || theme !== root.dataset.wallpaper) {
        width=box.width;height=box.height;pixelRatio=devicePixelRatio||1;theme=root.dataset.wallpaper;
        if(theme==='water')loadWater();
        buildWallpaper();
      }
      var rects = new Float32Array(MAX_LENSES * 4), shapes = new Float32Array(MAX_LENSES * 2);
      var count = 0;
      var hoverElement=null,hoverIndex=-1,recoilElement=null,recoilIndex=-1,focusIndex=-1;
      document.querySelectorAll(selector).forEach(function (element) {
        if (element.matches('.modal-card, button')) return;
        if (resizeObserver && !observed.has(element)) { resizeObserver.observe(element); observed.add(element); }
        var r = element.getBoundingClientRect();
        if (count >= MAX_LENSES || r.width < 32 || r.height < 32 || r.bottom < originY || r.top > originY+height) return;
        if (getComputedStyle(element).visibility === 'hidden') return;
        if (element.contains(document.activeElement)) focusIndex = count;
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
      gl.uniform1i(locations.count, count);
      gl.uniform1f(locations.intensity, intensity * lensScale);
      gl.uniform1f(locations.lensBand, lensBand);
      // gl_FragCoord is in framebuffer pixels; viewport uniforms use the same space.
      lenses = count;
      gl.uniform2f(locations.viewport, canvas.width, canvas.height);
      waterAnimating = theme === 'water' && motionAllowed();
      gl.uniform1f(locations.uTime, (now || performance.now()) / 1000);
      gl.uniform1f(locations.waterMotion, waterAnimating ? 1 : 0);
      var sx = canvas.width / width, sy = canvas.height / height;
      for (var i=0;i<count;i++) { rects[i*4]*=sx;rects[i*4+1]*=sy;rects[i*4+2]*=sx;rects[i*4+3]*=sy;shapes[i*2]*=sx;shapes[i*2+1]=sx; }
      gl.uniform4fv(locations['rects[0]'], rects); gl.uniform2fv(locations['shapes[0]'], shapes);
      var fi = focusIndex >= 0 ? focusIndex * 4 : 0;
      gl.uniform4f(locations.focusRect, focusIndex >= 0 ? rects[fi] : -1, focusIndex >= 0 ? rects[fi+1] : -1,
        focusIndex >= 0 ? rects[fi+2] : 0, focusIndex >= 0 ? rects[fi+3] : 0);
      gl.uniform1f(locations.focusBoost, focusIndex >= 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES,0,3);
      drawLayers(sx,sy,rects,shapes);
      drawButtons(sx, sy, rects, shapes);
      draws++;
      if (!root.classList.contains('glass-gpu')) root.classList.add('glass-gpu');
      if (document.querySelector('.modal-card.active')) motionUntil = 0;
      if (performance.now() < motionUntil) requestRender();
      if (waterAnimating) requestRender();
    } catch (error) { failed = true; disable(); if (window.LiquidGlass) window.LiquidGlass.refresh(); }
  }

  function copyComposite() {
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,buttonTexture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,canvas.width,canvas.height);
    gl.activeTexture(gl.TEXTURE0);
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
    var parent=popup || element.parentElement?.closest('.card, '+GlassOptics.layers);
    while(parent&&count<4){
      var r=parent.getBoundingClientRect();
      rectangles.set([(r.left-originX)*sx,(r.top-originY)*sy,r.width*sx,r.height*sy],count*4);
      radii[count]=materialRadius(parent,r)*sx;count++;
      parent=popup?null:parent.parentElement?.closest('.card, '+GlassOptics.layers);
    }
    gl.uniform1i(locations.parentCount,count);
    gl.uniform4fv(locations['parentRects[0]'],rectangles);gl.uniform1fv(locations['parentRadii[0]'],radii);
  }
  function drawSurface(element,isButton,strength,sx,sy,rects,shapes) {
    var r=element.getBoundingClientRect();
    if(r.width<8||r.height<8||r.bottom<=originY||r.top>=originY+height||r.right<=originX||r.left>=originX+width)return false;
    var style=getComputedStyle(element);
    if(style.visibility==='hidden'||style.display==='none')return false;
    if(resizeObserver&&!observed.has(element)){resizeObserver.observe(element);observed.add(element);}
    rects.set([(r.left-originX)*sx,(r.top-originY)*sy,r.width*sx,r.height*sy],0);
    shapes.set([materialRadius(element,r)*sx,sx],0);
    gl.uniform1f(locations.buttonLens,isButton?1:0);
    gl.uniform1f(locations.overlayPass,1);
    gl.uniform1f(locations.intensity,intensity*lensScale*strength);
    gl.uniform1f(locations.focusBoost,0);
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
    var groups=[];
    document.querySelectorAll(GlassOptics.layers).forEach(function(element){
      if(element.closest('.modal-card'))return;
      var depth=0,parent=element.parentElement?.closest(GlassOptics.layers);
      while(parent&&depth<3){depth++;parent=parent.parentElement?.closest(GlassOptics.layers);}
      (groups[depth]||(groups[depth]=[])).push(element);
    });
    gl.enable(gl.SCISSOR_TEST);
    groups.forEach(function(group){
      if(!group)return;copyComposite();
      group.forEach(function(element){if(drawSurface(element,false,layerIntensity,sx,sy,rects,shapes))layerCount++;});
    });
    gl.disable(gl.SCISSOR_TEST);
  }
  function drawButtons(sx,sy,rects,shapes) {
    buttonCount=0;controlCount=0;if(!buttonIntensity&&!controlIntensity)return;
    copyComposite();gl.enable(gl.SCISSOR_TEST);
    document.querySelectorAll('button, '+GlassOptics.controls).forEach(function(button){
      if(button.closest('.modal-card')||button.matches('.ws-mode-toggle button'))return;
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
    if (!active || !event.target.matches('button, '+GlassOptics.controls) ||
        ['scale','transform','translate','left','width'].indexOf(event.propertyName) < 0 || event.target.closest('.modal-card')) return;
    motionUntil = event.type === 'transitionrun' ? performance.now() + 450 : 0;
    requestRender();
  }

  function requestRender() { if (active && !frame) frame = requestAnimationFrame(draw); }
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
    active = false;
    if (frame) cancelAnimationFrame(frame); frame = 0;
    waterAnimating = false;
    root.classList.remove('glass-gpu');
    if (resizeObserver) resizeObserver.disconnect(); observed.clear();
  }
  function destroy() {
    disable();
    window.removeEventListener('scroll', requestRender);
    window.removeEventListener('resize', requestRender);
    document.removeEventListener('visibilitychange', requestRender);
    document.removeEventListener('focusin', requestRender);
    document.removeEventListener('focusout', requestRender);
    document.removeEventListener('animationstart',onMaterialAnimation);document.removeEventListener('animationend',onMaterialAnimation);
    document.removeEventListener('transitionrun', onControlTransition);
    document.removeEventListener('transitionend', onControlTransition);
    if (gl) { gl.deleteTexture(texture); gl.deleteTexture(buttonTexture); gl.deleteProgram(program); gl.deleteBuffer(buffer); }
    if (canvas) canvas.remove();
    canvas = gl = source = null;
  }
  window.addEventListener('scroll', requestRender, { passive: true });
  window.addEventListener('resize', requestRender, { passive: true });
  document.addEventListener('visibilitychange', requestRender);
  document.addEventListener('focusin', requestRender);
  document.addEventListener('focusout', requestRender);
  document.addEventListener('animationstart',onMaterialAnimation);document.addEventListener('animationend',onMaterialAnimation);
  document.addEventListener('transitionrun', onControlTransition);
  document.addEventListener('transitionend', onControlTransition);
  window.GlassRenderer = {
    enable: enable, disable: disable, destroy: destroy, render: requestRender,
    setControlIntensity:function(value){controlIntensity=Math.max(0,Math.min(2,Number(value)||0));requestRender();},
    setLayerIntensity: function(value){layerIntensity=Math.max(0,Math.min(2,Number(value)||0));requestRender();},
    setButtonIntensity: function (value) { buttonIntensity = Math.max(0,Math.min(2,Number(value)||0)); requestRender(); },
    setIntensity: function (value) { intensity = value; requestRender(); },
    getState: function () { return { active: active && !failed, failed: failed, draws: draws, lenses:lenses+layerCount+buttonCount+controlCount,layers:layerCount,controls:controlCount,originX:originX,originY:originY,buttons: buttonCount, width: width, height: height, waterMotion: waterAnimating }; }
  };
})();
