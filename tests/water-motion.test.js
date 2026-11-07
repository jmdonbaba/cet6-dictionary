const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'appearance.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'glass-renderer.js'), 'utf8');
const wallpaper = fs.readFileSync(path.join(root, 'glass-wallpaper.js'), 'utf8');

test('glass water flows in the shader at display refresh and freezes for reduced motion', () => {
  assert.match(renderer, /uniform float uTime;/);
  assert.match(renderer, /uniform float waterMotion;/);
  assert.match(renderer, /vec3 waterAt\(vec2 uv\)\{/);
  assert.match(renderer, /if\(waterMotion>\.5\)return waterAt\(uv\)/);
  assert.match(renderer, /waterAnimating = theme === 'water' && !!water && canAnimate;/);
  assert.match(renderer, /if \(waterAnimating \|\| performance\.now\(\) < motionUntil\) requestRender\(\);/);
  assert.match(renderer, /prefers-reduced-motion: reduce/);
  assert.match(renderer, /waterMotion: waterAnimating/);
});

test('classic water adds a compositor-only flow layer that respects reduced motion', () => {
  assert.match(css, /@keyframes water-flow \{/);
  const flow = css.match(/html\[data-interface="classic"\]\[data-wallpaper="water"\] \.appearance-water::after \{[\s\S]*?\}/);
  assert.ok(flow, 'classic + water flow layer must exist');
  assert.match(flow[0], /url\("assets\/water-caustics\.webp(?:\?v=[a-f0-9]+)?"\)/);
  assert.match(flow[0], /mix-blend-mode: soft-light;/);
  assert.match(flow[0], /animation: water-flow 14s ease-in-out infinite alternate;/);
  assert.match(flow[0], /will-change: transform;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.appearance-water::after \{\s*animation: none !important;\s*transform: none !important;/);
});

test('ambient themes share the lens sampling path and opt into a slower idle cadence', () => {
  const drawBody = renderer.slice(renderer.indexOf('function draw(now)'), renderer.indexOf('function copyComposite()'));
  assert.doesNotMatch(drawBody, /requestAnimationFrame\(draw\)/,
    'draw must not self-schedule an unconditional frame loop');
  assert.match(renderer, /else if \(ambientAnimating\) ambientTimer = setTimeout\(requestRender, 32\);/);
  assert.match(renderer, /updateAmbient\(now, canAnimate && GlassWallpaper\.motionFor\(theme\)\)/);
  assert.match(renderer, /vec3 sampleAt[\s\S]*?if\(ambientMotion\.w>0\.\)[\s\S]*?vec2 drift=ambientMotion\.xy/);
  assert.match(renderer, /if \(!active \|\| frame \|\| document\.hidden\) return;/);
  const themes = wallpaper.match(/var ambientThemes = \{([\s\S]*?)\n  \};/)[1];
  assert.deepEqual(Array.from(themes.matchAll(/^    (\w+):/gm), match => match[1]),
    ['aurora', 'peach', 'night', 'minimal']);
});
