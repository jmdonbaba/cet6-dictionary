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
  var edgePointer = false, edgePending = false;
  var edges = new Map(), edgeTargets = new Map(), contours = null, contourSerial = 0;
  var registered = new Set(), visible = new Set(), visibilityObserver, topologyObserver, topologyDirty = true;
  var unstableCard = '[inert], [hidden], :disabled, .is-flipping, .is-resizing, .glass-jelly, [data-favorites-handoff-cover]';
  var mainPlates = '.card, .modal-card, .btn-fav-nav';
  var controls = 'button:not(.ws-mode-toggle button, .mobile-tool-tabs button), .ws-mode-slider, ' +
    GlassOptics.inputs + ', ' + GlassOptics.layers + ', ' + GlassOptics.modalLayers +
    ', .more-menu, .study-export-menu, .fav-search-dropdown, .ws-search-dropdown, .toast';
  var magneticSurfaces = mainPlates + ', ' + controls;

  function smooth(value) {
    var t = Math.max(0, Math.min(1, value));
    return t * t * t * (10 + t * (6 * t - 15));
  }

  function attractionForce(signed, short) {
    var gap = Math.abs(signed);
    return Math.sign(signed) * Math.min(11.5 * smooth(gap / 5) * smooth(1 - gap / 98), short * .31);
  }

  function splitInputRims(shape, x, y, short) {
    var r = shape.radius, h = shape.height;
    var anchorX = Math.max(r, Math.min(shape.width - r, x));
    var blend = smooth((Math.min(x, shape.width - x) - r) / 22);
    var nearestBottom = shape.y > h / 2;
    function rim(bottom) {
      var at = bottom ? h : 0;
      var ny = bottom ? 1 : -1;
      var pull = attractionForce((y - at) * ny, short) * blend;
      if (bottom === nearestBottom) {
        return { x:shape.x + (anchorX - shape.x) * blend, y:shape.y + (at - shape.y) * blend,
          nx:shape.nx * (1 - blend), ny:shape.ny + (ny - shape.ny) * blend, pull:pull + shape.pull * (1 - blend) };
      }
      return { x:anchorX, y:at, nx:0, ny:ny, pull:pull };
    }
    var top = rim(false), bottom = rim(true);
    // Leave enough room for text when both long edges pull inward.
    var inward = Math.max(0, -top.pull) + Math.max(0, -bottom.pull);
    if (inward > h * .38 && top.pull < 0 && bottom.pull < 0) {
      top.pull *= h * .38 / inward;
      bottom.pull *= h * .38 / inward;
    }
    return Object.assign(shape, top, { other:bottom });
  }

  function edgeNear(element, x, y, press) {
    var bounds = element.getBoundingClientRect();
    if (bounds.width < 10 || bounds.height < 10 ||
        (!press && (x < bounds.left - 98 || x > bounds.right + 98 || y < bounds.top - 98 || y > bounds.bottom + 98)) ||
        element.closest(unstableCard)) return null;
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
    var reach = 98;
    if (!press && gap >= reach) return null;
    var nx = dx / distance, ny = dy / distance;
    // A long side gives the curve room to flatten. Its narrow axis still
    // fades before reaching the glass on the opposite side.
    var spanLimit = large ? 120 : 148;
    var spanX = Math.min(spanLimit, width * .88), spanY = Math.min(spanLimit, height * .88);
    var shape = { element:element, borderX:borderX, borderY:borderY, width:width, height:height, radius:radius,
      spanX:spanX, spanY:spanY, x:cx + nx * radius, y:cy + ny * radius, nx:nx, ny:ny,
      pull:attractionForce(signed, short) };
    return width > height * 1.4 && element.matches(GlassOptics.inputs)
      ? splitInputRims(shape, x - left, y - top, short) : shape;
  }

  function attractionEnabled() { return root.dataset.mouseAttraction !== 'false'; }
  function canBend() {
    return !LiquidGlass.supported || Number(root.style.getPropertyValue('--glass-refract-scale')) > 0;
  }
  function requestEdgeRefresh() {
    if (!edgePointer || !attractionEnabled()) return;
    edgePending = true;
    request();
  }
  function trackSurfaces() {
    if (!topologyObserver) {
      if (window.IntersectionObserver) {
        visibilityObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && registered.has(entry.target)) visible.add(entry.target);
            else visible.delete(entry.target);
          });
          requestEdgeRefresh();
        });
      }
      topologyObserver = new MutationObserver(function (records) {
        var changed = records.some(function (record) {
          return [...record.addedNodes, ...record.removedNodes].some(function (node) {
            return node.matches?.(magneticSurfaces) || node.querySelector?.(magneticSurfaces);
          });
        });
        if (changed) { topologyDirty = true; requestEdgeRefresh(); }
      });
      topologyObserver.observe(document.body, { childList:true, subtree:true });
    }
    if (!topologyDirty) return;
    topologyDirty = false;
    var next = new Set(document.querySelectorAll(magneticSurfaces));
    registered.forEach(function (element) {
      if (!next.has(element)) { visibilityObserver?.unobserve(element); visible.delete(element); }
    });
    next.forEach(function (element) {
      if (!registered.has(element)) visibilityObserver?.observe(element);
    });
    registered = next;
  }
  function updateEdgeTargets(modal) {
    edgeTargets.clear();
    if (!canBend()) return;
    if (attractionEnabled() && edgePointer) {
      trackSurfaces();
      // Only measure viewport-visible surfaces. Every eligible edge uses its
      // own distance, independently of the element receiving pointer events.
      (visibilityObserver ? visible : registered).forEach(function (element) {
        if (modal ? !modal.contains(element) : element.closest('.modal-card')) return;
        var candidate = edgeNear(element, desired.x, desired.y);
        if (candidate && (Math.abs(candidate.pull) > .035 || Math.abs(candidate.other?.pull || 0) > .035)) {
          edgeTargets.set(element, candidate);
        }
      });
    }
    var focused = focusedInput();
    if (focused && (modal ? modal.contains(focused) : !focused.closest('.modal-card'))) {
      var target = edgeTargets.get(focused);
      if (!target) {
        target = edgeNear(focused, 0, 0, true);
        if (!target) return;
        var current = edges.get(focused);
        if (current) {
          target.x = current.x; target.y = current.y;
          target.nx = current.nx; target.ny = current.ny;
        }
        if (target.other) target.other = Object.assign({}, current?.other || target.other, { pull:0 });
        target.pull = 0;
        edgeTargets.set(focused, target);
      }
      target.focus = true;
    }
  }

  function focusedInput() {
    var active = document.activeElement;
    return active?.matches(GlassOptics.inputs) ? active : null;
  }

  function edgePath(shape) {
    var w = shape.width, h = shape.height, r = shape.radius;
    var spanX = shape.spanX, spanY = shape.spanY;
    var rims = shape.other ? [shape, shape.other] : [shape];
    var path = '';
    function point(x, y, tx, ty) {
      var px = x + edgePad, py = y + edgePad, sx = tx, sy = ty;
      for (var rim of rims) {
        if (!rim.depth) continue;
        var dx = (x - rim.x) / spanX, dy = (y - rim.y) / spanY;
        // The cubic envelope goes flat in slope and curvature at its boundary.
        var u = Math.max(0, 1 - dx * dx - dy * dy);
        var amount = rim.depth * u * u * u;
        var slope = -6 * rim.depth * u * u * (dx * tx / spanX + dy * ty / spanY);
        px += rim.nx * amount; py += rim.ny * amount;
        sx += rim.nx * slope; sy += rim.ny * slope;
      }
      return [px, py, sx, sy];
    }
    function xy(x, y) { return x.toFixed(2) + ' ' + y.toFixed(2); }
    function curve(at, start, end) {
      var steps = Math.max(1, Math.ceil((end - start) / Math.min(12, spanX / 4, spanY / 4)));
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
      var start = length, end = 0;
      for (var rim of rims) {
        if (!rim.depth) continue;
        var center = (rim.x - x) * dx + (rim.y - y) * dy;
        var cross = dx ? (y - rim.y) / spanY : (x - rim.x) / spanX;
        if (Math.abs(cross) >= 1) continue;
        var reach = (dx ? spanX : spanY) * Math.sqrt(1 - cross * cross);
        start = Math.min(start, Math.max(0, center - reach));
        end = Math.max(end, Math.min(length, center + reach));
      }
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

  function clearEdge(edge) {
    var element = edge.element;
    element.removeAttribute('data-glass-edge');
    element.removeAttribute('data-glass-edge-position');
    ['clip','fill','sheen','frost'].forEach(function (name) { element.style.removeProperty('--glass-edge-' + name); });
    edge.path?.parentNode.remove();
    edge.rim?.remove();
    edge.fieldPlate?.remove();
    if (edge.fieldHost && !edge.fieldHost.querySelector(':scope > .glass-edge-field')) {
      edge.fieldHost.classList.remove('glass-edge-field-host', 'glass-edge-field-position');
    }
    edge.nativeField?.classList.remove('glass-edge-field-replaced');
    edges.delete(element);
  }

  function mountEdge(edge) {
    var element = edge.element;
    var ns = 'http://www.w3.org/2000/svg';
    if (!contours) {
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('class', 'glass-edge-defs');
      svg.innerHTML = '<defs><linearGradient id="glass-input-rim-light" x1="10%" y1="0%" x2="90%" y2="100%">' +
        '<stop stop-color="#dcecf8" stop-opacity=".76"/><stop offset=".3" stop-color="#c9e1f6" stop-opacity=".5"/>' +
        '<stop offset=".64" stop-color="#d6dbf5" stop-opacity=".54"/><stop offset="1" stop-color="#e0ebf8" stop-opacity=".72"/>' +
        '</linearGradient></defs>';
      contours = svg.querySelector('defs');
      document.body.appendChild(svg);
    }
    var clip = document.createElementNS(ns, 'clipPath');
    clip.id = 'glass-edge-contour-' + (++contourSerial);
    edge.path = document.createElementNS(ns, 'path');
    edge.path.id = clip.id + '-shape';
    clip.appendChild(edge.path);
    contours.appendChild(clip);
    var url = 'url(#' + clip.id + ')';
    element.style.setProperty('--glass-edge-clip', url);
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
    var fieldHost = edge.fieldHost = element.parentElement;
    var nativeField = edge.nativeField = LiquidGlass.inputPlate(element);
    var fieldPlate = edge.fieldPlate = document.createElement('span');
    fieldPlate.className = 'glass-edge-field';
    fieldPlate.setAttribute('aria-hidden', 'true');
    fieldPlate.style.backgroundColor = style.backgroundColor;
    fieldPlate.style.backgroundImage = style.backgroundImage;
    fieldPlate.style.setProperty('--glass-edge-clip', url);
    fieldPlate.style.filter = nativeField?.style.filter || '';
    if (nativeField) fieldPlate.style.backdropFilter = getComputedStyle(nativeField).backdropFilter;
    mountRim(edge, fieldPlate, 'glass-edge-focus-rim');
    fieldHost.classList.add('glass-edge-field-host');
    if (getComputedStyle(fieldHost).position === 'static') fieldHost.classList.add('glass-edge-field-position');
    element.after(fieldPlate);
    nativeField?.classList.add('glass-edge-field-replaced');
    element.setAttribute('data-glass-edge', 'field');
  }

  function mountRim(edge, parent, className) {
    var ns = edge.path.namespaceURI;
    var rim = document.createElementNS(ns, 'svg');
    rim.setAttribute('class', className);
    rim.setAttribute('aria-hidden', 'true');
    var mark = document.createElementNS(ns, 'use');
    mark.setAttribute('href', '#' + edge.path.id);
    rim.appendChild(mark);
    parent.appendChild(rim);
    edge.rim = rim;
  }

  function fitField(edge) {
    var fieldHost = edge.fieldHost, fieldPlate = edge.fieldPlate;
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

  function paintEdge(edge, reposition) {
    if (!edge.path) { mountEdge(edge); reposition = true; }
    if (root.dataset.glassOutline === 'true' && !edge.rim) {
      mountRim(edge, edge.element, 'glass-edge-surface-rim');
    }
    if (edge.rim) {
      var thickness = Math.min(5, 1.45 + Math.sqrt(edge.width * edge.height) / 190);
      if (edge.rimThickness !== thickness) {
        edge.rim.style.setProperty('--glass-live-rim-width', thickness.toFixed(2) + 'px');
        edge.rim.style.setProperty('--glass-live-rim-spread', (1.4 + thickness * .6).toFixed(2) + 'px');
        edge.rimThickness = thickness;
      }
    }
    var path = edgePath(edge);
    if (edge.outline !== path) {
      edge.path.setAttribute('d', path);
      edge.outline = path;
    }
    if (edge.fieldPlate && reposition) fitField(edge);
  }

  function advanceRim(edge, target, dt, easing) {
    var pull = target ? target.pull : 0;
    if (target) {
      edge.x += (target.x - edge.x) * easing; edge.y += (target.y - edge.y) * easing;
      edge.nx += (target.nx - edge.nx) * easing; edge.ny += (target.ny - edge.ny) * easing;
    }
    // Analytic damped spring keeps the same rebound across refresh rates.
    var decay = target?.pull ? 17 : 10.5;
    var frequency = 24;
    var a = edge.depth - pull, b = (edge.velocity + decay * a) / frequency;
    var cos = Math.cos(frequency * dt), sin = Math.sin(frequency * dt), damping = Math.exp(-decay * dt);
    var displacement = damping * (a * cos + b * sin);
    edge.velocity = -decay * displacement + damping * frequency * (b * cos - a * sin);
    edge.depth = pull + displacement;
    var moving = Math.abs(displacement) > .035 || Math.abs(edge.velocity) > .6 ||
      Boolean(target && Math.hypot(target.x - edge.x, target.y - edge.y) > .15);
    if (!moving && target) {
      edge.x = target.x; edge.y = target.y; edge.nx = target.nx; edge.ny = target.ny;
      edge.depth = pull; edge.velocity = 0;
    }
    return moving;
  }

  function advanceEdge(edge, target, dt, easing, reposition) {
    var previousDepth = edge.depth, previousOther = edge.other?.depth;
    if (target) {
      edge.borderX = target.borderX; edge.borderY = target.borderY;
      edge.width = target.width; edge.height = target.height; edge.radius = target.radius;
      edge.spanX = target.spanX; edge.spanY = target.spanY;
      if (target.other && !edge.other) edge.other = Object.assign({ depth:0, velocity:0 }, target.other);
    }
    var moving = advanceRim(edge, target, dt, easing);
    if (edge.other) {
      var otherMoving = advanceRim(edge.other, target?.other, dt, easing);
      if (!target?.other && !otherMoving) edge.other = null;
      moving = moving || otherMoving;
    }
    if (!moving && !target) { clearEdge(edge); return edge.press && edgeTargets.has(edge.element); }
    if (!edge.path || reposition || moving || edge.depth !== previousDepth || edge.other?.depth !== previousOther) {
      paintEdge(edge, reposition);
    }
    return moving;
  }

  function animateEdges(dt, easing) {
    var reposition = edgePending;
    var modal = document.querySelector('.modal-card.active');
    if (edgePending) { edgePending = false; updateEdgeTargets(modal); }
    var moving = false;
    edgeTargets.forEach(function (target, element) {
      if (!edges.has(element)) {
        var edge = Object.assign({ depth:0, velocity:0 }, target);
        if (target.other) edge.other = Object.assign({ depth:0, velocity:0 }, target.other);
        edges.set(element, edge);
      }
    });
    edges.forEach(function (edge, element) {
      if (!element.isConnected || element.closest(unstableCard) || (!edge.press && !attractionEnabled() && !edgeTargets.get(element)?.focus) ||
          (modal ? !modal.contains(element) : element.closest('.modal-card')) || !canBend()) {
        clearEdge(edge);
        return;
      }
      moving = advanceEdge(edge, edge.press ? null : edgeTargets.get(element), dt, easing, reposition) || moving;
    });
    return moving;
  }

  function pressCard(element, x, y) {
    if (!Number(root.style.getPropertyValue('--glass-refract-scale'))) return;
    var shape = edgeNear(element, x, y, true);
    if (!shape) return;
    var edge = edges.get(element);
    var depth = edge && Math.hypot((edge.x - shape.x) / edge.spanX, (edge.y - shape.y) / edge.spanY) < 1 ? edge.depth : 0;
    edges.set(element, Object.assign(edge || {}, shape, { depth:depth, velocity:-280, press:true }));
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
    desired.element = edgePointer && !attractionEnabled() ? null : surface(target);
    desired.level = desired.element ? (desired.element === pressed ? 1.5 : 1) : 0;
  }
  function refresh() {
    if (!enabled()) {
      if (edges.size || hover.element || pulse.element) reset();
      return;
    }
    if (!pointerPresent && !focusedInput()) return;
    hitTestPending = pointerPresent;
    edgePending = true;
    request();
  }
  function focusChanged(event) {
    if (event.target.matches(GlassOptics.inputs) && enabled()) { edgePending = true; request(); }
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
    moving = animateEdges(dt, easing) || moving;
    render();
    if (moving) request(); else previous=0;
  }
  function move(event) {
    if (!enabled()) return;
    if (event.pointerType==='touch') {
      edgePointer = edgePending = false;
      edgeTargets.clear();
      edges.forEach(clearEdge);
      edgePending = true;
      request();
      return;
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
    edgePointer = false; edgePending = Boolean(focusedInput()); edgeTargets.clear();
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
    var edge = edges.get(element);
    if (edge) clearEdge(edge);
    edgeTargets.delete(element);
    if (element.matches('.btn-fav-nav')) { request(); return; }
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
    edgePointer = edgePending = false; edgeTargets.clear(); edges.forEach(clearEdge);
    visibilityObserver?.disconnect(); topologyObserver?.disconnect();
    visibilityObserver = topologyObserver = null; topologyDirty = true;
    registered.clear(); visible.clear();
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
    contours?.ownerSVGElement.remove(); contours = null;
    document.removeEventListener('pointermove',move);document.removeEventListener('pointerout',leave);
    document.removeEventListener('pointerdown',down);document.removeEventListener('pointerup',up);
    document.removeEventListener('pointercancel',up);document.removeEventListener('click',click);
    document.removeEventListener('focusin',focusChanged);document.removeEventListener('focusout',focusChanged);
    document.removeEventListener('appearancechange',reset);document.removeEventListener('visibilitychange',reset);
    document.removeEventListener('liquidglasschange',refresh);window.removeEventListener('resize',refresh);
    window.removeEventListener('blur',reset);window.removeEventListener('scroll',refresh,true);
    motion.removeEventListener('change',reset);transparency.removeEventListener('change',reset);
  }
  document.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerout',leave,{passive:true});
  document.addEventListener('pointerdown',down,{passive:true});document.addEventListener('pointerup',up,{passive:true});
  document.addEventListener('pointercancel',up,{passive:true});document.addEventListener('click',click,{passive:true});
  document.addEventListener('focusin',focusChanged);document.addEventListener('focusout',focusChanged);
  document.addEventListener('appearancechange',reset);document.addEventListener('visibilitychange',reset);
  document.addEventListener('liquidglasschange',refresh);
  window.addEventListener('resize',refresh,{passive:true});
  window.addEventListener('blur',reset);
  window.addEventListener('scroll',refresh,{passive:true,capture:true});
  motion.addEventListener('change',reset);transparency.addEventListener('change',reset);
  window.GlassInteraction={ read:read, readEdge:function(element){return element ? edges.get(element) : (edges.values().next().value || null);},
    reset:reset, destroy:destroy, refresh:refresh,
    target:function(){return hover.element || pulse.element;},
    matches:function(element){return hover.element===element || pulse.element===element;},
    getState:function(){return {hover:hover.level,spring:pulse.level,running:!!frame};}
  };
})();
