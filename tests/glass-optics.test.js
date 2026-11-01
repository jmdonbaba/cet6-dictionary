const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../glass-optics.js');

test('rim curvature rises sharply while the interior settles continuously', () => {
  const optics=require(file);
  assert.ok(optics.profile(.1)>.97,'the outer rim retains a strong bend');
  assert.ok(optics.profile(.5)<.3,'the same plate quickly flattens toward the interior');
  assert.ok(optics.profile(.8)<.005,'the central region has no secondary lens band');
});

test('graded refraction has smooth endpoints and never folds wallpaper sampling', () => {
  assert.ok(fs.existsSync(file), 'a shared graded optics model must replace the narrow edge band');
  const optics = require(file);
  const eps = .0001;
  assert.equal(optics.profile(0), 1);
  assert.equal(optics.profile(1), 0);
  assert.ok(Math.abs((optics.profile(eps)-optics.profile(0))/eps)<.001);
  assert.ok(Math.abs((optics.profile(1)-optics.profile(1-eps))/eps)<.001);
  for (const side of [24, 32, 44, 132, 320, 700]) for (const button of [false,true]) for (const strength of [.5,1,2]) {
    const band = optics.extent(side, 36);
    const amplitude = optics.amplitude(band,side,button,strength);
    let previous = -Infinity;
    for(let i=0;i<=1000;i++) {
      const x=band*i/1000;
      const sample=x+amplitude*optics.profile(x/band);
      assert.ok(sample>previous, `${side}px surface must not produce an interior fold line`);
      previous=sample;
    }
  }
});

test('rounded-corner sampling preserves two-dimensional orientation', () => {
  const optics = require(file);
  for (const [width,height,radius] of [[800,320,22],[160,44,22],[28,28,14]]) {
    const band=optics.extent(Math.min(width,height),36);
    const amplitude=optics.amplitude(band,Math.min(width,height),height<50,2);
    const sample=(x,y)=>[x-amplitude*optics.offset(x,width/2,band),y-amplitude*optics.offset(y,height/2,band)];
    for(let a=0;a<=Math.PI/2;a+=.03)for(let depth=0;depth<radius;depth+=.7){
      const x=width/2-radius+(radius-depth)*Math.cos(a),y=height/2-radius+(radius-depth)*Math.sin(a);
      const base=sample(x,y),dx=sample(x+.001,y),dy=sample(x,y+.001);
      const determinant=((dx[0]-base[0])*(dy[1]-base[1])-(dx[1]-base[1])*(dy[0]-base[0]))/1e-6;
      assert.ok(determinant>0,'corner texture must not reverse orientation');
    }
  }
});
