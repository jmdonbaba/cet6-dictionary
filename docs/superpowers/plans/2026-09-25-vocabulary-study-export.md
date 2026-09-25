# Vocabulary Study Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact favorites-menu export that downloads every saved word as polished PDF, standalone HTML, or Markdown study material.

**Architecture:** Keep the existing application build-free and add one UMD-style `study-export.js` module that is usable both from the browser and Node tests. Pure normalization and text renderers live in that module; the browser-only PDF adapter accepts its dependencies explicitly. `index.html` owns the menu state, busy feedback, download trigger, and connection to `getVFavs()`.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node.js built-in test runner, html2canvas 1.4.1, jsPDF 4.2.1 UMD.

## Global Constraints

- The export range is always all favorites; search never changes the export set.
- The visible button copy is exactly `导出`; the menu contains `PDF`, `HTML`, and `Markdown` without an “export all” heading.
- Each word contains its stored word, phonetic, part of speech, definitions/meaning, forms, at most 3 stored bilingual examples, an unchecked “已掌握” box, and a review-notes area.
- Never synthesize missing examples or translations.
- PDF downloads directly and must not call `window.print()`.
- PDF prioritizes visual quality and may rasterize high-resolution A4 pages; HTML and Markdown remain editable text.
- Study exports never include, read, or mutate the DeepSeek API key.
- Preserve the existing JSON backup/import behavior unchanged.
- All third-party browser assets are pinned and committed locally; runtime CDN access is forbidden.
- The app remains usable by opening `index.html` directly and gains no build step.

---

## File Structure

- Create `study-export.js`: normalization, escaping, filename generation, HTML/Markdown renderers, printable-page builder, and PDF generator.
- Create `vendor/html2canvas-1.4.1.min.js`: pinned browser bundle.
- Create `vendor/jspdf-4.2.1.umd.min.js`: pinned browser bundle.
- Create `vendor/THIRD_PARTY_NOTICES.md`: source, version, and license notes for vendored dependencies.
- Modify `index.html`: load local dependencies, add export menu markup/styles, wire the export workflow, and add the hidden PDF rendering host.
- Create `tests/study-export-model.test.js`: pure normalization, ordering, limits, and filename tests.
- Create `tests/study-export-formats.test.js`: HTML/Markdown content and escaping tests.
- Create `tests/study-export-ui.test.js`: static integration, copy, local dependency, direct-download, and API-key separation tests.

---

### Task 1: Vendor Fixed Browser Dependencies

**Files:**
- Create: `vendor/html2canvas-1.4.1.min.js`
- Create: `vendor/jspdf-4.2.1.umd.min.js`
- Create: `vendor/docx-9.7.1.iife.js`
- Create: `vendor/THIRD_PARTY_NOTICES.md`
- Create: `study-export.js`
- Create: `tests/study-export-ui.test.js`
- Modify: `index.html:608`

**Interfaces:**
- Consumes: npm registry archives for exactly `html2canvas@1.4.1`, `jspdf@4.2.1`, and `docx@9.7.1`.
- Produces: browser globals `window.html2canvas`, `window.jspdf.jsPDF`, `window.docx`, and an initially empty `window.StudyExport` namespace before the inline app script executes.

- [ ] **Step 1: Write the failing dependency test**

Create `tests/study-export-ui.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/study-export-ui.test.js`

Expected: FAIL because the four local script tags do not exist.

- [ ] **Step 3: Extract the pinned browser bundles and notices**

Use a temporary directory, extract the exact package files, then copy them to `vendor/`:

```powershell
$vendorTemp = Join-Path ([System.IO.Path]::GetTempPath()) ('cet6-vendor-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $vendorTemp | Out-Null
Push-Location $vendorTemp
npm pack html2canvas@1.4.1
npm pack jspdf@4.2.1
npm pack docx@9.7.1
tar -xf html2canvas-1.4.1.tgz
New-Item -ItemType Directory -Force -Path html2canvas | Out-Null
Move-Item -LiteralPath package -Destination html2canvas/package
tar -xf jspdf-4.2.1.tgz
New-Item -ItemType Directory -Force -Path jspdf | Out-Null
Move-Item -LiteralPath package -Destination jspdf/package
tar -xf docx-9.7.1.tgz
New-Item -ItemType Directory -Force -Path docx | Out-Null
Move-Item -LiteralPath package -Destination docx/package
Pop-Location
New-Item -ItemType Directory -Force -Path vendor | Out-Null
Copy-Item -LiteralPath (Join-Path $vendorTemp 'html2canvas/package/dist/html2canvas.min.js') -Destination 'vendor/html2canvas-1.4.1.min.js'
Copy-Item -LiteralPath (Join-Path $vendorTemp 'jspdf/package/dist/jspdf.umd.min.js') -Destination 'vendor/jspdf-4.2.1.umd.min.js'
Copy-Item -LiteralPath (Join-Path $vendorTemp 'docx/package/dist/index.iife.js') -Destination 'vendor/docx-9.7.1.iife.js'
```

Create `vendor/THIRD_PARTY_NOTICES.md` with all three package names, exact versions, MIT license, package homepage, and the copied license text location/source archive integrity recorded from `npm pack --json`.

Add these script tags immediately before the existing inline `<script>` in `index.html`, in this order:

```html
<script src="vendor/html2canvas-1.4.1.min.js"></script>
<script src="vendor/jspdf-4.2.1.umd.min.js"></script>
<script src="vendor/docx-9.7.1.iife.js"></script>
<script src="study-export.js"></script>
```

Create the initial `study-export.js` module so the page never references a missing asset between tasks:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {};
});
```

- [ ] **Step 4: Run the dependency test**

Run: `node --test tests/study-export-ui.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add vendor tests/study-export-ui.test.js study-export.js index.html
git commit -m "build: vendor study export libraries"
```

---

### Task 2: Normalize Favorites into a Stable Export Model

**Files:**
- Modify: `study-export.js`
- Create: `tests/study-export-model.test.js`

**Interfaces:**
- Consumes: `Array<object>` from the existing `getVFavs()` function.
- Produces: `StudyExport.normalizeFavorites(favorites) -> Array<StudyWord>` and `StudyExport.createFilename(extension, date) -> string`.
- `StudyWord` shape: `{ word, phonetic, pos, definitions, forms, examples }`, where all scalar fields are strings, `definitions` is a non-empty-string array, and `examples` contains at most three `{ en, cn }` objects.

- [ ] **Step 1: Write failing model tests**

Create `tests/study-export-model.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const StudyExport = require('../study-export.js');

test('normalizes legacy fields without changing favorite order', () => {
  const result = StudyExport.normalizeFavorites([
    {
      word: 'combat', phonetic: '/ˈkɒmbæt/', pos: 'n. & v.',
      definitions: ['n. 战斗', '', 'v. 抑制'], meaning: '回退释义', forms: 'combated',
      examples: [
        { en: 'One.', cn: '一。' },
        'Two.',
        { en: 'Three.', cn: '三。' },
        { en: 'Four.', cn: '四。' }
      ]
    },
    { word: 'plain', meaning: '简单的', sentences: [{ en: 'Plain example.', cn: '简单例句。' }] }
  ]);

  assert.deepEqual(result[0], {
    word: 'combat', phonetic: '/ˈkɒmbæt/', pos: 'n. & v.',
    definitions: ['n. 战斗', 'v. 抑制'], forms: 'combated',
    examples: [
      { en: 'One.', cn: '一。' },
      { en: 'Two.', cn: '' },
      { en: 'Three.', cn: '三。' }
    ]
  });
  assert.equal(result[1].word, 'plain');
  assert.deepEqual(result[1].definitions, ['简单的']);
  assert.equal(result[1].examples.length, 1);
});

test('does not invent content for missing fields', () => {
  assert.deepEqual(StudyExport.normalizeFavorites([{ word: 'empty' }])[0], {
    word: 'empty', phonetic: '', pos: '', definitions: [], forms: '', examples: []
  });
});

test('builds a deterministic timestamped filename', () => {
  const date = new Date(2026, 8, 25, 14, 3, 9);
  assert.equal(StudyExport.createFilename('pdf', date), 'cet6-vocabulary-20260925-140309.pdf');
});
```

- [ ] **Step 2: Run the model tests and verify failure**

Run: `node --test tests/study-export-model.test.js`

Expected: FAIL because `StudyExport.normalizeFavorites` is undefined.

- [ ] **Step 3: Implement the UMD module and pure model functions**

Create `study-export.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_EXAMPLES = 3;
  const clean = value => value == null ? '' : String(value).trim();

  function normalizeDefinitions(favorite) {
    const values = Array.isArray(favorite.definitions)
      ? favorite.definitions.map(clean).filter(Boolean)
      : [];
    if (values.length) return values;
    const meaning = clean(favorite.meaning);
    return meaning ? [meaning] : [];
  }

  function normalizeExamples(favorite) {
    const source = Array.isArray(favorite.examples)
      ? favorite.examples
      : (Array.isArray(favorite.sentences) ? favorite.sentences : []);
    return source.slice(0, MAX_EXAMPLES).map(example => {
      if (typeof example === 'string') return { en: clean(example), cn: '' };
      return { en: clean(example && example.en), cn: clean(example && example.cn) };
    }).filter(example => example.en || example.cn);
  }

  function normalizeFavorites(favorites) {
    return (Array.isArray(favorites) ? favorites : []).map(favorite => ({
      word: clean(favorite && favorite.word),
      phonetic: clean(favorite && favorite.phonetic),
      pos: clean(favorite && favorite.pos),
      definitions: normalizeDefinitions(favorite || {}),
      forms: clean(favorite && favorite.forms),
      examples: normalizeExamples(favorite || {})
    }));
  }

  function createFilename(extension, date) {
    const d = date instanceof Date ? date : new Date();
    const pad = value => String(value).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `cet6-vocabulary-${stamp}.${String(extension).replace(/^\./, '')}`;
  }

  return { MAX_EXAMPLES, normalizeFavorites, createFilename };
});
```

- [ ] **Step 4: Run the model tests**

Run: `node --test tests/study-export-model.test.js`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add study-export.js tests/study-export-model.test.js
git commit -m "feat: normalize vocabulary study exports"
```

---

### Task 3: Generate Editable HTML and Markdown

**Files:**
- Modify: `study-export.js`
- Create: `tests/study-export-formats.test.js`

**Interfaces:**
- Consumes: normalized `Array<StudyWord>` plus `{ generatedAt: Date }`.
- Produces: `renderHtml(words, options) -> string`, `renderMarkdown(words, options) -> string`, and `downloadBlob(blob, filename, document) -> void`.

- [ ] **Step 1: Write failing renderer tests**

Create `tests/study-export-formats.test.js` with a fixture containing `combat`, HTML metacharacters, Markdown punctuation, three bilingual examples, and a fourth example. Assert that:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const StudyExport = require('../study-export.js');

const words = StudyExport.normalizeFavorites([{
  word: 'combat <&>', phonetic: '/test/', pos: 'n. | v.',
  definitions: ['战斗 *重点*', '防止'], forms: 'combats | combated',
  examples: [
    { en: 'Example <one>.', cn: '例句一。' },
    { en: 'Example two.', cn: '例句二。' },
    { en: 'Example three.', cn: '例句三。' },
    { en: 'Example four.', cn: '例句四。' }
  ]
}]);

test('HTML is standalone, escaped, printable, and contains three examples', () => {
  const html = StudyExport.renderHtml(words, { generatedAt: new Date(2026, 8, 25) });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /@page\s*\{\s*size:\s*A4/);
  assert.match(html, /combat &lt;&amp;&gt;/);
  assert.match(html, /Example &lt;one&gt;\./);
  assert.match(html, /例句三。/);
  assert.doesNotMatch(html, /Example four/);
  assert.match(html, /已掌握/);
  assert.match(html, /复习笔记/);
});

test('Markdown escapes structure and uses a task checkbox', () => {
  const md = StudyExport.renderMarkdown(words, { generatedAt: new Date(2026, 8, 25) });
  assert.match(md, /^# CET-6 收藏词汇背诵讲义/m);
  assert.match(md, /- \[ \] 已掌握/);
  assert.match(md, /n\. \\| v\./);
  assert.match(md, /战斗 \\*重点\\\*/);
  assert.match(md, /3\. \*\*Example three\.\*\*/);
  assert.doesNotMatch(md, /Example four/);
});
```

- [ ] **Step 2: Run renderer tests and verify failure**

Run: `node --test tests/study-export-formats.test.js`

Expected: FAIL because `renderHtml` and `renderMarkdown` are undefined.

- [ ] **Step 3: Add escaping, shared study-card markup, and both renderers**

Add `escapeHtml`, `escapeMarkdown`, `renderStudyCardHtml`, `renderHtml`, and `renderMarkdown` inside `study-export.js`. Use a complete standalone HTML document with inline A4 styles, `break-inside: avoid`, high-contrast typography, a title page header, and `.study-card` sections. Skip empty blocks instead of rendering empty labels. Use `□` for the printable checkbox and four ruled note lines in HTML; use `- [ ] 已掌握` plus `复习笔记：` and a horizontal rule in Markdown.

Add this exact download helper:

```js
function downloadBlob(blob, filename, doc) {
  const targetDocument = doc || document;
  const url = URL.createObjectURL(blob);
  const anchor = targetDocument.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  targetDocument.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

Export all six new functions from the module return object.

- [ ] **Step 4: Run model and renderer tests**

Run: `node --test tests/study-export-model.test.js tests/study-export-formats.test.js`

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add study-export.js tests/study-export-formats.test.js
git commit -m "feat: render editable study documents"
```

---

### Task 4: Remove the Cancelled Word/DOCX Dependency

**Files:**
- Delete: `vendor/docx-9.7.1.iife.js`
- Delete: `vendor/licenses/docx-9.7.1-MIT.txt`
- Modify: `vendor/THIRD_PARTY_NOTICES.md`
- Modify: `index.html`
- Modify: `tests/study-export-ui.test.js`

**Interfaces:**
- Consumes: the completed Task 1 dependency setup and the user's revised three-format scope.
- Produces: a dependency surface containing only `window.html2canvas`, `window.jspdf.jsPDF`, and `window.StudyExport`.

- [ ] **Step 1: Change the dependency test to reject DOCX assets**

Replace the DOCX expectation in `tests/study-export-ui.test.js` and add absence checks:

```js
test('does not load or advertise the cancelled Word export', () => {
  assert.doesNotMatch(source, /docx-9\.7\.1|data-study-format="word"|>Word</i);
  assert.equal(fs.existsSync('vendor/docx-9.7.1.iife.js'), false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/study-export-ui.test.js`

Expected: FAIL because the DOCX script and vendor file still exist.

- [ ] **Step 3: Remove the cancelled dependency completely**

Delete the DOCX IIFE and its copied license, remove the DOCX `<script>` tag from `index.html`, and remove the DOCX entry from `vendor/THIRD_PARTY_NOTICES.md`. Leave html2canvas and jsPDF pinned exactly as they are. Do not add a Word menu item or Word generator.

- [ ] **Step 4: Run all export tests**

Run: `node --test tests/study-export-ui.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add -A vendor index.html tests/study-export-ui.test.js
git commit -m "chore: remove cancelled Word export dependency"
```

---

### Task 5: Generate High-Resolution Direct-Download PDF

**Files:**
- Modify: `study-export.js`
- Modify: `tests/study-export-ui.test.js`

**Interfaces:**
- Consumes: normalized `Array<StudyWord>` and `{ document, html2canvas, jsPDF }` dependencies.
- Produces: `createPdfBlob(words, dependencies) -> Promise<Blob>`.

- [ ] **Step 1: Add failing PDF safety tests**

Append to `tests/study-export-ui.test.js`:

```js
test('PDF generation is high-resolution and never opens the print dialog', () => {
  const moduleSource = fs.readFileSync('study-export.js', 'utf8');
  assert.match(moduleSource, /async function createPdfBlob\(words, dependencies\)/);
  assert.match(moduleSource, /scale:\s*2/);
  assert.match(moduleSource, /new dependencies\.jsPDF\(\{[^}]*format:\s*'a4'/s);
  assert.doesNotMatch(moduleSource, /window\.print|\.print\(\)/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/study-export-ui.test.js`

Expected: FAIL because `createPdfBlob` is absent.

- [ ] **Step 3: Implement measured A4 page composition and raster PDF output**

Add `buildPdfPages(words, doc)` and `createPdfBlob(words, dependencies)` to `study-export.js`.

`buildPdfPages` must create an off-screen fixed-width host, insert a title header and study cards using the same content hierarchy as HTML, and pack whole cards into `.study-pdf-page` containers by measuring `scrollHeight <= clientHeight`. When a card does not fit, move it to a fresh page. If a single card is taller than a page, mark it `.study-card--splittable` and let its examples flow. Return `{ host, pages }` so cleanup is guaranteed.

`createPdfBlob` must validate all three dependencies, render each page with the exact canvas options below, place each page as JPEG on an A4 jsPDF page, remove the off-screen host in `finally`, and return `pdf.output('blob')`:

```js
const canvas = await dependencies.html2canvas(page, {
  scale: 2,
  backgroundColor: '#ffffff',
  logging: false,
  useCORS: false,
  windowWidth: 794
});
const image = canvas.toDataURL('image/jpeg', 0.96);
if (pageIndex > 0) pdf.addPage('a4', 'portrait');
pdf.addImage(image, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
```

Instantiate the document exactly once:

```js
const pdf = new dependencies.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
```

Export both functions for browser QA and test inspection.

- [ ] **Step 4: Run all export tests**

Run: `node --test tests/study-export-model.test.js tests/study-export-formats.test.js tests/study-export-ui.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add study-export.js tests/study-export-ui.test.js
git commit -m "feat: generate printable vocabulary pdf"
```

---

### Task 6: Add the Compact Export Menu and Workflow

**Files:**
- Modify: `index.html:430-530`
- Modify: `index.html:576-589`
- Modify: `index.html:620-670`
- Modify: `index.html:1095-1135`
- Modify: `index.html:1850-1870`
- Modify: `tests/study-export-ui.test.js`

**Interfaces:**
- Consumes: `getVFavs()`, `toast(message)`, `StudyExport.*`, `window.html2canvas`, and `window.jspdf.jsPDF`.
- Produces: `setStudyExportBusy(isBusy)`, `closeStudyExportMenu()`, `exportStudyDocument(format)`, and accessible DOM IDs `btnStudyExport`, `studyExportMenu`.

- [ ] **Step 1: Add failing UI tests**

Append tests asserting exact markup and behavior contracts:

```js
test('favorites modal offers a compact three-format export menu', () => {
  assert.match(source, /id="btnStudyExport"[^>]*>导出<span aria-hidden="true">⌄<\/span><\/button>/);
  assert.match(source, /id="studyExportMenu"/);
  for (const format of ['PDF', 'HTML', 'Markdown']) {
    assert.match(source, new RegExp(`data-study-format="${format.toLowerCase()}"[^>]*>${format}<`));
  }
  assert.doesNotMatch(source, />导出全部/);
});

test('study export always snapshots all favorites and excludes API keys', () => {
  assert.match(source, /StudyExport\.normalizeFavorites\(getVFavs\(\)\)/);
  assert.doesNotMatch(source, /exportStudyDocument[\s\S]{0,1200}getApiKey\(/);
});

test('empty favorites disable export and busy state prevents duplicate downloads', () => {
  assert.match(source, /\$btnStudyExport\.disabled\s*=\s*!favs\.length/);
  assert.match(source, /setStudyExportBusy\(true\)/);
  assert.match(source, /finally\s*\{\s*setStudyExportBusy\(false\)/);
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run: `node --test tests/study-export-ui.test.js`

Expected: FAIL because the menu and workflow do not exist.

- [ ] **Step 3: Add responsive accessible markup and CSS**

Inside `.modal-header`, wrap the existing title and actions so the title can shrink without overflow. Add:

```html
<div class="modal-header-actions">
  <div class="study-export-wrap">
    <button class="btn-study-export" id="btnStudyExport" type="button" aria-haspopup="menu" aria-expanded="false">导出<span aria-hidden="true">⌄</span></button>
    <div class="study-export-menu" id="studyExportMenu" role="menu" hidden>
      <button type="button" role="menuitem" data-study-format="pdf">PDF</button>
      <button type="button" role="menuitem" data-study-format="html">HTML</button>
      <button type="button" role="menuitem" data-study-format="markdown">Markdown</button>
    </div>
  </div>
  <button class="modal-close" data-close="modalVocabFav" aria-label="关闭词汇收藏">&times;</button>
</div>
```

Style the menu as a right-aligned absolute popover with a minimum 44px item height, visible focus states, and a mobile-safe max width. Allow the modal header to wrap only when its contents cannot fit. Add `#studyPdfRenderHost` immediately before the script tags with `aria-hidden="true"`.

- [ ] **Step 4: Implement menu state and export dispatch**

Add the following control flow near the favorites logic:

```js
async function exportStudyDocument(format) {
  const words = StudyExport.normalizeFavorites(getVFavs());
  if (!words.length) { toast('收藏夹为空，暂无可导出的单词'); return; }
  closeStudyExportMenu();
  setStudyExportBusy(true);
  try {
    let blob;
    let extension;
    if (format === 'pdf') {
      blob = await StudyExport.createPdfBlob(words, {
        document,
        html2canvas: window.html2canvas,
        jsPDF: window.jspdf && window.jspdf.jsPDF
      });
      extension = 'pdf';
    } else if (format === 'html') {
      blob = new Blob([StudyExport.renderHtml(words, { generatedAt: new Date() })], { type: 'text/html;charset=utf-8' });
      extension = 'html';
    } else {
      blob = new Blob([StudyExport.renderMarkdown(words, { generatedAt: new Date() })], { type: 'text/markdown;charset=utf-8' });
      extension = 'md';
    }
    StudyExport.downloadBlob(blob, StudyExport.createFilename(extension), document);
    toast('背诵讲义已下载');
  } catch (error) {
    console.error(error);
    toast(error && error.message ? error.message : '导出失败，请重试');
  } finally {
    setStudyExportBusy(false);
  }
}
```

Wire click, outside-click, and Escape handlers. `setStudyExportBusy(true)` must set `disabled`, `aria-busy="true"`, and text `正在生成…`; false restores `导出⌄`. `renderVFavs()` must set `$btnStudyExport.disabled = !favs.length` after reading favorites.

- [ ] **Step 5: Run all tests**

Run: `node --test tests/*.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add index.html tests/study-export-ui.test.js
git commit -m "feat: add favorites study export menu"
```

---

### Task 7: Browser and Artifact Verification

**Files:**
- Modify if defects are found: `index.html`, `study-export.js`, relevant `tests/*.test.js`

**Interfaces:**
- Consumes: completed export workflow and a local browser.
- Produces: three downloadable artifacts verified with representative favorites data.

- [ ] **Step 1: Run the full automated suite**

Run: `node --test tests/*.test.js`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run a local static server and seed representative favorites**

Run: `python -m http.server 8000`

In browser DevTools, set `cet6_vfav_v1` to a JSON array containing: a long word, Chinese punctuation, missing phonetic/forms, exactly three bilingual examples, and a long definition. Reload and open “词汇收藏”.

- [ ] **Step 3: Verify interaction and responsive layout**

At desktop width and 390px width, verify the modal header does not overflow, the button reads `导出`, the menu lists exactly PDF/HTML/Markdown, click-outside and Escape close it, and empty favorites disable it.

- [ ] **Step 4: Download and inspect all three artifacts**

Verify PDF downloads without a print dialog, is sharp at 200% zoom, uses A4 pages, contains three bilingual examples, and avoids splitting normal cards. Open HTML without the app and print-preview its A4 styling. Open Markdown in a renderer and verify escaped punctuation and the unchecked mastery box.

- [ ] **Step 5: Verify privacy and regression boundaries**

Search the three generated files for the saved API key; it must not appear. Then run the existing JSON “导出数据” and “导入数据” flows to confirm their filename, payload, and behavior remain unchanged.

- [ ] **Step 6: Commit any verification fixes**

If verification required changes:

```powershell
git add index.html study-export.js tests
git commit -m "fix: polish study export artifacts"
```

If no changes were required, do not create an empty commit.
