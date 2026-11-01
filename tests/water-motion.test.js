const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'appearance.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'glass-renderer.js'), 'utf8');

test('glass water flows in the shader at display refresh and freezes for reduced motion', () => {
  assert.match(renderer, /uniform float uTime;/);
  assert.match(renderer, /uniform float waterMotion;/);
  assert.match(renderer, /vec3 waterAt\(vec2 uv\)\{/);
  assert.match(renderer, /if\(waterMotion>\.5\)return waterAt\(uv\)/);
  assert.match(renderer, /waterAnimating = theme === 'water' && motionAllowed\(\);/);
  assert.match(renderer, /if \(waterAnimating\) requestRender\(\);/);
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

test('only the water wallpaper opts into perpetual GPU frames', () => {
  const drawBody = renderer.slice(renderer.indexOf('function draw(now)'), renderer.indexOf('function copyComposite()'));
  assert.doesNotMatch(drawBody, /requestAnimationFrame\(draw\)/,
    'draw must not self-schedule an unconditional frame loop');
  assert.match(renderer, /if \(waterAnimating\) requestRender\(\);/);
  assert.match(renderer, /function requestRender\(\) \{ if \(active && !frame\) frame = requestAnimationFrame\(draw\); \}/);
});
