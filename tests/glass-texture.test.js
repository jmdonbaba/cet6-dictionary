const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('lazy local water texture exactly matches the original wallpaper', () => {
  const script = fs.readFileSync(path.join(root, 'assets/water-caustics-data.js'), 'utf8');
  const encoded = script.match(/data:image\/webp;base64,([A-Za-z0-9+/=]+)/)[1];
  assert.deepEqual(Buffer.from(encoded, 'base64'), fs.readFileSync(path.join(root, 'assets/water-caustics.webp')));
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /src="assets\/water-caustics-data.js"/,
    'local-only texture must not add a blocking request to normal page loads');
});
