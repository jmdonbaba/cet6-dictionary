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
    desired.element = surface(target);
    desired.level = desired.element ? (desired.element === pressed ? 1.5 : 1) : 0;
  }
  function refresh() {
    if (!pointerPresent || !enabled()) return;
    hitTestPending = true;
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
    render();
    if (moving) request(); else previous=0;
  }
  function move(event) {
    if (!enabled() || event.pointerType==='touch') return;
    pointerPresent = true;
    hitTestPending = false;
    desired.x = event.clientX;
    desired.y = event.clientY;
    setTarget(event.target);
    request();
  }
  function leave(event) {
    if (event.relatedTarget) return;
    pointerPresent = hitTestPending = false;
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
    hover.element=desired.element=pulse.element=null;hover.level=desired.level=pulse.level=0;
    decorations.forEach(function (_,element){removeDecoration(element);});render();
  }
  function down(event) { if(enabled()){pressed=surface(event.target);move(event);} }
  function up() { pressed=null;desired.level=desired.element ? 1 : 0;if(enabled())request(); }
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
    document.removeEventListener('pointermove',move);document.removeEventListener('pointerout',leave);
    document.removeEventListener('pointerdown',down);document.removeEventListener('pointerup',up);
    document.removeEventListener('pointercancel',up);document.removeEventListener('click',click);
    document.removeEventListener('appearancechange',reset);document.removeEventListener('visibilitychange',reset);
    window.removeEventListener('blur',reset);window.removeEventListener('scroll',refresh,true);
    motion.removeEventListener('change',reset);transparency.removeEventListener('change',reset);
  }
  document.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerout',leave,{passive:true});
  document.addEventListener('pointerdown',down,{passive:true});document.addEventListener('pointerup',up,{passive:true});
  document.addEventListener('pointercancel',up,{passive:true});document.addEventListener('click',click,{passive:true});
  document.addEventListener('appearancechange',reset);document.addEventListener('visibilitychange',reset);
  window.addEventListener('blur',reset);
  window.addEventListener('scroll',refresh,{passive:true,capture:true});
  motion.addEventListener('change',reset);transparency.addEventListener('change',reset);
  window.GlassInteraction={ read:read, reset:reset, destroy:destroy, refresh:refresh,
    target:function(){return hover.element || pulse.element;},
    matches:function(element){return hover.element===element || pulse.element===element;},
    getState:function(){return {hover:hover.level,spring:pulse.level,running:!!frame};}
  };
})();
