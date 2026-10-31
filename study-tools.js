(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const text = value => typeof value === 'string' ? value.trim() : '';
  const wordKey = value => text(value).replace(/\s+/g, ' ').toLowerCase();
  const example = value => ({ en: text(value && value.en), cn: text(value && value.cn) });

  function pairKey(left, right) {
    const words = [wordKey(left), wordKey(right)];
    if (!words[0] || !words[1] || words[0] === words[1]) throw new Error('请输入两个不同的单词');
    return JSON.stringify(words.sort());
  }

  function normalizeMnemonic(value, word) {
    if (!value || typeof value !== 'object' || !wordKey(word)) return null;
    if (value.word && wordKey(value.word) !== wordKey(word)) return null;
    const result = {
      word: text(word), breakdown: text(value.breakdown), association: text(value.association),
      tip: text(value.tip), ...(value.example ? { example: example(value.example) } : {})
    };
    if (!result.association || !result.tip) return null;
    return result;
  }

  function normalizeStudy(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.kind === 'mnemonic') {
      const mnemonic = normalizeMnemonic(value.mnemonic, value.word);
      return mnemonic ? { kind: 'mnemonic', word: text(value.word), mnemonic } : null;
    }
    if (value.kind !== 'comparison') return null;
    try { pairKey(value.left, value.right); } catch { return null; }
    if (!text(value.summary) || !text(value.tip) || !Array.isArray(value.items) || value.items.length !== 2) return null;
    const items = value.items.map((item, index) => {
      if (!item || wordKey(item.word) !== wordKey(index ? value.right : value.left)) return null;
      const result = { word: text(item.word), meaning: text(item.meaning), usage: text(item.usage),
        collocations: (Array.isArray(item.collocations) ? item.collocations : []).map(text).filter(Boolean), example: example(item.example) };
      return result.meaning && result.usage && result.example.en && result.example.cn ? result : null;
    });
    if (items.some(item => !item)) return null;
    return { kind: 'comparison', left: text(value.left), right: text(value.right), summary: text(value.summary), tip: text(value.tip), items };
  }

  function mergeMnemonic(favorites, word, value, dictionary) {
    const mnemonic = normalizeMnemonic(value, word);
    if (!mnemonic) throw new Error('记忆方法与单词不匹配，请重新生成');
    const index = favorites.findIndex(item => wordKey(item.word) === wordKey(word));
    if (index >= 0) return favorites.map((item, i) => i === index ? { ...item, mnemonic: { ...mnemonic, word: item.word } } : item);
    if (!dictionary || !text(dictionary.word)) throw new Error('请等待查词成功后再收藏');
    if (wordKey(dictionary.word) !== wordKey(word)) throw new Error('查词返回的单词不一致，请重试');
    if (!Array.isArray(dictionary.definitions) || !dictionary.definitions.some(text)) throw new Error('查词未返回释义，请重试');
    const { sentences, fromCache, vfavId, ...data } = dictionary;
    return [{ ...data, word: text(word), mnemonic,
      examples: dictionary.examples || sentences || [],
      meaning: dictionary.meaning || dictionary.definitions.join('；'),
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      createdAt: new Date().toLocaleString('zh-CN', { hour12: false }) }, ...favorites];
  }

  function normalizeComparisons(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).flatMap(value => {
      const result = normalizeStudy(value);
      if (!result || result.kind !== 'comparison') return [];
      const key = pairKey(result.left, result.right);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...result, id: text(value.id) || key, pinned: value.pinned === true, createdAt: text(value.createdAt) }];
    });
  }

  return { wordKey, pairKey, normalizeMnemonic, normalizeStudy, mergeMnemonic, normalizeComparisons };
});
