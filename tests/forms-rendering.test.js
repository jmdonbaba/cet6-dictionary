const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('keeps mobile search controls at their natural widths and right-aligns them', () => {
  assert.match(source, /@media\s*\(max-width:\s*500px\)/);
  assert.match(source, /\.word-search-wrapper\s+\.input-area\s*\{[^}]*flex-wrap:\s*wrap;/);
  assert.match(source, /\.word-search-wrapper\s+\.input-area\s*\{\s*justify-content:\s*flex-end;/);
  assert.match(source, /\.word-search-wrapper\s+\.input-area\s*>\s*div:first-child\s*\{\s*flex-basis:\s*100%\s*!important;/);
  assert.doesNotMatch(source, /\.word-search-wrapper\s+\.ws-mode-toggle\s*\{\s*flex:\s*1;/);
  assert.doesNotMatch(source, /\.word-search-wrapper\s+\.word-search-submit\s*\{\s*flex:\s*1;/);
});

test('keeps touch gestures on a favorite drag handle out of browser scrolling', () => {
  assert.match(source, /\.vf-drag-handle\s*\{[^}]*touch-action:\s*none;/);
  assert.match(source, /\$favListContainer\.addEventListener\('pointercancel',\s*function\s*\(e\)\s*\{\s*if\s*\(dragActive\)\s*clearDragState\(\);/);
});

test('batches favorite drag updates by frame and keeps edge scrolling continuous', () => {
  assert.match(source, /requestAnimationFrame\(updateDragFrame\)/);
  assert.match(source, /document\.elementFromPoint\(clientX, clientY\)/);
  assert.doesNotMatch(source, /dragScrollTimer/);
  assert.doesNotMatch(source, /\$favListContainer\.addEventListener\('pointerleave'/);
});

test('uses non-layout drag indicators and avoids focusing favorite search on mobile', () => {
  assert.match(source, /\.vf-compact\.drag-over\s*\{\s*box-shadow:\s*inset 0 -2px 0 var\(--primary\);/);
  assert.match(source, /\.vf-compact\.drag-over-top\s*\{\s*box-shadow:\s*inset 0 2px 0 var\(--primary\);/);
  assert.doesNotMatch(source, /\.vf-compact\.drag-over\s*\{\s*border-bottom:/);
  assert.match(source, /modal === \$modalVocabFav && !skipFocus && !window\.matchMedia\('\(max-width: 500px\)'\)\.matches/);
});

test('maps both sides of an insertion gap to the same indicator edge', () => {
  const match = source.match(/function resolveDragIndicator\(target, insertBefore\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'resolveDragIndicator helper must exist');
  const resolveDragIndicator = new Function(`${match[0]}; return resolveDragIndicator;`)();
  const next = { classList: { contains: () => true } };
  const target = { nextElementSibling: next };

  assert.deepEqual(resolveDragIndicator(target, true), { compact: target, className: 'drag-over-top' });
  assert.deepEqual(resolveDragIndicator(target, false), { compact: next, className: 'drag-over-top' });
  assert.deepEqual(resolveDragIndicator({ nextElementSibling: null }, false), { compact: { nextElementSibling: null }, className: 'drag-over' });
});

test('anchors the mobile drag ghost at the pointer left edge', () => {
  const match = source.match(/function getDragGhostTransform\(clientX, clientY\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'getDragGhostTransform helper must exist');
  const getDragGhostTransform = new Function('window', `${match[0]}; return getDragGhostTransform;`)({
    matchMedia: query => ({ matches: query === '(max-width: 500px)' })
  });

  assert.equal(getDragGhostTransform(12, 40), 'translate3d(12px, 40px, 0) translate(0, -50%)');
});

test('places a dragged favorite after the card marked by the bottom indicator', () => {
  const match = source.match(/function moveFavoriteAfter\(items, sourceIndex, targetIndex\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'moveFavoriteAfter helper must exist');
  const moveFavoriteAfter = new Function(`${match[0]}; return moveFavoriteAfter;`)();

  assert.deepEqual(moveFavoriteAfter(['a', 'b', 'c', 'd'], 3, 1), ['a', 'b', 'd', 'c']);
  assert.deepEqual(moveFavoriteAfter(['a', 'b', 'c', 'd'], 1, 3), ['a', 'c', 'd', 'b']);
});

test('supports inserting before a target card from its top-half indicator', () => {
  const match = source.match(/function moveFavoriteBefore\(items, sourceIndex, targetIndex\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'moveFavoriteBefore helper must exist');
  const moveFavoriteBefore = new Function(`${match[0]}; return moveFavoriteBefore;`)();

  assert.deepEqual(moveFavoriteBefore(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveFavoriteBefore(['a', 'b', 'c', 'd'], 1, 3), ['a', 'c', 'b', 'd']);
  assert.match(source, /dragGhost\.style\.transform = getDragGhostTransform\(clientX, clientY\);/);
});

test('hides the dragged card indicator and moves its handle to the mobile leading edge', () => {
  assert.match(source, /if \(target\) \{\s*var targetIdx = parseInt\(target\.dataset\.vfidx, 10\);\s*if \(targetIdx !== dragSrcIdx\)[\s\S]*?else \{\s*setDragIndicator\(null, ''\);/);
  assert.match(source, /@media \(max-width: 500px\) \{[\s\S]*?\.vf-drag-handle\s*\{\s*position:\s*absolute;/);
});

test('suppresses no-op insertion lines and keeps mobile word text in place', () => {
  const match = source.match(/function isNoOpFavoriteDrop\(sourceIndex, targetIndex, insertBefore\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'isNoOpFavoriteDrop helper must exist');
  const isNoOpFavoriteDrop = new Function(`${match[0]}; return isNoOpFavoriteDrop;`)();

  assert.equal(isNoOpFavoriteDrop(2, 2, true), true);
  assert.equal(isNoOpFavoriteDrop(1, 2, true), true);
  assert.equal(isNoOpFavoriteDrop(2, 1, false), true);
  assert.equal(isNoOpFavoriteDrop(1, 3, true), false);
});

test('defers favorite drag visuals until the first movement frame', () => {
  const pointerDown = source.match(/\$favListContainer\.addEventListener\('pointerdown', function \(e\) \{[\s\S]*?\n\}\);/);
  assert.ok(pointerDown, 'favorite pointerdown handler must exist');
  assert.doesNotMatch(pointerDown[0], /classList\.add\('dragging'\)/);
  assert.doesNotMatch(pointerDown[0], /document\.createElement\('div'\)/);
  assert.doesNotMatch(pointerDown[0], /scheduleDragFrame\(\)/);
  assert.match(source, /function ensureDragVisuals\(\) \{/);
  assert.match(source, /function updateDragFrame\(\) \{[\s\S]*?ensureDragVisuals\(\);/);
});

test('keeps the mobile drag handle clear after a canceled gesture', () => {
  assert.match(source, /@media \(hover: hover\) \{\s*\.vf-drag-handle:hover \{ background: var\(--border\); \}/);
  assert.match(source, /\$favListContainer\.addEventListener\('lostpointercapture', function \(e\) \{\s*if \(dragActive\) clearDragState\(\);/);
});
const match = source.match(/function renderForms\(forms\) \{[\s\S]*?\n\}/);
assert.ok(match, 'renderForms helper must exist');
const renderForms = new Function('esc', `${match[0]}; return renderForms;`)(value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;'));

test('renders structured inflections and derivatives in separate groups', () => {
  const html = renderForms({
    inflections: [
      { type: '过去式', word: 'aspired' },
      { type: '现在分词', word: 'aspiring' }
    ],
    derivatives: [
      { pos: 'n.', word: 'aspiration', meaning: '抱负；渴望' }
    ]
  });

  assert.match(html, /词形变化：过去式 aspired；现在分词 aspiring/);
  assert.match(html, /同根派生：n\. aspiration 抱负；渴望/);
});

test('keeps legacy string forms readable', () => {
  assert.equal(renderForms('复数 analyses'), '复数 analyses');
});
