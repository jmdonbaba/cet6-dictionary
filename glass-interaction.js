/* Local optical pressure and a finite damped spring. No idle animation loop. */
(function () {
  'use strict';
  var root = document.documentElement;
  var motion = matchMedia('(prefers-reduced-motion: reduce)');
  var transparency = matchMedia('(prefers-reduced-transparency: reduce)');
  var hover = { element:null, x:0, y:0, level:0 };
  var desired = { element:null, x:0, y:0, level:0 };
  var pulse = { element:null, x:0, y:0, level:0, start:0 };
  var frame = 0, previous = 0, pressed = null;
  var pointerPresent = false, hitTestPending = false;
  var decorations = new Map();
  var edgePad = 20; // Matches the decorative layers' CSS inset.
  var edgePointer = false, edgePending = false, hit = null;
  var edgeTarget = null, edge = null, edgePress = false, contour = null;
  var fieldPlate = null, fieldHost = null, nativeField = null;
  var unstableCard = '[inert], [hidden], .is-flipping, .is-resizing, .glass-jelly, [data-favorites-handoff-cover]';
  var mainPlates = '.card, .modal-card, .btn-fav-nav';
  var controls = 'button:not(:disabled, .ws-mode-toggle button, .mobile-tool-tabs button), .ws-mode-slider, ' +
    GlassOptics.inputs + ', ' + GlassOptics.layers + ', ' + GlassOptics.modalLayers +
    ', .more-menu, .study-export-menu, .fav-search-dropdown, .ws-search-dropdown, .toast';
  var magneticSurfaces = mainPlates + ', ' + controls;
  var probeOffsets = [16, 35, 56, 92].flatMap(function (step) {
    var diagonal = step * Math.SQRT1_2;
    return [[step,0],[-step,0],[0,step],[0,-step],[diagonal,diagonal],[-diagonal,diagonal],
      [diagonal,-diagonal],[-diagonal,-diagonal]];
  });

  function smooth(value) {
    var t = Math.max(0, Math.min(1, value));
    return t * t * t * (10 + t * (6 * t - 15));
  }

  function edgeNear(element, x, y, press) {
    if (!element || element.closest(unstableCard)) return null;
    var bounds = element.getBoundingClientRect();
    var style = getComputedStyle(element);
    if (style.visibility !== 'visible' || Number(style.opacity) === 0) return null;
    var borderX = parseFloat(style.borderLeftWidth), borderY = parseFloat(style.borderTopWidth);
    var left = bounds.left + borderX, top = bounds.top + borderY;
    var width = bounds.right - parseFloat(style.borderRightWidth) - left;
    var height = bounds.bottom - parseFloat(style.borderBottomWidth) - top;
    var short = Math.min(width, height);
    if (short < 10) return null;
    var radius = parseFloat(style.borderTopLeftRadius) || 0;
    if (style.borderTopLeftRadius.includes('%')) radius *= short / 100;
    radius = Math.min(radius, short / 2);
    var cx = Math.max(radius, Math.min(width - radius, x - left));
    var cy = Math.max(radius, Math.min(height - radius, y - top));
    var dx = x - left - cx, dy = y - top - cy;
    var distance = Math.hypot(dx, dy);
    var signed = distance - radius;
    if (distance < .001) {
      // A pointer just inside the flat part can still be close to its rim.
      var gaps = [y - top, left + width - x, top + height - y, x - left];
      var gap = Math.min.apply(null, gaps);
      var side = gaps.indexOf(gap);
      dx = [0, 1, 0, -1][side]; dy = [-1, 0, 1, 0][side];
      cx = x - left + dx * (gap - radius);
      cy = y - top + dy * (gap - radius);
      distance = 1;
      signed = -gap;
    }
    var gap = Math.abs(signed);
    var large = element.matches(mainPlates) && short >= 60;
    var reach = large ? 98 : 54;
    // Fade before the medial axis, where the nearest inside edge changes sides.
    if (signed < 0) reach = Math.min(reach, short * .49);
    if (!press && gap >= reach) return null;
    var nx = dx / distance, ny = dy / distance;
    var amplitude = large ? 16 : Math.min(6.5, short * .17);
    var span = Math.min(108, short * .82, Math.max(width, height) * .52);
    var pull = amplitude * signed / Math.hypot(signed, amplitude * 1.12) * smooth(1 - gap / reach);
    return { element:element, borderX:borderX, borderY:borderY, width:width, height:height, radius:radius, span:span, x:cx + nx * radius,
      y:cy + ny * radius, nx:nx, ny:ny, gap:gap, pull:pull };
  }

  function attractionEnabled() { return root.dataset.mouseAttraction !== 'false'; }
  function canBend() {
    return !LiquidGlass.supported || Number(root.style.getPropertyValue('--glass-refract-scale')) > 0;
  }
  function nearestEdge() {
    if (!attractionEnabled() || !edgePointer || pressed || !canBend()) return null;
    var x = desired.x, y = desired.y;
    var modal = document.querySelector('.modal-card.active');
    var seen = new Set(), nearest = null;
    function consider(element) {
      if (!element || seen.has(element) || (modal && !modal.contains(element))) return;
      seen.add(element);
      var candidate = edgeNear(element, x, y);
      if (candidate && (!nearest || candidate.gap < nearest.gap)) nearest = candidate;
    }
    function inspect(element) {
      consider(element?.closest?.('.ws-mode-toggle')?.querySelector('.ws-mode-slider'));
      var surface = element?.closest?.(magneticSurfaces);
      while (surface && !seen.has(surface) && (!modal || modal.contains(surface))) {
        consider(surface);
        surface = surface.parentElement?.closest(magneticSurfaces);
      }
    }
    inspect(hit);
    // Check nearby painted surfaces, not every element in a long results list.
    for (var offset of probeOffsets) {
      if (nearest && nearest.gap < 9) break;
      inspect(document.elementFromPoint(x + offset[0], y + offset[1]));
    }
    return nearest;
  }

  function edgePath(shape) {
    var w = shape.width, h = shape.height, r = shape.radius;
    var path = '';
    function point(x, y, tx, ty) {
      var dx = x - shape.x, dy = y - shape.y, d = Math.hypot(dx, dy);
      var u = Math.max(0, 1 - d / shape.span);
      var amount = shape.depth * smooth(u);
      var slope = d ? -shape.depth * 30 * u * u * (1 - u) ** 2 * (dx * tx + dy * ty) / (d * shape.span) : 0;
      return [x + edgePad + shape.nx * amount, y + edgePad + shape.ny * amount,
        tx + shape.nx * slope, ty + shape.ny * slope];
    }
    function xy(x, y) { return x.toFixed(2) + ' ' + y.toFixed(2); }
    function curve(at, start, end) {
      var steps = Math.max(1, Math.ceil((end - start) / Math.min(10, shape.span / 4)));
      var length = (end - start) / steps, k = length / 3;
      var a = at(start);
      for (var i = 1; i <= steps; i++) {
        var b = at(start + i * length);
        path += 'C' + xy(a[0] + a[2] * k, a[1] + a[3] * k) + ' ' +
          xy(b[0] - b[2] * k, b[1] - b[3] * k) + ' ' + xy(b[0], b[1]);
        a = b;
      }
    }
    function side(x, y, dx, dy, length) {
      var at = function (s) { return point(x + dx * s, y + dy * s, dx, dy); };
      var center = (shape.x - x) * dx + (shape.y - y) * dy;
      var start = Math.max(0, center - shape.span), end = Math.min(length, center + shape.span);
      if (start < end) {
        if (start) path += 'L' + xy.apply(null, at(start));
        curve(at, start, end);
      }
      if (start >= end || end < length) path += 'L' + xy.apply(null, at(length));
    }
    function corner(x, y, angle) {
      if (!r) return;
      curve(function (s) {
        var a = angle + s / r, cos = Math.cos(a), sin = Math.sin(a);
        return point(x + r * cos, y + r * sin, -sin, cos);
      }, 0, Math.PI * r / 2);
    }
    path = 'M' + xy.apply(null, point(r, 0, 1, 0));
    side(r,0,1,0,w-2*r); corner(w-r,r,-Math.PI/2);
    side(w,r,0,1,h-2*r); corner(w-r,h-r,0);
    side(w-r,h,-1,0,w-2*r); corner(r,h-r,Math.PI/2);
    side(0,h-r,0,-1,h-2*r); corner(r,r,Math.PI);
    return path + 'Z';
  }

  function clearEdge() {
    if (edge) {
      var element = edge.element;
      element.removeAttribute('data-glass-edge');
      element.removeAttribute('data-glass-edge-position');
      element.style.removeProperty('--glass-edge-fill');
      element.style.removeProperty('--glass-edge-sheen');
      element.style.removeProperty('--glass-edge-frost');
    }
    fieldPlate?.remove();
    fieldHost?.classList.remove('glass-edge-field-host', 'glass-edge-field-position');
    nativeField?.classList.remove('glass-edge-field-replaced');
    fieldPlate = fieldHost = nativeField = null;
    edge = null; edgePress = false;
  }

  function mountEdge(element) {
    if (element.matches(mainPlates)) {
      element.setAttribute('data-glass-edge', 'plate');
      return;
    }
    var style = getComputedStyle(element);
    if (!element.matches('input, textarea')) {
      element.style.setProperty('--glass-edge-fill', style.backgroundColor);
      element.style.setProperty('--glass-edge-sheen', style.backgroundImage);
      var frost = style.backdropFilter;
      if (!frost || frost === 'none') frost = getComputedStyle(element, '::before').backdropFilter;
      if (frost && frost !== 'none') element.style.setProperty('--glass-edge-frost', frost);
      if (style.position === 'static') element.setAttribute('data-glass-edge-position', '');
      element.setAttribute('data-glass-edge', 'control');
      return;
    }
    fieldHost = element.parentElement;
    nativeField = LiquidGlass.inputPlate(element);
    fieldPlate = document.createElement('span');
    fieldPlate.className = 'glass-edge-field';
    fieldPlate.setAttribute('aria-hidden', 'true');
    fieldPlate.style.backgroundColor = style.backgroundColor;
    fieldPlate.style.backgroundImage = style.backgroundImage;
    fieldPlate.style.filter = nativeField?.style.filter || '';
    if (nativeField) fieldPlate.style.backdropFilter = getComputedStyle(nativeField).backdropFilter;
    fieldHost.classList.add('glass-edge-field-host');
    if (getComputedStyle(fieldHost).position === 'static') fieldHost.classList.add('glass-edge-field-position');
    fieldHost.appendChild(fieldPlate);
    nativeField?.classList.add('glass-edge-field-replaced');
    element.setAttribute('data-glass-edge', 'field');
  }

  function fitField() {
    var r = edge.element.getBoundingClientRect(), p = fieldHost.getBoundingClientRect();
    var sx = p.width / (fieldHost.offsetWidth || p.width), sy = p.height / (fieldHost.offsetHeight || p.height);
    var x = (r.left - p.left) / sx - fieldHost.clientLeft + fieldHost.scrollLeft;
    var y = (r.top - p.top) / sy - fieldHost.clientTop + fieldHost.scrollTop;
    var inset = [x + edge.borderX - edgePad, y + edge.borderY - edgePad, edge.width + edgePad * 2, edge.height + edgePad * 2];
    var geometry = inset.map(function (value) { return value.toFixed(2) + 'px'; }).join(' ');
    if (fieldPlate._geometry === geometry) return;
    ['left', 'top', 'width', 'height'].forEach(function (name, index) {
      fieldPlate.style[name] = inset[index].toFixed(2) + 'px';
    });
    fieldPlate._geometry = geometry;
  }

  function paintEdge() {
    if (!contour) {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('class', 'glass-edge-defs');
      svg.innerHTML = '<defs><clipPath id="glass-edge-contour"><path/></clipPath></defs>';
      contour = svg.querySelector('path');
      document.body.appendChild(svg);
    }
    contour.setAttribute('d', edgePath(edge));
    if (!edge.element.hasAttribute('data-glass-edge')) mountEdge(edge.element);
    if (fieldPlate) fitField();
  }

  function animateEdge(dt, easing) {
    if (edgePending) { edgePending = false; edgeTarget = nearestEdge(); }
    var modal = edge && document.querySelector('.modal-card.active');
    if (edge && (!edge.element.isConnected || edge.element.closest(unstableCard) || (!edgePress && !attractionEnabled()) ||
        (modal && !modal.contains(edge.element)) || (edge.element.closest('.modal-card') && !modal) ||
        !canBend())) clearEdge();
    if (!edge && edgeTarget) edge = Object.assign({ depth:0, velocity:0 }, edgeTarget);
    if (!edge) return false;
    var target = !edgePress && edgeTarget?.element === edge.element ? edgeTarget : null;
    var pull = target ? target.pull : 0;
    if (target) {
      edge.borderX = target.borderX; edge.borderY = target.borderY;
      edge.width = target.width; edge.height = target.height; edge.radius = target.radius; edge.span = target.span;
      edge.x += (target.x - edge.x) * easing; edge.y += (target.y - edge.y) * easing;
      edge.nx += (target.nx - edge.nx) * easing; edge.ny += (target.ny - edge.ny) * easing;
    }
    // Analytic damped spring keeps the same rebound across refresh rates.
    var handingOff = !target && !edgePress && edgeTarget;
    var decay = edgePress || !target ? (handingOff ? 18 : 10.5) : 17;
    var frequency = handingOff ? 31 : 24;
    var a = edge.depth - pull, b = (edge.velocity + decay * a) / frequency;
    var cos = Math.cos(frequency * dt), sin = Math.sin(frequency * dt), damping = Math.exp(-decay * dt);
    var displacement = damping * (a * cos + b * sin);
    edge.velocity = -decay * displacement + damping * frequency * (b * cos - a * sin);
    var next = pull + displacement;
    if (handingOff && edge.depth * next <= 0) { clearEdge(); return true; }
    edge.depth = next;
    var moving = Math.abs(displacement) > .035 || Math.abs(edge.velocity) > .6 ||
      Boolean(target && Math.hypot(target.x - edge.x, target.y - edge.y) > .15);
    if (!moving) {
      if (!target) { clearEdge(); return Boolean(edgeTarget); }
      Object.assign(edge, target, { depth:pull, velocity:0 });
    }
    paintEdge();
    return moving;
  }

  function pressCard(element, x, y) {
    if (!Number(root.style.getPropertyValue('--glass-refract-scale'))) return;
    var shape = edgeNear(element, x, y, true);
    if (!shape) return;
    var depth = edge?.element === element && Math.hypot(edge.x - shape.x, edge.y - shape.y) < edge.span ? edge.depth : 0;
    if (edge?.element !== element) clearEdge();
    edge = Object.assign({ depth:depth, velocity:-280 }, shape);
    edgePress = true;
  }

  function enabled() {
    return root.dataset.interface === 'glass' && window.LiquidGlass && !motion.matches && !transparency.matches &&
      (LiquidGlass.enabled() || (!LiquidGlass.supported && attractionEnabled()));
  }
  function surface(target) {
    if (!target || !target.closest || !target.isConnected) return null;
    var button = target.closest('button');
    if (button && button.disabled) return null;
    if(button&&button.closest('.ws-mode-toggle'))return button.closest('.ws-mode-toggle').querySelector('.ws-mode-slider');
    return button || target.closest('.card, .modal-card, '+GlassOptics.layers+', '+GlassOptics.controls+', '+GlassOptics.modalLayers);
  }
  function render() {
    if (window.GlassRenderer && (!document.querySelector('.modal-card.active') || document.querySelector('.modal-card.active.glass-modal-gpu'))) GlassRenderer.render();
    if (window.LiquidGlass && LiquidGlass.interact) LiquidGlass.interact(hover,pulse);
  }
  function request() { if (!frame) frame = requestAnimationFrame(tick); }
  function setTarget(target) {
    hit = target;
    desired.element = edgePointer && !attractionEnabled() ? null : surface(target);
    desired.level = desired.element ? (desired.element === pressed ? 1.5 : 1) : 0;
  }
  function refresh() {
    if (!enabled()) {
      if (edge || hover.element || pulse.element) reset();
      return;
    }
    if (!pointerPresent) return;
    hitTestPending = edgePending = true;
    request();
  }
  function tick(now) {
    frame = 0;
    if (!enabled() || document.hidden) { reset(); return; }
    if (hitTestPending) {
      hitTestPending = false;
      setTarget(document.elementFromPoint(desired.x, desired.y));
    }
    var dt = previous ? Math.min(.05,(now-previous)/1000) : 1/60;
    previous = now;
    if (desired.element && desired.element !== hover.element) {
      hover.element = desired.element; hover.x = desired.x; hover.y = desired.y; hover.level = 0;
    }
    if (desired.element && !desired.element.isConnected) {desired.element=null;desired.level=0;}
    if (pulse.element && !pulse.element.isConnected) pulse.element=null;
    var targetLevel = desired.element ? desired.level : 0;
    var easing = 1-Math.exp(-20*dt);
    hover.x += (desired.x-hover.x)*easing;
    hover.y += (desired.y-hover.y)*easing;
    hover.level += (targetLevel-hover.level)*easing;
    var moving = Math.abs(targetLevel-hover.level)>.001 || Math.abs(desired.x-hover.x)>.1 || Math.abs(desired.y-hover.y)>.1;
    if (!moving) { hover.x=desired.x;hover.y=desired.y;hover.level=targetLevel; }
    if (!hover.level && !desired.element) hover.element=null;
    var t = (now-pulse.start)/1000;
    if (pulse.element && t<.75) { pulse.level=Math.exp(-8*t)*Math.cos(22*t);moving=true; }
    else { pulse.element=null;pulse.level=0; }
    moving = animateEdge(dt, easing) || moving;
    render();
    if (moving) request(); else previous=0;
  }
  function move(event) {
    if (!enabled()) return;
    if (event.pointerType==='touch') {
      edgePointer = edgePending = false; edgeTarget = null; clearEdge(); return;
    }
    pointerPresent = true;
    edgePointer = event.pointerType === 'mouse';
    edgePending = true;
    hitTestPending = false;
    desired.x = event.clientX;
    desired.y = event.clientY;
    setTarget(event.target);
    request();
  }
  function leave(event) {
    if (event.relatedTarget) return;
    pointerPresent = hitTestPending = false;
    edgePointer = edgePending = false; edgeTarget = null;
    desired.element = pressed = null;
    desired.level = 0;
    if (enabled()) request();
  }
  function removeDecoration(element) {
    clearTimeout(decorations.get(element)); decorations.delete(element);
    element.classList.remove('glass-jelly','glass-jelly-positioned');
    element.style.removeProperty('--glass-press-x');element.style.removeProperty('--glass-press-y');
  }
  function click(event) {
    if (!enabled() || !LiquidGlass.enabled()) return;
    var element=surface(event.target);
    if (!element) return;
    var r=element.getBoundingClientRect();
    if(!r.width||!r.height)return;
    pulse.element=element;pulse.x=event.detail ? event.clientX : r.left+r.width/2;
    pulse.y=event.detail ? event.clientY : r.top+r.height/2;pulse.start=performance.now();pulse.level=1;
    var card = event.target.closest('.card');
    if (card && !event.target.closest('button, a, input, textarea, select, label')) {
      // Large cards use one contour for the spring, instead of scaling each plate.
      pressCard(card, pulse.x, pulse.y);
      request();
      return;
    }
    if (edge?.element === element) { clearEdge(); edgeTarget = null; }
    removeDecoration(element);
    if (getComputedStyle(element).position==='static') element.classList.add('glass-jelly-positioned');
    element.style.setProperty('--glass-press-x',Math.max(0,Math.min(100,(pulse.x-r.left)/r.width*100))+'%');
    element.style.setProperty('--glass-press-y',Math.max(0,Math.min(100,(pulse.y-r.top)/r.height*100))+'%');
    // Restart a repeat click's decorative animation without changing the hit box.
    void element.offsetWidth;
    element.classList.add('glass-jelly');
    decorations.set(element,setTimeout(function(){removeDecoration(element);},720));
    request();
  }
  function reset() {
    if (frame) cancelAnimationFrame(frame);frame=0;previous=0;pressed=null;
    pointerPresent = hitTestPending = false;
    edgePointer = edgePending = false; edgeTarget = hit = null; clearEdge();
    hover.element=desired.element=pulse.element=null;hover.level=desired.level=pulse.level=0;
    decorations.forEach(function (_,element){removeDecoration(element);});render();
  }
  function down(event) { if(enabled()){pressed=surface(event.target);move(event);} }
  function up() { pressed=null;edgePending=true;desired.level=desired.element ? 1 : 0;if(enabled())request(); }
  function read(element) {
    if (hover.element!==element && pulse.element!==element) return {hover:[0,0,1,0],pulse:[0,0,1,0]};
    var r=element.getBoundingClientRect();
    var radius=element.matches('button, '+GlassOptics.controls) ? Math.min(42,Math.max(14,Math.min(r.width,r.height)*.8)) : 78;
    return {
      hover:hover.element===element ? [hover.x,hover.y,radius,hover.level] : [0,0,1,0],
      pulse:pulse.element===element ? [pulse.x,pulse.y,radius*1.2,pulse.level] : [0,0,1,0]
    };
  }
  function destroy() {
    reset();
    contour?.ownerSVGElement.remove(); contour = null;
    document.removeEventListener('pointermove',move);document.removeEventListener('pointerout',leave);
    document.removeEventListener('pointerdown',down);document.removeEventListener('pointerup',up);
    document.removeEventListener('pointercancel',up);document.removeEventListener('click',click);
    document.removeEventListener('appearancechange',reset);document.removeEventListener('visibilitychange',reset);
    document.removeEventListener('liquidglasschange',refresh);window.removeEventListener('resize',refresh);
    window.removeEventListener('blur',reset);window.removeEventListener('scroll',refresh,true);
    motion.removeEventListener('change',reset);transparency.removeEventListener('change',reset);
  }
  document.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerout',leave,{passive:true});
  document.addEventListener('pointerdown',down,{passive:true});document.addEventListener('pointerup',up,{passive:true});
  document.addEventListener('pointercancel',up,{passive:true});document.addEventListener('click',click,{passive:true});
  document.addEventListener('appearancechange',reset);document.addEventListener('visibilitychange',reset);
  document.addEventListener('liquidglasschange',refresh);
  window.addEventListener('resize',refresh,{passive:true});
  window.addEventListener('blur',reset);
  window.addEventListener('scroll',refresh,{passive:true,capture:true});
  motion.addEventListener('change',reset);transparency.addEventListener('change',reset);
  window.GlassInteraction={ read:read, readEdge:function(){return edge;}, reset:reset, destroy:destroy, refresh:refresh,
    target:function(){return hover.element || pulse.element;},
    matches:function(element){return hover.element===element || pulse.element===element;},
    getState:function(){return {hover:hover.level,spring:pulse.level,running:!!frame};}
  };
})();
