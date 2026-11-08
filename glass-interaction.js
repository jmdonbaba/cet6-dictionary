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
  var edgeReach = 28, edgeSpan = 60, edgePad = 12; // Matches the decorative layer's CSS inset.
  var edgePointer = false, edgePending = false, hit = null;
  var edgeTarget = null, edge = null, edgePress = false, contour = null;
  var unstableCard = '[inert], .is-flipping, .is-resizing';

  function smooth(value) {
    var t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function edgeNear(element, x, y, press) {
    if (!element || element.closest(unstableCard)) return null;
    var bounds = element.getBoundingClientRect();
    var style = getComputedStyle(element);
    var borderX = parseFloat(style.borderLeftWidth), borderY = parseFloat(style.borderTopWidth);
    var left = bounds.left + borderX, top = bounds.top + borderY;
    var width = bounds.right - parseFloat(style.borderRightWidth) - left;
    var height = bounds.bottom - parseFloat(style.borderBottomWidth) - top;
    var radius = Math.min(parseFloat(style.borderTopLeftRadius), width / 2, height / 2);
    var cx = Math.max(radius, Math.min(width - radius, x - left));
    var cy = Math.max(radius, Math.min(height - radius, y - top));
    var dx = x - left - cx, dy = y - top - cy;
    var distance = Math.hypot(dx, dy);
    var gap = Math.abs(distance - radius);
    if (width < 32 || height < 32) return null;
    if (distance < .001) {
      // A pointer just inside the flat part can still be close to its rim.
      var gaps = [y - top, left + width - x, top + height - y, x - left];
      gap = Math.min.apply(null, gaps);
      var side = gaps.indexOf(gap);
      dx = [0, 1, 0, -1][side]; dy = [-1, 0, 1, 0][side];
      cx = x - left + dx * (gap - radius);
      cy = y - top + dy * (gap - radius);
      distance = 1;
    }
    if (!press && gap >= edgeReach) return null;
    var nx = dx / distance, ny = dy / distance;
    return { element:element, borderX:borderX, borderY:borderY, width:width, height:height, radius:radius, span:edgeSpan, x:cx + nx * radius,
      y:cy + ny * radius, nx:nx, ny:ny, gap:gap, pull:10.5 * smooth(1 - gap / edgeReach) };
  }

  function nearestEdge() {
    if (!edgePointer || pressed || !Number(root.style.getPropertyValue('--glass-refract-scale')) ||
        document.querySelector('.modal-card.active') ||
        hit?.closest?.('.settings-entry, .favorites-shortcuts, .page-jump-controls')) return null;
    var x = desired.x, y = desired.y;
    var direct = hit?.closest?.('.card');
    if (direct) return edgeNear(direct, x, y);
    // Bounded hit probes find visible neighbors without measuring every card.
    var step = edgeReach, diagonal = step * .707;
    var seen = new Set(), nearest = null;
    [[step,0],[-step,0],[0,step],[0,-step],[diagonal,diagonal],[-diagonal,diagonal],
      [diagonal,-diagonal],[-diagonal,-diagonal]].forEach(function (offset) {
      var card = document.elementFromPoint(x + offset[0], y + offset[1])?.closest('.card');
      if (!card || seen.has(card)) return;
      seen.add(card);
      var candidate = edgeNear(card, x, y);
      if (candidate && (!nearest || candidate.gap < nearest.gap)) nearest = candidate;
    });
    return nearest;
  }

  function edgePath(shape) {
    var w = shape.width, h = shape.height, r = shape.radius;
    var path = '';
    function point(x, y, tx, ty) {
      var dx = x - shape.x, dy = y - shape.y, d = Math.hypot(dx, dy);
      var u = Math.max(0, 1 - d / edgeSpan);
      var amount = shape.depth * smooth(u);
      var slope = d ? -shape.depth * 6 * u * (1 - u) * (dx * tx + dy * ty) / (d * edgeSpan) : 0;
      return [x + edgePad + shape.nx * amount, y + edgePad + shape.ny * amount,
        tx + shape.nx * slope, ty + shape.ny * slope];
    }
    function xy(x, y) { return x.toFixed(2) + ' ' + y.toFixed(2); }
    function curve(at, start, end) {
      var steps = Math.max(1, Math.ceil((end - start) / 12));
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
      var start = Math.max(0, center - edgeSpan), end = Math.min(length, center + edgeSpan);
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
    if (edge) edge.element.removeAttribute('data-glass-edge');
    edge = null; edgePress = false;
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
    if (!edge.element.hasAttribute('data-glass-edge')) edge.element.setAttribute('data-glass-edge', '');
  }

  function animateEdge(dt, easing) {
    if (edgePending) { edgePending = false; edgeTarget = nearestEdge(); }
    if (edge && (!edge.element.isConnected || edge.element.closest(unstableCard) ||
        document.querySelector('.modal-card.active') || !Number(root.style.getPropertyValue('--glass-refract-scale')))) clearEdge();
    if (!edge && edgeTarget) edge = Object.assign({ depth:0, velocity:0 }, edgeTarget);
    if (!edge) return false;
    var target = !edgePress && edgeTarget?.element === edge.element ? edgeTarget : null;
    var pull = target ? target.pull : 0;
    if (target) {
      edge.borderX = target.borderX; edge.borderY = target.borderY;
      edge.width = target.width; edge.height = target.height; edge.radius = target.radius;
      edge.x += (target.x - edge.x) * easing; edge.y += (target.y - edge.y) * easing;
      edge.nx += (target.nx - edge.nx) * easing; edge.ny += (target.ny - edge.ny) * easing;
    }
    // Analytic damped spring keeps the same rebound across refresh rates.
    var decay = 16, frequency = 23;
    var a = edge.depth - pull, b = (edge.velocity + decay * a) / frequency;
    var cos = Math.cos(frequency * dt), sin = Math.sin(frequency * dt), damping = Math.exp(-decay * dt);
    var displacement = damping * (a * cos + b * sin);
    edge.velocity = -decay * displacement + damping * frequency * (b * cos - a * sin);
    edge.depth = pull + displacement;
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
    var depth = edge?.element === element && Math.hypot(edge.x - shape.x, edge.y - shape.y) < edgeSpan ? edge.depth : 0;
    if (edge?.element !== element) clearEdge();
    edge = Object.assign({ depth:depth, velocity:-245 }, shape);
    edgePress = true;
  }

  function enabled() {
    return root.dataset.interface === 'glass' && window.LiquidGlass && LiquidGlass.enabled() && !motion.matches && !transparency.matches;
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
    desired.element = surface(target);
    desired.level = desired.element ? (desired.element === pressed ? 1.5 : 1) : 0;
  }
  function refresh() {
    if (!pointerPresent || !enabled()) return;
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
    if (!enabled()) return;
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
