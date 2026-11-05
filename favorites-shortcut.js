/* A second entry to the existing favorites popup. Never writes favorite data. */
window.FavoritesShortcut = (() => {
  'use strict';
  let group, slot, button, source, overlay, schedule;
  let visible = false, initialized = false, returnFocus = false;
  let ghost, flight, pulse, journey;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function cancelMotion() {
    if (flight) { flight.onfinish = null; flight.cancel(); flight = null; }
    if (pulse) { pulse.cancel(); pulse = null; }
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

  function flightFrames(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    return [
      { transform: 'translate(0, 0) scale(1)', opacity: .8 },
      { transform: `translate(${dx * .55}px, ${dy * .55 - 18}px) scale(.96)`, opacity: .8, offset: .55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.9)`, opacity: 0 }
    ];
  }

  function handoff(from, to, arrivingAtSource) {
    if (reduced.matches || typeof source.animate !== 'function' || Math.hypot(to.x - from.x, to.y - from.y) < 20) return;
    ghost = document.createElement('div');
    ghost.className = 'favorites-handoff';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.textContent = '收藏夹';
    ghost.style.left = `${from.x - 48}px`; ghost.style.top = `${from.y - 22}px`;
    document.body.append(ghost);
    journey = { from, arrivingAtSource };
    flight = ghost.animate(flightFrames(from, to), { duration: 420, easing: 'cubic-bezier(.22, .7, .25, 1)' });
    flight.onfinish = () => {
      flight = null; journey = null; ghost?.remove(); ghost = null;
      if (arrivingAtSource && !visible && overlay.style.display === 'none') {
        pulse = source.animate([
          { filter: 'drop-shadow(0 0 0 rgba(79, 70, 229, 0))' },
          { filter: 'drop-shadow(0 0 7px rgba(79, 70, 229, .24))', offset: .35 },
          { filter: 'drop-shadow(0 0 0 rgba(79, 70, 229, 0))' }
        ], { duration: 320, easing: 'ease-out' });
        pulse.onfinish = () => { pulse = null; };
      }
    };
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
      cancelMotion();
      const oldCenter = center(button.getBoundingClientRect(), view);
      const destination = compactCenter();
      const heldFocus = document.activeElement === button;
      group.dataset.favoritesVisible = String(next);
      slot.inert = !next;
      slot.setAttribute('aria-hidden', String(!next));
      button.tabIndex = next ? 0 : -1;
      button.disabled = !next;
      if (!next && heldFocus) source.focus({ preventScroll: true });
      if (initialized && !reduced.matches) {
        handoff(next ? center(rect, view) : oldCenter, next ? destination : center(rect, view), !next);
      }
      visible = next;
      if (!reduced.matches) window.GlassRenderer?.animateFor(440);
    }
    // The page can keep scrolling during the handoff. Keep its endpoint attached
    // to the real entry instead of finishing at an obsolete screen position.
    if (flight && journey) flight.effect.setKeyframes(flightFrames(journey.from,
      journey.arrivingAtSource ? center(rect, view) : compactCenter()));
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
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelMotion(); else schedule(); });
    update();
  }
  return { init, update };
})();
