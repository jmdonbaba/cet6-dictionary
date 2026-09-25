const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('uses the shared shadow language for cards and the export button', () => {
  assert.match(source, /--shadow-hover:\s*0 6px 20px rgba\(15, 23, 42, 0\.08\),\s*0 2px 6px rgba\(15, 23, 42, 0\.05\);/);
  assert.match(source, /@media \(hover: hover\) \{[\s\S]*?\.card:hover\s*\{[^}]*box-shadow:\s*var\(--shadow-hover\);[^}]*\}/);
  assert.match(source, /\.btn-study-export:hover\s*\{[^}]*box-shadow:\s*var\(--shadow\);[^}]*\}/);
});

test('adds restrained spring entrances and button press feedback', () => {
  assert.match(source, /@keyframes surface-spring-in[\s\S]*?translateY\(6px\) scale\(\.98\)[\s\S]*?translateY\(-1px\) scale\(1\.006\)/);
  assert.match(source, /\.modal-card\.active\s*\{[^}]*animation:\s*surface-spring-in 260ms/);
  assert.match(source, /\.study-export-menu:not\(\[hidden\]\)\s*\{[^}]*animation:\s*surface-spring-in 180ms/);
  assert.match(source, /\.word-result\s*>\s*\*\s*\{[^}]*animation:\s*content-reveal 220ms/);
  assert.match(source, /button:not\(:disabled\):active\s*\{[^}]*transform:\s*scale\(\.98\)/);
});

test('animates toast movement and honors reduced motion', () => {
  assert.match(source, /\.toast\s*\{[^}]*transform:\s*translateY\(8px\)/s);
  assert.match(source, /\.toast\.show\s*\{[^}]*transform:\s*translateY\(0\)/s);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation:\s*none\s*!important;[\s\S]*?transform:\s*none\s*!important;/);
});
