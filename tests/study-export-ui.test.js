const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const StudyExport = require('../study-export.js');

const source = fs.readFileSync('index.html', 'utf8');

test('loads pinned study-export dependencies from local files', () => {
  assert.match(source, /src="vendor\/html2canvas-1\.4\.1\.min\.js"/);
  assert.match(source, /src="vendor\/jspdf-4\.2\.1\.umd\.min\.js"/);
  assert.match(source, /src="study-export\.js"/);
  assert.doesNotMatch(source, /(?:unpkg|jsdelivr|cdnjs)/i);
});

test('does not load or advertise the cancelled Word export', () => {
  assert.doesNotMatch(source, /docx-9\.7\.1|data-study-format="word"|>Word</i);
  assert.equal(fs.existsSync('vendor/docx-9.7.1.iife.js'), false);
});

test('favorites modal offers exactly PDF, HTML, and Markdown in a compact menu', () => {
  assert.match(source, /id="btnStudyExport"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*>导出<span aria-hidden="true">⌄<\/span><\/button>/);
  assert.match(source, /id="studyExportMenu"[^>]*role="menu"[^>]*hidden/);
  const items = [...source.matchAll(/data-study-format="([^"]+)"[^>]*>([^<]+)<\/button>/g)];
  assert.deepEqual(items.map(([, format, label]) => [format, label]), [
    ['pdf', 'PDF'], ['html', 'HTML'], ['markdown', 'Markdown']
  ]);
  assert.doesNotMatch(source, />导出全部/);
});

test('study export snapshots all favorites, independent of search, without API keys', () => {
  assert.match(source, /StudyExport\.normalizeFavorites\(getVFavs\(\)\)/);
  const workflow = source.match(/async function exportStudyDocument\(format\) \{[\s\S]*?\n\}/);
  assert.ok(workflow, 'study export workflow exists');
  assert.doesNotMatch(workflow[0], /getApiKey|favSearch|searchTerm/);
  assert.match(workflow[0], /StudyExport\.downloadBlob\(blob, StudyExport\.createFilename\(extension\), document\)/);
});

test('empty favorites disable study export and busy state recovers after errors', () => {
  assert.match(source, /\$btnStudyExport\.disabled\s*=\s*!favs\.length/);
  assert.match(source, /function setStudyExportBusy\(isBusy\)/);
  assert.match(source, /setStudyExportBusy\(true\)/);
  assert.match(source, /finally\s*\{\s*setStudyExportBusy\(false\)/);
  assert.match(source, /aria-busy/);
  assert.match(source, /正在生成…/);
});

test('study export menu closes on outside click and Escape, returning focus to its trigger', () => {
  assert.match(source, /function closeStudyExportMenu\([^)]*\)/);
  assert.match(source, /\$btnStudyExport\.focus\(\)/);
  assert.match(source, /e\.key === 'Escape'[\s\S]*?closeStudyExportMenu\(true\)/);
  assert.match(source, /!\$studyExportWrap\.contains\(e\.target\)[\s\S]*?closeStudyExportMenu\(\)/);
});

test('favorites refresh cannot re-enable export while a PDF is pending, and errors recover', async () => {
  const script = source.slice(source.indexOf('function renderVFavs()'), source.indexOf('// ==================== Word Search Modules ===================='));
  const favorites = [{ id: '1', word: 'alpha', meaning: 'first' }, { id: '2', word: 'beta', meaning: 'second' }];
  const messages = [];
  const button = { disabled: false, innerHTML: '', setAttribute() {}, focus() {} };
  const menu = { hidden: false };
  let rejectPdf;
  let pdfCalls = 0;
  let snapshot;
  const context = vm.createContext({
    $vocabFavCnt: { textContent: '' }, $modalVocabCount: { textContent: '' },
    $favSearch: { style: {} }, $favListContainer: { innerHTML: '' },
    $btnStudyExport: button, $studyExportMenu: menu,
    getVFavs: () => favorites, hideSearchDropdown() {}, esc: value => value,
    escAttr: value => value, renderForms: () => '', toast: message => messages.push(message),
    document: { getElementById: () => null }, window: { html2canvas() {}, jspdf: { jsPDF: class {} } },
    StudyExport: {
      normalizeFavorites: favs => { snapshot = [...favs]; return [...favs]; },
      createPdfBlob: () => { pdfCalls++; return new Promise((_, reject) => { rejectPdf = reject; }); },
      downloadBlob() { throw new Error('unexpected download'); }
    },
    console: { error() {} }, Blob
  });
  vm.runInContext(script, context);
  const pending = vm.runInContext("exportStudyDocument('pdf')", context);
  assert.deepEqual(snapshot, favorites);
  assert.equal(button.disabled, true);
  assert.match(button.innerHTML, /正在生成…/);
  vm.runInContext('renderVFavs()', context);
  assert.equal(button.disabled, true);
  await vm.runInContext("exportStudyDocument('pdf')", context);
  assert.equal(pdfCalls, 1);
  rejectPdf(new Error('canvas failure'));
  await pending;
  assert.equal(button.disabled, false);
  assert.match(button.innerHTML, /导出/);
  assert.equal(messages.at(-1), 'canvas failure');
});

test('PDF generation is high-resolution and never opens the print dialog', () => {
  const moduleSource = fs.readFileSync('study-export.js', 'utf8');
  assert.match(moduleSource, /async function createPdfBlob\(words, dependencies\)/);
  assert.match(moduleSource, /scale:\s*2/);
  assert.match(moduleSource, /new dependencies\.jsPDF\(\{[^}]*format:\s*'a4'/s);
  assert.doesNotMatch(moduleSource, /window\.print|\.print\(\)/);
});

function fakeDocument(cardHeights = []) {
  const cards = [];
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.className = '';
      this.height = tag === 'header' ? 80 : 0;
      this.classList = {
        add: name => { this.className = `${this.className} ${name}`.trim(); },
        contains: name => this.className.split(/\s+/).includes(name)
      };
    }
    appendChild(child) {
      if (child.parentNode) child.remove();
      this.children.push(child);
      child.parentNode = this;
      return child;
    }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    set innerHTML(value) {
      this.markup = value;
      if (this.tagName === 'div' && value.includes('<section class="study-card')) {
        const card = new Element('section');
        card.className = value.match(/<section class="([^"]+)"/)[1];
        card.height = typeof cardHeights === 'function' ? cardHeights(value) : cardHeights[cards.length] || 0;
        card.markup = value;
        cards.push(card);
        this.children = [card];
        card.parentNode = this;
      }
    }
    get firstElementChild() { return this.children[0] || null; }
    get clientHeight() { return this.classList.contains('study-pdf-page') ? 1000 : 0; }
    get scrollHeight() { return this.children.reduce((sum, child) => sum + child.height, 0); }
  }
  const body = new Element('body');
  return { body, cards, createElement: tag => new Element(tag) };
}

test('PDF packs whole cards onto measured pages and returns a Blob', async () => {
  const document = fakeDocument([450, 450, 450]);
  const rendered = [];
  const images = [];
  let pdfOptions;
  const output = new Blob(['pdf'], { type: 'application/pdf' });
  class Pdf {
    constructor(options) { pdfOptions = options; }
    addPage(...args) { images.push(['page', ...args]); }
    addImage(...args) { images.push(['image', ...args]); }
    output(type) { assert.equal(type, 'blob'); return output; }
  }
  const words = StudyExport.normalizeFavorites(['one', 'two', 'three'].map(word => ({ word })));
  const blob = await StudyExport.createPdfBlob(words, {
    document,
    html2canvas: async (page, options) => {
      rendered.push({ page, options });
      return { toDataURL: (...args) => { assert.deepEqual(args, ['image/jpeg', 0.96]); return 'data:image/jpeg;base64,test'; } };
    },
    jsPDF: Pdf
  });

  assert.equal(blob, output);
  assert.deepEqual(pdfOptions, { orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  assert.equal(rendered.length, 2);
  assert.deepEqual(rendered.map(item => item.page.children.filter(node => node.classList.contains('study-card')).length), [2, 1]);
  assert.deepEqual(rendered[0].options, {
    scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: false, windowWidth: 794
  });
  assert.deepEqual(images.map(item => item[0]), ['image', 'page', 'image']);
  assert.deepEqual(images.filter(item => item[0] === 'image').map(item => item.slice(2)), [
    ['JPEG', 0, 0, 210, 297, undefined, 'FAST'],
    ['JPEG', 0, 0, 210, 297, undefined, 'FAST']
  ]);
  assert.equal(document.body.children.length, 0);
});

test('PDF removes its offscreen host when canvas rendering fails', async () => {
  const document = fakeDocument([400]);
  const words = StudyExport.normalizeFavorites([{ word: 'one' }]);
  await assert.rejects(StudyExport.createPdfBlob(words, {
    document, html2canvas: async () => { throw new Error('canvas failure'); }, jsPDF: class Pdf {}
  }), /canvas failure/);
  assert.equal(document.body.children.length, 0);
});

test('PDF reports invalid dependencies before touching the DOM', async () => {
  const document = fakeDocument();
  const words = [];
  await assert.rejects(StudyExport.createPdfBlob(words, {}), /document/i);
  await assert.rejects(StudyExport.createPdfBlob(words, { document }), /html2canvas/i);
  await assert.rejects(StudyExport.createPdfBlob(words, { document, html2canvas: () => {} }), /jsPDF/i);
  assert.equal(document.body.children.length, 0);
});

test('oversized PDF cards flow examples across A4 pages without clipping', () => {
  const document = fakeDocument(markup => 300 + (markup.match(/Example \d/g) || []).length * 400);
  const words = StudyExport.normalizeFavorites([{
    word: 'long', examples: [1, 2, 3].map(number => ({ en: `Example ${number}` }))
  }]);
  const { host, pages } = StudyExport.buildPdfPages(words, document);
  try {
    const cards = pages.flatMap(page => page.children.filter(node => node.classList.contains('study-card')));
    assert.ok(cards.length > 1);
    assert.ok(pages[0].children.some(node => node.classList.contains('study-card')));
    assert.ok(cards.every(card => card.classList.contains('study-card--splittable')));
    assert.ok(pages.every(page => page.scrollHeight <= page.clientHeight));
    const content = cards.map(card => card.markup).join('');
    for (const number of [1, 2, 3]) {
      assert.equal((content.match(new RegExp(`Example ${number}`, 'g')) || []).length, 1);
    }
  } finally {
    host.remove();
  }
});

function renderedSource(pages, source) {
  const cards = pages.flatMap(page => page.children.filter(node => node.classList.contains('study-card')));
  const pattern = new RegExp(`<span class="study-pdf-value" data-source="${source}">([^<]*)<\\/span>`, 'g');
  return cards.flatMap(card => [...card.markup.matchAll(pattern)].map(match => match[1])).join('');
}

test('PDF continues oversized definitions and forms without losing source text', () => {
  const document = fakeDocument(markup => 180 + markup.replace(/<[^>]*>/g, '').length * 8);
  const definition = 'D'.repeat(300);
  const forms = 'F'.repeat(280);
  const words = StudyExport.normalizeFavorites([{ word: 'long', definitions: [definition], forms }]);
  const { host, pages } = StudyExport.buildPdfPages(words, document);
  try {
    assert.ok(pages.length > 2);
    assert.ok(pages.every(page => page.scrollHeight <= page.clientHeight));
    assert.equal(renderedSource(pages, 'definition-0'), definition);
    assert.equal(renderedSource(pages, 'forms'), forms);
    const cards = pages.flatMap(page => page.children.filter(node => node.classList.contains('study-card')));
    assert.ok(cards.slice(1).every(card => card.markup.includes('long（续）')));
  } finally {
    host.remove();
  }
});

test('PDF continues one oversized bilingual example and retains all three examples', () => {
  const document = fakeDocument(markup => 180 + markup.replace(/<[^>]*>/g, '').length * 8);
  const firstEn = 'E'.repeat(260);
  const firstCn = '中'.repeat(240);
  const words = StudyExport.normalizeFavorites([{
    word: 'bilingual', examples: [
      { en: firstEn, cn: firstCn },
      { en: 'Second sentence.', cn: '第二句。' },
      { en: 'Third sentence.', cn: '第三句。' }
    ]
  }]);
  const { host, pages } = StudyExport.buildPdfPages(words, document);
  try {
    assert.ok(pages.length > 2);
    assert.ok(pages.every(page => page.scrollHeight <= page.clientHeight));
    assert.equal(renderedSource(pages, 'example-0-en'), firstEn);
    assert.equal(renderedSource(pages, 'example-0-cn'), firstCn);
    assert.equal(renderedSource(pages, 'example-1-en'), 'Second sentence.');
    assert.equal(renderedSource(pages, 'example-1-cn'), '第二句。');
    assert.equal(renderedSource(pages, 'example-2-en'), 'Third sentence.');
    assert.equal(renderedSource(pages, 'example-2-cn'), '第三句。');
  } finally {
    host.remove();
  }
});

test('the first PDF fragment keeps its checkbox when moved before source text fits', () => {
  const document = fakeDocument(markup => 180 + markup.replace(/<[^>]*>/g, '').length * 8);
  const definition = 'D'.repeat(300);
  const words = StudyExport.normalizeFavorites([{ word: 'relocated', definitions: [definition] }]);
  const { host, pages } = StudyExport.buildPdfPages(words, document);
  try {
    const cards = pages.flatMap(page => page.children.filter(node => node.classList.contains('study-card')));
    assert.equal(pages[0].children.filter(node => node.classList.contains('study-card')).length, 0);
    assert.ok(cards.length > 1);
    assert.match(cards[0].markup, /□ 已掌握/);
    assert.doesNotMatch(cards[0].markup, /relocated（续）/);
    assert.ok(cards.slice(1).every(card => card.markup.includes('relocated（续）')));
    assert.equal((cards.map(card => card.markup).join('').match(/□ 已掌握/g) || []).length, 1);
    assert.equal(renderedSource(pages, 'definition-0'), definition);
  } finally {
    host.remove();
  }
});

test('ordinary PDF cards wrap unbroken definitions, forms, and both example languages', () => {
  const document = fakeDocument([400]);
  const words = StudyExport.normalizeFavorites([{
    word: 'ordinary', definitions: ['D'.repeat(40)], forms: 'F'.repeat(40),
    examples: [{ en: 'E'.repeat(40), cn: '中'.repeat(40) }]
  }]);
  const { host, pages } = StudyExport.buildPdfPages(words, document);
  try {
    const style = host.children.find(node => node.tagName === 'style').textContent;
    const card = pages[0].children.find(node => node.classList.contains('study-card'));
    assert.ok(card && !card.classList.contains('study-card--splittable'));
    assert.match(card.markup, /<ul><li>D{40}<\/li><\/ul>/);
    assert.match(card.markup, /<p>F{40}<\/p>/);
    assert.match(card.markup, /<li><span>E{40}<\/span><span class="translation">中{40}<\/span><\/li>/);
    assert.match(style, /\.study-pdf-page \.field p,\s*\.study-pdf-page \.field li,\s*\.study-pdf-page \.translation\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word/s);
  } finally {
    host.remove();
  }
});
