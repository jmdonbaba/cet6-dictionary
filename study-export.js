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

  return { MAX_EXAMPLES, normalizeFavorites, createFilename };
});
