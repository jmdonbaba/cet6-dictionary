/* Shared event-driven GPU wallpaper/card pass and scissored button lenses.
 * Text and controls stay in the DOM. No DOM capture, per-card render targets,
 * backdrop reads or perpetual animation loop. Native glass is the fallback.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var canvas, gl, program, texture, buttonTexture, source, buffer;
  var active = false, failed = false, frame = 0, intensity = 1, lensScale = 1, lensBand = 63;
  var width = 0, height = 0, theme = '', draws = 0, lenses = 0, buttonCount = 0, buttonIntensity = 1;
  var selector = '.card, .modal-card, .btn-fav-nav';
  var observed = new Set(), resizeObserver;
  var water = null, waterLoading = false;
  var locations = {};
  var motionUntil = 0;
  var MAX_LENSES = 16;
  var vertex = 'attribute vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }';
  var fragment = [
    'precision mediump float;',
    'uniform sampler2D wallpaper;',
    'uniform sampler2D underGlass;',
    'uniform float buttonLens;',
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
    'float sdf(vec2 p, vec2 h, float r){vec2 q=abs(p)-h+r; return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}',
    'vec3 sampleAt(vec2 p){ vec2 uv=clamp(p/viewport,vec2(.001),vec2(.999)); if(buttonLens>.5)return texture2D(underGlass,vec2(uv.x,1.-uv.y)).rgb; return texture2D(wallpaper,uv).rgb; }',
    'void main(){',
    ' vec2 pixel=vec2(gl_FragCoord.x,viewport.y-gl_FragCoord.y);',
    ' vec3 color=sampleAt(pixel);',
    ' for(int i=0;i<16;i++){',
    '  if(i>=count)break;',
    '  vec4 rect=rects[i]; vec2 halfSize=rect.zw*.5;',
    '  vec2 p=pixel-rect.xy-halfSize; float radius=shapes[i].x;',
    '  float d=sdf(p,halfSize,radius);',
    '  if(d<0.){',
    '   float unit=shapes[i].y;',
    '   float band=min(lensBand*unit,min(halfSize.x,halfSize.y)*mix(.8,.55,buttonLens));',
    '   float edge=pow(max(0.,1.+d/band),1.6);',
    '   vec2 normal=vec2(sdf(p+vec2(1.,0.),halfSize,radius)-sdf(p-vec2(1.,0.),halfSize,radius),',
    '                    sdf(p+vec2(0.,1.),halfSize,radius)-sdf(p-vec2(0.,1.),halfSize,radius));',
    '   normal=normal/max(length(normal),.001);',
    '   float gain=mix(1.,clamp(72.*unit/min(rect.z,rect.w),1.,2.6),buttonLens);',
    '   float bend=min(60.*unit,min(rect.z,rect.w)*.3)*edge*intensity*gain;',
    '   vec2 point=pixel-normal*bend-p*(.045*intensity*(1.-buttonLens));',
    '   if(i==touchIndex){',
    '    vec2 v=pixel-touch.xy; point+=v*exp(-dot(v,v)/max(1.,touch.z*touch.z))*.26*touch.w*intensity;',
    '   }',
    '   if(i==recoilIndex){',
    '    vec2 q=pixel-recoil.xy; point+=q*exp(-dot(q,q)/max(1.,recoil.z*recoil.z))*.32*recoil.w*intensity;',
    '   }',
    '   vec2 dispersion=normal*edge*2.2*unit*intensity;',
    '   color=vec3(sampleAt(point+dispersion).r,sampleAt(point).g,sampleAt(point-dispersion).b);',
    '  }',
    ' }',
    ' gl_FragColor=vec4(color,1.);',
    '}'
  ].join('\n');

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
      ['wallpaper','underGlass','buttonLens','viewport','rects[0]','shapes[0]','count','intensity','lensBand','touchIndex','recoilIndex','touch','recoil'].forEach(function (name) {
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
      script.src = 'assets/water-caustics-data.js';
      script.onload = function () { image.src = window.Cet6WaterTexture; script.remove(); };
      script.onerror = function () { waterLoading = false; script.remove(); };
      document.head.appendChild(script);
    } else image.src = 'assets/water-caustics.webp';
  }

  function draw() {
    frame = 0;
    if (!active || document.hidden) return;
    if (root.dataset.interface !== 'glass' || innerWidth <= 720) { root.classList.remove('glass-gpu'); return; }
    try {
      if (width !== innerWidth || height !== innerHeight || theme !== root.dataset.wallpaper) {
        width = innerWidth; height = innerHeight; theme = root.dataset.wallpaper;
        if (theme === 'water') loadWater();
        buildWallpaper();
      }
      var rects = new Float32Array(MAX_LENSES * 4), shapes = new Float32Array(MAX_LENSES * 2);
      var count = 0;
      var hoverElement=null,hoverIndex=-1,recoilElement=null,recoilIndex=-1;
      document.querySelectorAll(selector).forEach(function (element) {
        if (element.matches('.modal-card, button')) return;
        if (resizeObserver && !observed.has(element)) { resizeObserver.observe(element); observed.add(element); }
        var r = element.getBoundingClientRect();
        if (count >= MAX_LENSES || r.width < 32 || r.height < 32 || r.bottom < 0 || r.top > height) return;
        if (getComputedStyle(element).visibility === 'hidden') return;
        rects.set([r.left,r.top,r.width,r.height],count*4);
        shapes.set([parseFloat(getComputedStyle(element).borderTopLeftRadius)||22,0],count*2);
        if (window.GlassInteraction && GlassInteraction.matches(element)) {
          var effect=GlassInteraction.read(element);
          if(effect.hover[3]){hoverElement=element;hoverIndex=count;}
          if(effect.pulse[3]){recoilElement=element;recoilIndex=count;}
        }
        count++;
      });
      observed.forEach(function (element) { if (!element.isConnected) { resizeObserver.unobserve(element); observed.delete(element); } });
      setTouch(hoverElement,hoverIndex,recoilElement,recoilIndex,canvas.width/width,canvas.height/height);
      gl.uniform1f(locations.buttonLens, 0);
      gl.uniform1i(locations.count, count);
      gl.uniform1f(locations.intensity, intensity * lensScale);
      gl.uniform1f(locations.lensBand, lensBand);
      // gl_FragCoord is in framebuffer pixels; viewport uniforms use the same space.
      lenses = count;
      gl.uniform2f(locations.viewport, canvas.width, canvas.height);
      var sx = canvas.width / width, sy = canvas.height / height;
      for (var i=0;i<count;i++) { rects[i*4]*=sx;rects[i*4+1]*=sy;rects[i*4+2]*=sx;rects[i*4+3]*=sy;shapes[i*2]*=sx;shapes[i*2+1]=sx; }
      gl.uniform4fv(locations['rects[0]'], rects); gl.uniform2fv(locations['shapes[0]'], shapes);
      gl.drawArrays(gl.TRIANGLES,0,3);
      drawButtons(sx, sy, rects, shapes);
      draws++;
      if (!root.classList.contains('glass-gpu')) root.classList.add('glass-gpu');
      if (document.querySelector('.modal-card.active')) motionUntil = 0;
      if (performance.now() < motionUntil) requestRender();
    } catch (error) { failed = true; disable(); if (window.LiquidGlass) window.LiquidGlass.refresh(); }
  }

  // Copy the card-composited wallpaper once on-GPU. Each button draws only its
  // scissored pixels, so adding controls does not add full-screen shader loops.
  // Sampling this copy also keeps flat button centers identical to their parent.
  function drawButtons(sx, sy, rects, shapes) {
    buttonCount = 0;
    if (!buttonIntensity) return;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, buttonTexture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,canvas.width,canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(locations.buttonLens, 1);
    gl.uniform1f(locations.intensity, intensity * lensScale * buttonIntensity);
    gl.uniform1i(locations.count, 1);
    gl.enable(gl.SCISSOR_TEST);
    document.querySelectorAll('button').forEach(function (button) {
      if (button.closest('.modal-card')) return; // Modal-local native optics sit above its overlay.
      var r = button.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom <= 0 || r.top >= height || r.right <= 0 || r.left >= width) return;
      var style = getComputedStyle(button);
      if (style.visibility === 'hidden' || style.display === 'none') return;
      if (resizeObserver && !observed.has(button)) { resizeObserver.observe(button); observed.add(button); }
      var radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0,r.width/2,r.height/2);
      rects.set([r.left*sx,r.top*sy,r.width*sx,r.height*sy],0);
      shapes.set([radius*sx,sx],0);
      setTouch(button,0,button,0,sx,sy);
      gl.uniform4fv(locations['rects[0]'],rects); gl.uniform2fv(locations['shapes[0]'],shapes);
      var x = Math.max(0,Math.floor(r.left*sx)), y = Math.max(0,Math.floor(canvas.height-r.bottom*sy));
      var right = Math.min(canvas.width,Math.ceil(r.right*sx));
      var top = Math.min(canvas.height,Math.ceil(canvas.height-r.top*sy));
      gl.scissor(x,y,Math.max(0,right-x),Math.max(0,top-y));
      gl.drawArrays(gl.TRIANGLES,0,3); buttonCount++;
    });
    gl.disable(gl.SCISSOR_TEST);
  }

  function setTouch(hoverElement,hoverIndex,recoilElement,recoilIndex,sx,sy) {
    var h=hoverElement&&window.GlassInteraction ? GlassInteraction.read(hoverElement).hover : [0,0,1,0];
    var p=recoilElement&&window.GlassInteraction ? GlassInteraction.read(recoilElement).pulse : [0,0,1,0];
    gl.uniform1i(locations.touchIndex,h[3] ? hoverIndex : -1);
    gl.uniform1i(locations.recoilIndex,p[3] ? recoilIndex : -1);
    gl.uniform4f(locations.touch,h[0]*sx,h[1]*sy,h[2]*sx,h[3]);
    gl.uniform4f(locations.recoil,p[0]*sx,p[1]*sy,p[2]*sx,p[3]);
  }

  function onControlTransition(event) {
    if (!active || !event.target.matches('button') ||
        ['scale','transform','translate'].indexOf(event.propertyName) < 0 || event.target.closest('.modal-card')) return;
    motionUntil = event.type === 'transitionrun' ? performance.now() + 450 : 0;
    requestRender();
  }

  function requestRender() { if (active && !frame) frame = requestAnimationFrame(draw); }
  function enable(options) {
    if (!init()) return false;
    active = true;
    if (options && options.selector) selector = options.selector;
    if (options && options.intensity !== undefined) intensity = options.intensity;
    if (options && options.scale !== undefined) lensScale = options.scale / 64;
    if (options && options.band !== undefined) lensBand = options.band * 1.75;
    requestRender(); return true;
  }
  function disable() {
    active = false;
    if (frame) cancelAnimationFrame(frame); frame = 0;
    root.classList.remove('glass-gpu');
    if (resizeObserver) resizeObserver.disconnect(); observed.clear();
  }
  function destroy() {
    disable();
    window.removeEventListener('scroll', requestRender);
    window.removeEventListener('resize', requestRender);
    document.removeEventListener('visibilitychange', requestRender);
    document.removeEventListener('transitionrun', onControlTransition);
    document.removeEventListener('transitionend', onControlTransition);
    if (gl) { gl.deleteTexture(texture); gl.deleteTexture(buttonTexture); gl.deleteProgram(program); gl.deleteBuffer(buffer); }
    if (canvas) canvas.remove();
    canvas = gl = source = null;
  }
  window.addEventListener('scroll', requestRender, { passive: true });
  window.addEventListener('resize', requestRender, { passive: true });
  document.addEventListener('visibilitychange', requestRender);
  document.addEventListener('transitionrun', onControlTransition);
  document.addEventListener('transitionend', onControlTransition);
  window.GlassRenderer = {
    enable: enable, disable: disable, destroy: destroy, render: requestRender,
    setButtonIntensity: function (value) { buttonIntensity = Math.max(0,Math.min(2,Number(value)||0)); requestRender(); },
    setIntensity: function (value) { intensity = value; requestRender(); },
    getState: function () { return { active: active && !failed, failed: failed, draws: draws, lenses: lenses + buttonCount, buttons: buttonCount, width: width, height: height }; }
  };
})();
