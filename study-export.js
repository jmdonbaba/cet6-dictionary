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

  function normalizeForms(forms) {
    if (typeof forms === 'string') return clean(forms);
    if (!forms || typeof forms !== 'object') return clean(forms);

    const inflections = Array.isArray(forms.inflections) ? forms.inflections : [];
    const derivatives = Array.isArray(forms.derivatives) ? forms.derivatives : [];
    const inflectionText = inflections
      .filter(item => item && clean(item.type) && clean(item.word))
      .map(item => `${clean(item.type)} ${clean(item.word)}`)
      .join('；');
    const derivativeText = derivatives
      .filter(item => item && clean(item.word) && clean(item.meaning))
      .map(item => `${clean(item.pos) ? `${clean(item.pos)} ` : ''}${clean(item.word)} ${clean(item.meaning)}`)
      .join('；');
    const groups = [];
    if (inflectionText) groups.push(`词形变化：${inflectionText}`);
    if (derivativeText) groups.push(`同根派生：${derivativeText}`);
    return groups.join('；') || '无';
  }

  function normalizeFavorites(favorites) {
    return (Array.isArray(favorites) ? favorites : []).map(favorite => ({
      word: clean(favorite && favorite.word),
      phonetic: clean(favorite && favorite.phonetic),
      pos: clean(favorite && favorite.pos),
      definitions: normalizeDefinitions(favorite || {}),
      forms: normalizeForms(favorite && favorite.forms),
      examples: normalizeExamples(favorite || {})
    }));
  }

  function createFilename(extension, date) {
    const d = date instanceof Date ? date : new Date();
    const pad = value => String(value).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `cet6-vocabulary-${stamp}.${String(extension).replace(/^\./, '')}`;
  }

  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function escapeMarkdown(value) {
    return clean(value).replace(/\r\n?|\n/g, '\n')
      .replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character])
      .replace(/([\\`*_{}\[\]()#+!|~])/g, '\\$1')
      .replace(/(^|\n)([ \t]{0,3})(-|\d{1,9}\.)(?=[ \t])/g, (_, lineStart, indent, marker) =>
        `${lineStart}${indent}${marker === '-' ? '\\-' : `${marker.slice(0, -1)}\\.`}`);
  }

  function studyDate(options) {
    const date = options && options.generatedAt instanceof Date ? options.generatedAt : new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function renderStudyCardHtml(word, index, options) {
    const continuation = Boolean(options && options.continuation);
    const includeNotes = !options || options.includeNotes !== false;
    const definitions = Array.isArray(word.definitions) ? word.definitions.filter(clean) : [];
    const examples = Array.isArray(word.examples) ? word.examples.slice(0, MAX_EXAMPLES) : [];
    const detail = continuation ? '' : [word.phonetic, word.pos].filter(clean).map(value => `<span>${escapeHtml(value)}</span>`).join(' ');
    const definitionBlock = !continuation && definitions.length
      ? `<div class="field"><strong>释义</strong><ul>${definitions.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></div>` : '';
    const formsBlock = !continuation && clean(word.forms)
      ? `<div class="field"><strong>词形</strong><p>${escapeHtml(word.forms)}</p></div>` : '';
    const exampleBlock = examples.length
      ? `<div class="field"><strong>例句</strong><ol>${examples.map(example => `<li>${clean(example && example.en) ? `<span>${escapeHtml(example.en)}</span>` : ''}${clean(example && example.cn) ? `<span class="translation">${escapeHtml(example.cn)}</span>` : ''}</li>`).join('')}</ol></div>` : '';
    return `<section class="study-card">
      <div class="word-heading"><h2>${index + 1}. ${escapeHtml(word.word)}${continuation ? '（续）' : ''}</h2>${continuation ? '' : '<span class="checkbox">□ 已掌握</span>'}</div>
      ${detail ? `<p class="pronunciation">${detail}</p>` : ''}
      ${definitionBlock}${formsBlock}${exampleBlock}
      ${includeNotes ? '<div class="notes"><strong>复习笔记</strong><div class="note-line"></div><div class="note-line"></div><div class="note-line"></div><div class="note-line"></div></div>' : ''}
    </section>`;
  }

  function renderHtml(words, options) {
    const items = Array.isArray(words) ? words : [];
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CET-6 收藏词汇背诵讲义</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { max-width: 820px; margin: 0 auto; padding: 24px; color: #111; background: #fff; font: 16px/1.6 system-ui, -apple-system, "Microsoft YaHei", sans-serif; }
    header { border-bottom: 2px solid #111; margin-bottom: 24px; padding-bottom: 14px; }
    h1 { font-size: 27px; margin: 0 0 8px; }
    h2 { font-size: 21px; margin: 0; overflow-wrap: anywhere; }
    p, ul, ol { margin: 4px 0 10px; }
    .meta { color: #444; }
    .study-card { break-inside: avoid; page-break-inside: avoid; border: 1px solid #555; border-radius: 6px; margin: 0 0 20px; padding: 15px 18px; }
    .word-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
    .checkbox { white-space: nowrap; font-size: 14px; }
    .pronunciation { color: #333; }
    .pronunciation span + span { margin-left: 12px; }
    .field { margin-top: 10px; }
    .field strong, .notes strong { display: block; font-size: 14px; }
    .field li { padding-left: 2px; }
    .translation { display: block; color: #333; }
    .notes { margin-top: 14px; }
    .note-line { border-bottom: 1px solid #999; height: 25px; }
    @media print { body { max-width: none; margin: 0; padding: 0; } .study-card { border-color: #555; } }
  </style>
</head>
<body>
  <header><h1>CET-6 收藏词汇背诵讲义</h1><div class="meta">生成日期：${studyDate(options)} · 共 ${items.length} 词</div></header>
  <main>${items.map(renderStudyCardHtml).join('\n')}</main>
</body>
</html>`;
  }

  function renderMarkdown(words, options) {
    const items = Array.isArray(words) ? words : [];
    const cards = items.map((word, index) => {
      const lines = [`## ${index + 1}. ${escapeMarkdown(word.word)}`, '- [ ] 已掌握'];
      const details = [word.phonetic, word.pos].filter(clean).map(escapeMarkdown);
      if (details.length) lines.push('', details.join(' · '));
      const definitions = Array.isArray(word.definitions) ? word.definitions.filter(clean) : [];
      if (definitions.length) lines.push('', '**释义**', ...definitions.map(value => `- ${escapeMarkdown(value)}`));
      if (clean(word.forms)) lines.push('', `**词形**：${escapeMarkdown(word.forms)}`);
      const examples = Array.isArray(word.examples) ? word.examples.slice(0, MAX_EXAMPLES) : [];
      if (examples.length) {
        lines.push('', '**例句**');
        examples.forEach((example, exampleIndex) => {
          const en = clean(example && example.en);
          const cn = clean(example && example.cn);
          if (en) lines.push(`${exampleIndex + 1}. **${escapeMarkdown(en)}**`);
          if (cn) lines.push(`   ${escapeMarkdown(cn)}`);
        });
      }
      lines.push('', '复习笔记：', '', '---');
      return lines.join('\n');
    });
    return [`# CET-6 收藏词汇背诵讲义`, '', `生成日期：${studyDate(options)} · 共 ${items.length} 词`, '', ...cards].join('\n');
  }

  function buildPdfPages(words, doc) {
    if (!Array.isArray(words)) throw new TypeError('PDF export requires an array of words');
    if (!doc || typeof doc.createElement !== 'function' || !doc.body || typeof doc.body.appendChild !== 'function') {
      throw new TypeError('PDF export requires a document with a body');
    }

    const host = doc.createElement('div');
    host.className = 'study-pdf-host';
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;pointer-events:none;';
    const pages = [];
    try {
      doc.body.appendChild(host);
      const style = doc.createElement('style');
      style.textContent = `
        .study-pdf-host, .study-pdf-host * { box-sizing: border-box; }
        .study-pdf-page { width: 794px; height: 1123px; overflow: hidden; padding: 68px; background: #fff;
          color: #111; font: 16px/1.6 system-ui, -apple-system, "Microsoft YaHei", sans-serif; }
        .study-pdf-page header { border-bottom: 2px solid #111; margin-bottom: 24px; padding-bottom: 14px; }
        .study-pdf-page h1 { font-size: 27px; margin: 0 0 8px; }
        .study-pdf-page h2 { font-size: 21px; margin: 0; overflow-wrap: anywhere; }
        .study-pdf-page p, .study-pdf-page ul, .study-pdf-page ol { margin: 4px 0 10px; }
        .study-pdf-page .meta { color: #444; }
        .study-pdf-page .study-card { border: 1px solid #555; border-radius: 6px; margin: 0 0 20px; padding: 15px 18px; }
        .study-pdf-page .word-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
        .study-pdf-page .checkbox { white-space: nowrap; font-size: 14px; }
        .study-pdf-page .pronunciation, .study-pdf-page .translation { color: #333; }
        .study-pdf-page .pronunciation span + span { margin-left: 12px; }
        .study-pdf-page .field { margin-top: 10px; }
        .study-pdf-page .field strong, .study-pdf-page .notes strong { display: block; font-size: 14px; }
        .study-pdf-page .field li { padding-left: 2px; }
        .study-pdf-page .translation { display: block; }
        .study-pdf-page .notes { margin-top: 14px; }
        .study-pdf-page .note-line { border-bottom: 1px solid #999; height: 25px; }
        .study-pdf-page .study-card--splittable { break-inside: auto; page-break-inside: auto; }
      `;
      host.appendChild(style);

      const addPage = () => {
        const next = doc.createElement('div');
        next.className = 'study-pdf-page';
        host.appendChild(next);
        pages.push(next);
        return next;
      };
      let page = addPage();
      const header = doc.createElement('header');
      header.innerHTML = `<h1>CET-6 收藏词汇背诵讲义</h1><div class="meta">生成日期：${studyDate()} · 共 ${words.length} 词</div>`;
      page.appendChild(header);

      const makeCard = (word, index, options) => {
        const wrapper = doc.createElement('div');
        wrapper.innerHTML = renderStudyCardHtml(word, index, options);
        const card = wrapper.firstElementChild;
        if (options && options.splittable) card.classList.add('study-card--splittable');
        return card;
      };

      const fitOversizedCard = (word, index) => {
        const examples = Array.isArray(word.examples) ? word.examples.slice(0, MAX_EXAMPLES) : [];
        const fragment = (items, continuation, includeNotes) =>
          makeCard({ ...word, examples: items }, index, { continuation, includeNotes, splittable: true });
        let continuation = false;
        let currentExamples = [];
        let active = fragment([], false, false);
        page.appendChild(active);
        if (page.scrollHeight > page.clientHeight) {
          active.remove();
          page = addPage();
          page.appendChild(active);
          if (page.scrollHeight > page.clientHeight) {
            throw new RangeError('PDF card content cannot fit on an A4 page');
          }
        }

        for (const example of examples) {
          active.remove();
          const candidate = fragment([...currentExamples, example], continuation, false);
          page.appendChild(candidate);
          if (page.scrollHeight <= page.clientHeight) {
            currentExamples.push(example);
            active = candidate;
            continue;
          }
          candidate.remove();
          page.appendChild(active);
          page = addPage();
          continuation = true;
          currentExamples = [example];
          active = fragment(currentExamples, true, false);
          page.appendChild(active);
          if (page.scrollHeight > page.clientHeight) {
            throw new RangeError('PDF example cannot fit on an A4 page');
          }
        }

        active.remove();
        const withNotes = fragment(currentExamples, continuation, true);
        page.appendChild(withNotes);
        if (page.scrollHeight > page.clientHeight) {
          withNotes.remove();
          page.appendChild(active);
          page = addPage();
          const notes = fragment([], true, true);
          page.appendChild(notes);
          if (page.scrollHeight > page.clientHeight) {
            throw new RangeError('PDF notes cannot fit on an A4 page');
          }
        }
      };

      words.forEach((word, index) => {
        const card = makeCard(word, index);
        page.appendChild(card);
        if (page.scrollHeight > page.clientHeight) {
          card.remove();
          const previousPage = page;
          page = addPage();
          page.appendChild(card);
          if (page.scrollHeight > page.clientHeight) {
            card.remove();
            page.remove();
            pages.pop();
            page = previousPage;
            fitOversizedCard(word, index);
          }
        }
      });
      return { host, pages };
    } catch (error) {
      host.remove();
      throw error;
    }
  }

  async function createPdfBlob(words, dependencies) {
    if (!Array.isArray(words)) throw new TypeError('PDF export requires an array of words');
    if (!dependencies || !dependencies.document || typeof dependencies.document.createElement !== 'function' ||
        !dependencies.document.body || typeof dependencies.document.body.appendChild !== 'function') {
      throw new TypeError('PDF export requires a document with a body');
    }
    if (typeof dependencies.html2canvas !== 'function') throw new TypeError('PDF export requires html2canvas');
    if (typeof dependencies.jsPDF !== 'function') throw new TypeError('PDF export requires jsPDF');

    let host;
    try {
      const built = buildPdfPages(words, dependencies.document);
      host = built.host;
      const pdf = new dependencies.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      for (const [pageIndex, page] of built.pages.entries()) {
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
      }
      return pdf.output('blob');
    } finally {
      if (host) host.remove();
    }
  }

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

  return {
    MAX_EXAMPLES, normalizeFavorites, createFilename,
    escapeHtml, escapeMarkdown, renderStudyCardHtml, renderHtml, renderMarkdown,
    buildPdfPages, createPdfBlob, downloadBlob
  };
});
