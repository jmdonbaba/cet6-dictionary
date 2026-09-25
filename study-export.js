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

  function renderStudyCardHtml(word, index) {
    const definitions = Array.isArray(word.definitions) ? word.definitions.filter(clean) : [];
    const examples = Array.isArray(word.examples) ? word.examples.slice(0, MAX_EXAMPLES) : [];
    const detail = [word.phonetic, word.pos].filter(clean).map(value => `<span>${escapeHtml(value)}</span>`).join(' ');
    const definitionBlock = definitions.length
      ? `<div class="field"><strong>释义</strong><ul>${definitions.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></div>` : '';
    const formsBlock = clean(word.forms)
      ? `<div class="field"><strong>词形</strong><p>${escapeHtml(word.forms)}</p></div>` : '';
    const exampleBlock = examples.length
      ? `<div class="field"><strong>例句</strong><ol>${examples.map(example => `<li>${clean(example && example.en) ? `<span>${escapeHtml(example.en)}</span>` : ''}${clean(example && example.cn) ? `<span class="translation">${escapeHtml(example.cn)}</span>` : ''}</li>`).join('')}</ol></div>` : '';
    return `<section class="study-card">
      <div class="word-heading"><h2>${index + 1}. ${escapeHtml(word.word)}</h2><span class="checkbox">□ 已掌握</span></div>
      ${detail ? `<p class="pronunciation">${detail}</p>` : ''}
      ${definitionBlock}${formsBlock}${exampleBlock}
      <div class="notes"><strong>复习笔记</strong><div class="note-line"></div><div class="note-line"></div><div class="note-line"></div><div class="note-line"></div></div>
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
    escapeHtml, escapeMarkdown, renderStudyCardHtml, renderHtml, renderMarkdown, downloadBlob
  };
});
