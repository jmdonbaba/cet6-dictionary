(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const text = value => typeof value === 'string' ? value.trim() : '';
  const normalizeWord = value => text(value).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
  const wordKey = normalizeWord;
  const sentenceKey = (sentence, question = '') => JSON.stringify([text(sentence).replace(/\s+/g, ' '), text(question).replace(/\s+/g, ' ')]);
  const example = value => ({ en: text(value && value.en), cn: text(value && value.cn) });

  function pairKey(left, right) {
    const words = [wordKey(left), wordKey(right)];
    if (!words[0] || !words[1] || words[0] === words[1]) throw new Error('请输入两个不同的单词');
    return JSON.stringify(words.sort());
  }

  function normalizeMnemonicPart(value) {
    const part = text(value && value.part);
    const source = text(value && value.source);
    return part && source ? { part, source } : null;
  }

  function normalizeMnemonicParts(value) {
    return (Array.isArray(value) ? value : []).map(normalizeMnemonicPart).filter(Boolean);
  }

  function normalizeMnemonic(value, word) {
    if (!value || typeof value !== 'object' || !wordKey(word)) return null;
    if (value.word && wordKey(value.word) !== wordKey(word)) return null;
    const breakdown = text(value.breakdown);
    const association = text(value.association);
    const tip = text(value.tip);
    const parts = normalizeMnemonicParts(value.parts);
    // The card only carries the formula and where its chunks come from. Legacy
    // favorites may still store association/tip so older cards stay readable.
    const result = {
      word: text(word),
      ...(breakdown ? { breakdown } : {}),
      // A chunk source only makes sense together with the chunks it explains.
      ...(breakdown && parts.length ? { parts } : {}),
      ...(association ? { association } : {}),
      ...(tip ? { tip } : {}),
      ...(value.example ? { example: example(value.example) } : {})
    };
    if (!breakdown && !association && !tip) return null;
    return result;
  }

  function normalizeStudy(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.kind === 'sentence') {
      const sentence = text(value.sentence), question = text(value.question);
      const translation = text(value.translation), structure = text(value.structure), answer = text(value.answer);
      if (!sentence || sentence.length > 5000 || question.length > 2000 || !translation || !structure || (question && !answer)) return null;
      const grammar = (Array.isArray(value.grammar) ? value.grammar : []).map(item => ({ point: text(item && item.point), explanation: text(item && item.explanation) })).filter(item => item.point && item.explanation);
      if (!grammar.length) return null;
      return { kind: 'sentence', sentence, question, translation, structure, grammar, ...(question ? { answer } : {}) };
    }
    if (value.kind === 'mnemonic') {
      const mnemonic = normalizeMnemonic(value.mnemonic, value.word);
      return mnemonic ? { kind: 'mnemonic', word: text(value.word), mnemonic } : null;
    }
    if (value.kind !== 'comparison') return null;
    try { pairKey(value.left, value.right); } catch { return null; }
    if (!text(value.summary) || !Array.isArray(value.items) || value.items.length !== 2) return null;
    const items = value.items.map((item, index) => {
      if (!item || wordKey(item.word) !== wordKey(index ? value.right : value.left)) return null;
      const result = { word: text(item.word), meaning: text(item.meaning), usage: text(item.usage),
        collocations: (Array.isArray(item.collocations) ? item.collocations : []).map(text).filter(Boolean), example: example(item.example) };
      return result.meaning && result.usage && result.example.en && result.example.cn ? result : null;
    });
    if (items.some(item => !item)) return null;
    return { kind: 'comparison', left: text(value.left), right: text(value.right), summary: text(value.summary), ...(text(value.tip) ? { tip: text(value.tip) } : {}), items };
  }

  function sameStudy(left, right) {
    const canonical = value => {
      const study = normalizeStudy(value);
      if (!study) return null;
      if (study.kind === 'mnemonic') {
        study.word = wordKey(study.word);
        study.mnemonic.word = study.word;
        // Legacy examples are retained in backups but are not part of the memory face.
        delete study.mnemonic.example;
      } else if (study.kind === 'comparison') {
        // Older backups may retain a takeaway that is no longer displayed.
        delete study.tip;
        study.left = wordKey(study.left); study.right = wordKey(study.right);
        study.items = study.items.map(item => ({ ...item, word: wordKey(item.word) }));
        if (study.left > study.right) {
          [study.left, study.right] = [study.right, study.left];
          study.items.reverse();
        }
      } else {
        study.sentence = study.sentence.replace(/\s+/g, ' ');
        study.question = study.question.replace(/\s+/g, ' ');
      }
      return study;
    };
    const a = canonical(left), b = canonical(right);
    return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
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
    const seen = new Set(), ids = new Set();
    return (Array.isArray(values) ? values : []).flatMap(value => {
      const result = normalizeStudy(value);
      if (!result || result.kind !== 'comparison') return [];
      const key = pairKey(result.left, result.right);
      if (seen.has(key)) return [];
      seen.add(key);
      let id = text(value.id) || key;
      if (ids.has(id)) { id = key; let suffix = 1; while (ids.has(id)) id = key + '#' + suffix++; }
      ids.add(id);
      return [{ ...result, id, pinned: value.pinned === true, createdAt: text(value.createdAt) }];
    });
  }

  function normalizeSentences(values) {
    const seen = new Set(), ids = new Set();
    return (Array.isArray(values) ? values : []).flatMap(value => {
      const result = normalizeStudy(value);
      if (!result || result.kind !== 'sentence') return [];
      const key = sentenceKey(result.sentence, result.question);
      if (seen.has(key)) return [];
      seen.add(key);
      let id=text(value.id)||key;
      if(ids.has(id)){id=key;let suffix=1;while(ids.has(id))id=key+'#'+suffix++;}
      ids.add(id);
      return [{ ...result, id, pinned: value.pinned === true, createdAt: text(value.createdAt) }];
    }).sort((a,b)=>Number(b.pinned)-Number(a.pinned));
  }

  function normalizeDraft(value) {
    if (!value || !['mnemonic', 'comparison', 'sentence'].includes(value.kind) || !Array.isArray(value.words) || value.words.some(word => typeof word !== 'string')) return null;
    const words = value.words.map(word => value.kind === 'sentence' ? text(word) : normalizeWord(word));
    if (value.kind === 'sentence') {
      if (words.length !== 2 || !words[0] || words[0].length > 5000 || words[1].length > 2000) return null;
    } else if (words.length !== (value.kind === 'mnemonic' ? 1 : 2) || words.some(word => !word || word.length > 100)) return null;
    return { kind: value.kind, words };
  }

  return { normalizeWord, wordKey, pairKey, sentenceKey, normalizeMnemonic, normalizeMnemonicParts, normalizeStudy, sameStudy, mergeMnemonic, normalizeComparisons, normalizeSentences, normalizeDraft };
});
