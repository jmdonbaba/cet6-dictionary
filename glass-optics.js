/* Shared smooth curvature policy for the GPU shader and native displacement maps. */
(function (root) {
  'use strict';
  function profile(value) {
    var u=Math.max(0,Math.min(1,value));
    var v=1-u*u*u*(u*(u*6-15)+10);
    return v*v;
  }
  function offset(position,halfSize,band) { return Math.sign(position)*profile((halfSize-Math.abs(position))/band); }
  function extent(shortSide,band) { return Math.max(.5,Math.min(band*5.25,shortSide*.49)); }
  function amplitude(band,shortSide,button,strength) {
    var gain=Math.max(1,Math.min(2.6,72/shortSide));
    var ratio=button ? Math.min(.4,.32+.05*(gain-1)) : .36;
    // Squared curvature peaks at slope 2.39; this bound keeps sampling ordered.
    return Math.min(Math.min(80,band*ratio)*strength,band*.4);
  }
  var optics={profile:profile,offset:offset,extent:extent,amplitude:amplitude,
    // A complete result is one plate above the outer card. Its forms, examples
    // and memory sections share that field instead of bending it independently.
    layers:'.word-result, .word-search-result:has(> .study-content), .vf-detail, .comparison-fav',
    controls:'.ws-mode-slider, .input-area input, .study-tool-form input, .fav-search input, .key-area input, .comparison-search',
    glsl:'float edgeProfile(float u){u=clamp(u,0.,1.);float v=1.-u*u*u*(u*(u*6.-15.)+10.);return v*v; } vec2 edgeOffset(vec2 p,vec2 h,float b){return sign(p)*vec2(edgeProfile((h.x-abs(p.x))/b),edgeProfile((h.y-abs(p.y))/b));}'
  };
  if(typeof module==='object'&&module.exports)module.exports=optics;
  else root.GlassOptics=optics;
})(typeof window==='undefined'?globalThis:window);
