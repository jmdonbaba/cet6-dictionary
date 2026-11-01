/* Shared smooth curvature policy for the GPU shader and native displacement maps. */
(function (root) {
  'use strict';
  function profile(value) {
    var u=Math.max(0,Math.min(1,value));
    return 1-u*u*u*(u*(u*6-15)+10);
  }
  function offset(position,halfSize,band) { return Math.sign(position)*profile((halfSize-Math.abs(position))/band); }
  function extent(shortSide,band) { return Math.max(.5,Math.min(band*3.9375,shortSide*.49)); }
  function amplitude(band,shortSide,button,strength) {
    var gain=Math.max(1,Math.min(2.6,72/shortSide));
    var ratio=button ? Math.min(.48,.32+.1*(gain-1)) : .44;
    return Math.min(Math.min(60,band*ratio)*strength,band*.5);
  }
  var optics={profile:profile,offset:offset,extent:extent,amplitude:amplitude,
    glsl:'float edgeProfile(float u){u=clamp(u,0.,1.);return 1.-u*u*u*(u*(u*6.-15.)+10.); } vec2 edgeOffset(vec2 p,vec2 h,float b){return sign(p)*vec2(edgeProfile((h.x-abs(p.x))/b),edgeProfile((h.y-abs(p.y))/b));}'
  };
  if(typeof module==='object'&&module.exports)module.exports=optics;
  else root.GlassOptics=optics;
})(typeof window==='undefined'?globalThis:window);
