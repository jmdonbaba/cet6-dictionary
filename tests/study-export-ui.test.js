const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const StudyExport = require('../study-export.js');

const source = fs.readFileSync('index.html', 'utf8');

test('loads the local study-export formatter without PDF dependencies', () => {
  const moduleSource = fs.readFileSync('study-export.js', 'utf8');
  assert.match(source, /src="study-export\.js"/);
  assert.doesNotMatch(source, /(?:unpkg|jsdelivr|cdnjs)/i);
  assert.doesNotMatch(source, /html2canvas|jspdf/i);
  assert.doesNotMatch(moduleSource, /createPdfBlob|buildPdfPages|renderPdfFragment/);
  assert.equal(fs.existsSync('vendor/html2canvas-1.4.1.min.js'), false);
  assert.equal(fs.existsSync('vendor/jspdf-4.2.1.umd.min.js'), false);
});

test('does not load or advertise the cancelled Word export', () => {
  assert.doesNotMatch(source, /docx-9\.7\.1|data-study-format="word"|>Word</i);
  assert.equal(fs.existsSync('vendor/docx-9.7.1.iife.js'), false);
});

test('favorites modal offers exactly HTML and Markdown with a font-independent chevron', () => {
  assert.match(source, /id="btnStudyExport"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*>导出<span class="study-export-chevron" aria-hidden="true"><\/span><\/button>/);
  assert.match(source, /\.study-export-chevron\s*\{[^}]*border-right:[^;}]+;[^}]*border-bottom:[^;}]+;[^}]*transform:\s*rotate\(45deg\)/s);
  assert.match(source, /id="studyExportMenu"[^>]*role="menu"[^>]*hidden/);
  const items = [...source.matchAll(/data-study-format="([^"]+)"[^>]*>([^<]+)<\/button>/g)];
  assert.deepEqual(items.map(([, format, label]) => [format, label]), [
    ['html', 'HTML'], ['markdown', 'Markdown']
  ]);
  assert.doesNotMatch(source, />导出全部/);
});

test('adds a subtle export-button shadow only on hover-capable devices', () => {
  assert.match(source, /@media \(hover: hover\) \{[\s\S]*?\.btn-study-export:hover\s*\{[^}]*box-shadow:\s*0 3px 10px rgba\(15, 23, 42, \.14\);[^}]*\}/);
  const hoverRule = source.match(/\.btn-study-export:hover\s*\{([^}]*)\}/);
  assert.ok(hoverRule);
  assert.doesNotMatch(hoverRule[1], /transform|background|color|padding|width|height/);
});

test('study export snapshots all favorites, independent of search, without API keys', () => {
  assert.match(source, /StudyExport\.normalizeFavorites\(getVFavs\(\)\)/);
  const workflow = source.match(/function exportStudyDocument\(format\) \{[\s\S]*?\n\}/);
  assert.ok(workflow, 'study export workflow exists');
  assert.doesNotMatch(workflow[0], /getApiKey|favSearch|searchTerm/);
  assert.match(workflow[0], /StudyExport\.downloadBlob\(blob, StudyExport\.createFilename\(extension\), document\)/);
});

test('empty favorites disable study export without a long-running generation state', () => {
  assert.match(source, /\$btnStudyExport\.disabled\s*=\s*!favs\.length/);
  assert.doesNotMatch(source, /studyExportBusy|正在生成|aria-busy/);
  assert.doesNotMatch(source, /createPdfBlob|data-study-format="pdf"/);
});

test('study export menu closes on outside click and Escape, returning focus to its trigger', () => {
  assert.match(source, /function closeStudyExportMenu\([^)]*\)/);
  assert.match(source, /\$btnStudyExport\.focus\(\)/);
  assert.match(source, /e\.key === 'Escape'[\s\S]*?closeStudyExportMenu\(true\)/);
  assert.match(source, /!\$studyExportWrap\.contains\(e\.target\)[\s\S]*?closeStudyExportMenu\(\)/);
});
