/* Shared smooth curvature policy for the GPU shader and native displacement maps. */
(function (root) {
  'use strict';
  function profile(value) {
    var u=Math.max(0,Math.min(1,value));
    var v=1-u*u*u*(u*(u*6-15)+10);
    return v*v;
  }
  function inputProfile(value) { var v=1-Math.max(0,Math.min(1,value));return v*v*v; }
  function offset(position,halfSize,band,input) { return Math.sign(position)*(input?inputProfile:profile)((halfSize-Math.abs(position))/band); }
  function extent(shortSide,band) { return Math.max(.5,Math.min(band*5.25,shortSide*.49)); }
  function amplitude(band,shortSide,button,strength,input) {
    var gain=Math.max(1,Math.min(2.6,72/shortSide));
    var ratio=input ? .30 : button ? Math.min(.4,.32+.05*(gain-1)) : .36;
    // The cubic input profile peaks at slope 3 on the outer rim; .30 leaves
    // room for dispersion while keeping sampling ordered through the whole lens.
    return Math.min(Math.min(80,band*ratio)*strength,band*(input ? .30 : .4));
  }
  var focusStates=new WeakMap(), focusDuration=240;
  function focusLevel(element,now) {
    var state=focusStates.get(element);
    if(!state)return element.ownerDocument?.activeElement===element?1:0;
    var t=state.duration?Math.max(0,Math.min(1,(now-state.start)/state.duration)):1;
    return state.from+(state.to-state.from)*t*t*(3-2*t);
  }
  function setFocus(element,focused,now,immediate) {
    var target=focused?1:0,state=focusStates.get(element);
    if(state&&state.to===target)return;
    focusStates.set(element,{from:state?focusLevel(element,now):1-target,to:target,start:now,duration:immediate?0:focusDuration});
  }
  function inputStrength(element,now) { return .32+1.12*focusLevel(element,now); }
  var inputs = '.word-search-input, .input-area input, .study-tool-form :is(input, textarea), .fav-search input, .key-area input, .comparison-search';
  var optics={profile:profile,inputProfile:inputProfile,offset:offset,extent:extent,amplitude:amplitude,
    setFocus:setFocus,focusLevel:focusLevel,inputStrength:inputStrength,focusDuration:focusDuration,
    // A complete result is one plate above the outer card. Its forms, examples
    // and memory sections share that field instead of bending it independently.
    layers:'.word-result, .word-search-wrapper:not(.mnemonic-card) > .word-search-result:has(> .study-content), .vf-detail, .comparison-fav',
    modalLayers:'.appearance-option, .theme-option, .vf-compact, .page-record-item, .comparison-fav',
    controls:'.ws-mode-slider, '+inputs,
    inputs:inputs,
    glsl:'float edgeProfile(float u){u=clamp(u,0.,1.);float v=1.-u*u*u*(u*(u*6.-15.)+10.);return v*v; } float inputProfile(float u){float v=1.-clamp(u,0.,1.);return v*v*v; } vec2 edgeOffset(vec2 p,vec2 h,float b){return sign(p)*vec2(edgeProfile((h.x-abs(p.x))/b),edgeProfile((h.y-abs(p.y))/b));} vec2 inputOffset(vec2 p,vec2 h,float b){return sign(p)*vec2(inputProfile((h.x-abs(p.x))/b),inputProfile((h.y-abs(p.y))/b));}'
  };
  if(typeof module==='object'&&module.exports)module.exports=optics;
  else root.GlassOptics=optics;
})(typeof window==='undefined'?globalThis:window);
