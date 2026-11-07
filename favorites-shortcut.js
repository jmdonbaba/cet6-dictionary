/* A second entry to the existing favorites popup. Never writes favorite data. */
window.FavoritesShortcut = (() => {
  'use strict';
  let group, slot, button, source, overlay, schedule;
  let visible = false, initialized = false, returnFocus = false;
  let ghost, frame = 0, pulse, journey;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const duration = 540;
  const covered = 'data-favorites-handoff-cover';
  // Marching-squares cases, with edges numbered clockwise from the top.
  const edges = [[], [3, 0], [0, 1], [3, 1], [1, 2], null, [0, 2], [3, 2],
    [2, 3], [0, 2], null, [1, 2], [1, 3], [0, 1], [3, 0], []];

  function cancelMotion() {
    cancelAnimationFrame(frame); frame = 0;
    if (pulse) { pulse.cancel(); pulse = null; }
    journey?.receiver.removeAttribute(covered);
    if (journey?.receiver === source) button.removeAttribute(covered);
    journey = null;
    ghost?.remove(); ghost = null;
  }

  function viewport() {
    const view = window.visualViewport;
    return { top: view?.offsetTop || 0, left: view?.offsetLeft || 0,
      width: view?.width || innerWidth, height: view?.height || innerHeight };
  }

  function center(rect, view) {
    return { x: Math.max(view.left + 12, Math.min(view.left + view.width - 12, rect.left + rect.width / 2)),
      y: Math.max(view.top + 12, Math.min(view.top + view.height - 12, rect.top + rect.height / 2)) };
  }

  function compactCenter() {
    const bounds = group.getBoundingClientRect();
    return { x: matchMedia('(max-width: 1240px)').matches ? bounds.right - 48 : bounds.left + 100,
      y: bounds.top + bounds.height / 2 };
  }

  function box(x, y, width, height, radius) {
    return { x, y, width, height, radius: Math.min(radius, width / 2, height / 2),
      left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
  }

  function bounds(a, b = a) {
    const padding = 12;
    const left = Math.floor(Math.min(a.left, b.left)) - padding, top = Math.floor(Math.min(a.top, b.top)) - padding;
    return { left, top, width: Math.ceil(Math.max(a.right, b.right)) + padding - left,
      height: Math.ceil(Math.max(a.bottom, b.bottom)) + padding - top };
  }

  function distance(x, y, rect) {
    const dx = Math.abs(x - rect.x) - rect.width / 2 + rect.radius;
    const dy = Math.abs(y - rect.y) - rect.height / 2 + rect.radius;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rect.radius;
  }

  function joinedOutline(a, b, area, blend) {
    // Sample the smooth union of two rounded boxes. Its zero contour supplies
    // both the glass clip and the rim, including the concave neck between them.
    const step = Math.max(3, Math.sqrt(area.width * area.height / 9000));
    const cols = Math.ceil(area.width / step) + 1, rows = Math.ceil(area.height / step) + 1;
    const field = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const u = area.left + x * step, v = area.top + y * step;
        const da = distance(u, v, a), db = distance(u, v, b);
        const overlap = Math.max(0, 1 - Math.abs(da - db) / blend);
        field[y * cols + x] = Math.min(da, db) - blend * .25 * overlap * overlap;
      }
    }
    const points = new Map(), links = new Map();
    const offsets = [0, 1, cols, 0];
    function edgePoint(cell, edge) {
      const index = cell + offsets[edge], vertical = edge % 2;
      const key = index * 2 + vertical;
      if (!points.has(key)) {
        const f = field[index], g = field[index + (vertical ? cols : 1)];
        const ratio = f / (f - g);
        points.set(key, [(index % cols + (vertical ? 0 : ratio)) * step,
          (Math.floor(index / cols) + (vertical ? ratio : 0)) * step]);
      }
      return key;
    }
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const i = y * cols + x;
        const tl = field[i], tr = field[i + 1], br = field[i + cols + 1], bl = field[i + cols];
        const mask = (tl < 0 ? 1 : 0) | (tr < 0 ? 2 : 0) | (br < 0 ? 4 : 0) | (bl < 0 ? 8 : 0);
        const inside = tl + tr + br + bl < 0;
        const pairs = edges[mask] || ((mask === 5) === inside ? [0, 1, 2, 3] : [3, 0, 1, 2]);
        for (let k = 0; k < pairs.length; k += 2) {
          const p = edgePoint(i, pairs[k]), q = edgePoint(i, pairs[k + 1]);
          if (!links.has(p)) links.set(p, []);
          if (!links.has(q)) links.set(q, []);
          links.get(p).push(q); links.get(q).push(p);
        }
      }
    }
    const first = links.keys().next().value, contour = [];
    let current = first, previous;
    while (current !== undefined && contour.length < links.size) {
      contour.push(points.get(current));
      const next = links.get(current).find(value => value !== previous);
      previous = current; current = next;
      if (current === first) break;
    }
    if (current !== first || contour.length !== links.size || contour.length < 3) return '';
    const vertices = contour.filter(([x, y], i) => {
      const [ax, ay] = contour[(i + contour.length - 1) % contour.length];
      const [bx, by] = contour[(i + 1) % contour.length];
      return Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) > .035 * Math.hypot(bx - ax, by - ay);
    });
    if (vertices.length < 3) return '';
    const coordinate = (x, y) => `${x.toFixed(2)} ${y.toFixed(2)}`;
    const bend = (a, b) => {
      const t = Math.min(.5, 1.6 / Math.hypot(b[0] - a[0], b[1] - a[1]));
      return coordinate(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    };
    return vertices.map((point, i) => {
      const before = vertices[(i + vertices.length - 1) % vertices.length], after = vertices[(i + 1) % vertices.length];
      return `${i ? 'L' : 'M'}${bend(point, before)}Q${coordinate(...point)} ${bend(point, after)}`;
    }).join('') + 'Z';
  }

  function roundedOutline(rect, area) {
    const x = rect.left - area.left, y = rect.top - area.top, r = rect.radius;
    const right = x + rect.width, bottom = y + rect.height;
    return `M${x + r} ${y}H${right - r}Q${right} ${y} ${right} ${y + r}V${bottom - r}Q${right} ${bottom} ${right - r} ${bottom}H${x + r}Q${x} ${bottom} ${x} ${bottom - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
  }

  const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  function paint(time) {
    const motion = journey;
    const t = Math.max(0, Math.min(1, (time - motion.started) / duration));
    const to = motion.target, from = motion.from;
    const dx = to.x - from.x, dy = to.y - from.y;
    const edge = Math.min(.82, (to.width / 2 + 26) / Math.abs(dx), (to.height / 2 + 8) / Math.abs(dy));
    const p = t < .62 ? smooth(t / .62) * (1 - edge) : 1 - edge + smooth((t - .62) / .38) * edge;
    const stretch = Math.sin(Math.PI * t);
    const pill = box(from.x + dx * p, from.y + dy * p - 12 * Math.sin(Math.PI * p),
      from.width + (96 - from.width) * t + 14 * stretch, from.height + (44 - from.height) * t - 3 * stretch,
      from.radius + (to.radius - from.radius) * smooth(t));
    motion.current = pill;
    const gap = Math.hypot(Math.max(0, pill.left - to.right, to.left - pill.right),
      Math.max(0, pill.top - to.bottom, to.top - pill.bottom));
    let area = bounds(pill, to);
    // Relax the neck as the capsules overlap, so the final contour has the
    // receiver's dimensions instead of snapping from a swollen outline.
    const blend = 42 * (1 - smooth((t - .75) / .25));
    let outline = blend < .6 ? roundedOutline(to, area) : gap < 22 ? joinedOutline(pill, to, area, blend) : '';
    const attached = Boolean(outline);
    if (!attached) { area = bounds(pill); outline = roundedOutline(pill, area); }
    if (motion.receiver.hasAttribute(covered) !== attached) motion.receiver.toggleAttribute(covered, attached);
    ghost.style.transform = `translate(${area.left}px, ${area.top}px)`;
    ghost.style.width = `${area.width}px`; ghost.style.height = `${area.height}px`;
    motion.surface.style.clipPath = `path('${outline}')`;
    motion.outline.setAttribute('d', outline);
    motion.rim.classList.toggle('favorites-handoff-focused', attached && motion.receiver.matches(':focus-visible'));
    motion.traveler.style.transform = `translate(${pill.x - area.left}px, ${pill.y - area.top}px) translate(-50%, -50%)`;
    // The receiver label remains readable while the two materials connect.
    const labelGap = Math.hypot(pill.x - to.x, pill.y - to.y);
    motion.traveler.style.opacity = String(attached ? smooth((labelGap - 46) / 58) : 1);
    motion.label.style.opacity = attached ? '1' : '0';
    motion.label.style.transform = `translate(${to.x - area.left}px, ${to.y - area.top}px) translate(-50%, -50%)`;
    if (t < 1) { frame = requestAnimationFrame(paint); return; }
    const receiver = motion.receiver;
    cancelMotion();
    // A short settling highlight continues on the actual, clickable entry.
    pulse = receiver.animate?.([{ filter: 'drop-shadow(0 0 5px rgba(105, 108, 228, .26))' },
      { filter: 'drop-shadow(0 0 0 rgba(105, 108, 228, 0))' }], { duration: 220, easing: 'ease-out' });
    if (pulse) pulse.onfinish = () => { pulse = null; };
    window.GlassRenderer?.render();
  }

  function targetBox(receiver, rect, view) {
    if (receiver === button) { const pos = compactCenter(); return box(pos.x, pos.y, 96, 44, 12); }
    const pos = center(rect, view);
    return box(pos.x, rect.top + rect.height / 2, rect.width, rect.height, parseFloat(getComputedStyle(source).borderRadius) || 14);
  }

  function handoff(from, receiver, target) {
    if (reduced.matches || !CSS.supports('clip-path', "path('M0 0L1 0L0 1Z')") || Math.hypot(target.x - from.x, target.y - from.y) < 20) return;
    ghost = document.createElement('div');
    ghost.className = 'favorites-handoff';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = `<div class="favorites-handoff-surface"></div>
      <svg class="favorites-handoff-rim" focusable="false">
        <defs><linearGradient id="favorites-handoff-rim-light" x2="1" y2="1">
          <stop stop-color="white" stop-opacity=".82"/><stop offset=".53" stop-color="white" stop-opacity=".22"/>
          <stop offset="1" stop-color="white" stop-opacity=".56"/>
        </linearGradient></defs><path class="favorites-handoff-outline"/>
      </svg><span class="favorites-handoff-traveler">收藏夹</span><span class="favorites-handoff-label"></span>`;
    const label = ghost.querySelector('.favorites-handoff-label');
    label.textContent = receiver.textContent.trim();
    label.style.fontSize = getComputedStyle(receiver).fontSize;
    journey = { from, receiver, target, started: performance.now(), label,
      surface: ghost.querySelector('.favorites-handoff-surface'), rim: ghost.querySelector('.favorites-handoff-rim'),
      outline: ghost.querySelector('.favorites-handoff-outline'), traveler: ghost.querySelector('.favorites-handoff-traveler') };
    document.body.append(ghost);
    if (receiver === source) button.setAttribute(covered, '');
    paint(journey.started);
    window.GlassRenderer?.animateFor(duration + 30);
  }

  function update() {
    if (!group) return;
    const modalOpen = overlay.style.display !== 'none';
    group.hidden = modalOpen;
    button.setAttribute('aria-expanded', String(modalOpen && document.getElementById('modalVocabFav').classList.contains('active')));
    if (modalOpen) { cancelMotion(); initialized = false; return; }
    const view = viewport(), rect = source.getBoundingClientRect();
    const height = Math.max(0, Math.min(rect.bottom, view.top + view.height) - Math.max(rect.top, view.top));
    const width = Math.max(0, Math.min(rect.right, view.left + view.width) - Math.max(rect.left, view.left));
    const ratio = rect.width && rect.height ? height * width / (rect.width * rect.height) : 0;
    // Separate entry/exit thresholds keep a partially clipped footer from flickering.
    const next = !initialized ? ratio < .65 : ratio >= .65 ? false : ratio <= .15 ? true : visible;
    if (next !== visible || !initialized) {
      const previous = journey?.current;
      cancelMotion();
      const oldCenter = center(button.getBoundingClientRect(), view);
      const heldFocus = document.activeElement === button;
      group.dataset.favoritesVisible = String(next);
      slot.inert = !next;
      slot.setAttribute('aria-hidden', String(!next));
      button.tabIndex = next ? 0 : -1;
      button.disabled = !next;
      if (!next && heldFocus) source.focus({ preventScroll: true });
      if (initialized && !reduced.matches) {
        const origin = next ? center(rect, view) : oldCenter;
        const receiver = next ? button : source;
        handoff(previous || box(origin.x, origin.y, 96, 44, 12), receiver, targetBox(receiver, rect, view));
      }
      visible = next;
      if (!reduced.matches) window.GlassRenderer?.animateFor(440);
    }
    // The page can keep scrolling during the handoff. Keep its endpoint attached
    // to the real entry instead of finishing at an obsolete screen position.
    if (journey) journey.target = targetBox(journey.receiver, rect, view);
    initialized = true;
    if (returnFocus) {
      returnFocus = false;
      (visible ? button : source).focus({ preventScroll: true });
    }
  }

  function init(scheduleUpdate) {
    if (group) return;
    group = document.getElementById('favoritesShortcuts');
    slot = document.getElementById('favoritesShortcutSlot');
    button = document.getElementById('btnOpenFavoritesShortcut');
    source = document.getElementById('btnOpenVocabFav');
    overlay = document.getElementById('modalOverlay');
    schedule = scheduleUpdate;
    if (!group || !slot || !button || !source || !overlay) { group = null; return; }
    button.addEventListener('click', () => {
      if (!visible || slot.inert) return;
      returnFocus = document.activeElement === button;
      cancelMotion();
      source.click();
      update();
      if (returnFocus) document.querySelector('#modalVocabFav .modal-close')?.focus({ preventScroll: true });
    });
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(schedule);
      observer.observe(document.querySelector('.container'));
      observer.observe(source);
    }
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    reduced.addEventListener('change', () => { cancelMotion(); schedule(); });
    document.addEventListener('appearancechange', cancelMotion);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelMotion(); else schedule(); });
    update();
  }
  return { init, update };
})();
