const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('refreshes the favorites cache immediately when favorites are saved', () => {
  assert.match(source, /let _favoritesSearchCache = null;/);
  assert.match(source, /if \(!_favoritesSearchCache\) _favoritesSearchCache = getVFavs\(\);/);
  assert.match(source, /_favoritesSearchCache = vs;/);
  const setFavorites = source.match(/function setVFavs\(vs\) \{[\s\S]*?\n\}/);
  assert.ok(setFavorites, 'setVFavs helper must exist');
  assert.doesNotMatch(setFavorites[0], /_favoritesSearchCache = null;/);
});

test('keeps focus in the favorites search after Escape', () => {
  assert.match(source, /if \(e\.key === 'Escape'\) \{[\s\S]*?hideSearchDropdown\(\);/);
  assert.doesNotMatch(source, /hideSearchDropdown\(\);\s*this\.blur\(\);/);
});
