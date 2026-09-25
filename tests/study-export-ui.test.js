const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('loads pinned study-export dependencies from local files', () => {
  assert.match(source, /src="vendor\/html2canvas-1\.4\.1\.min\.js"/);
  assert.match(source, /src="vendor\/jspdf-4\.2\.1\.umd\.min\.js"/);
  assert.match(source, /src="vendor\/docx-9\.7\.1\.iife\.js"/);
  assert.match(source, /src="study-export\.js"/);
  assert.doesNotMatch(source, /(?:unpkg|jsdelivr|cdnjs)/i);
});
