const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const Tools = require('../study-tools');
const Export = require('../study-export');

const mnemonic = { word: 'affect', breakdown: 'aff + ect', association: '让情绪动起来', tip: 'affect 常作动词', example: { en: 'Stress can affect memory.', cn: '压力会影响记忆。' } };
const comparison = { kind: 'comparison', left: 'affect', right: 'effect', summary: '影响与结果', tip: '动作与结果', items: [
  { word: 'affect', meaning: '影响', usage: '常作动词', collocations: ['affect memory'], example: mnemonic.example },
  { word: 'effect', meaning: '结果', usage: '常作名词', collocations: ['have an effect on'], example: { en: 'The effect is lasting.', cn: '影响是持久的。' } }
] };

test('manual mnemonic merging preserves favorite order, details and pin state without mutating input', () => {
  const favorites = [{ id: 'old', word: 'affect', definitions: ['影响'], examples: ['existing'], pinned: true }, { word: 'other' }];
  const before = JSON.stringify(favorites);
  const merged = Tools.mergeMnemonic(favorites, 'AFFECT', mnemonic);
  assert.equal(JSON.stringify(favorites), before);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], { ...favorites[0], mnemonic });
  assert.strictEqual(merged[1], favorites[1]);
});

test('new mnemonic favorites require successful dictionary data and bind to the requested word', () => {
  assert.throws(() => Tools.mergeMnemonic([], 'affect', mnemonic), /查词/);
  assert.throws(() => Tools.mergeMnemonic([], 'affect', mnemonic, { word: 'effect' }), /单词/);
  const merged = Tools.mergeMnemonic([], 'affect', mnemonic, { word: 'affect', definitions: ['影响'], sentences: [mnemonic.example] });
  assert.equal(merged[0].mnemonic.word, 'affect');
  assert.deepEqual(merged[0].examples, [mnemonic.example]);
});

test('comparison identity ignores case, outside spacing and word order, without ambiguous separators', () => {
  assert.equal(Tools.pairKey(' Affect ', 'effect'), Tools.pairKey('EFFECT', 'affect'));
  assert.notEqual(Tools.pairKey('a-b', 'c'), Tools.pairKey('a', 'b-c'));
  assert.throws(() => Tools.pairKey('affect', 'AFFECT'), /不同/);
});

test('mnemonics no longer require an example, while old examples remain readable for backups', () => {
  const value = { word: 'affect', association: '影响这个动作', tip: '动作记 affect' };
  assert.ok(Tools.normalizeMnemonic(value, 'affect'));
  assert.deepEqual(Tools.normalizeMnemonic(mnemonic, 'affect'), mnemonic);
});

test('study responses reject empty or mismatched output and strip unknown fields', () => {
  assert.equal(Tools.normalizeStudy({ kind: 'mnemonic', word: 'affect', mnemonic: { word: 'effect' } }), null);
  assert.equal(Tools.normalizeStudy({ ...comparison, items: [] }), null);
  assert.equal(Tools.normalizeStudy({ ...comparison, left: 'effect' }), null);
  const clean = Tools.normalizeStudy({ kind: 'mnemonic', word: 'affect', mnemonic: { ...mnemonic, apiKey: 'secret' }, html: '<script>' });
  assert.deepEqual(clean.mnemonic, mnemonic);
  assert.doesNotMatch(JSON.stringify(clean), /secret|script/);
  assert.deepEqual(Tools.normalizeStudy(comparison), comparison);
});

test('comparison favorites deduplicate reversed pairs and keep saved metadata', () => {
  const entries = [{ ...comparison, id: 'first', pinned: true, createdAt: 'today' }, { ...comparison, left: 'effect', right: 'affect', items: [...comparison.items].reverse(), id: 'duplicate' }];
  const normalized = Tools.normalizeComparisons(entries);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, 'first');
  assert.equal(normalized[0].pinned, true);
});

test('mnemonics survive study exports and stay escaped in both formats', () => {
  const words = Export.normalizeFavorites([{ word: 'affect', mnemonic: { ...mnemonic, association: '<img onerror="bad"> & **联想**' } }]);
  assert.deepEqual(words[0].mnemonic, { ...mnemonic, association: '<img onerror="bad"> & **联想**' });
  const html = Export.renderHtml(words);
  const md = Export.renderMarkdown(words);
  assert.match(html, /怎么记/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(md, /怎么记/);
  assert.match(md, /\\\*\\\*联想/);
});

test('page snapshots preserve mnemonic and comparison cards with no secrets', () => {
  const source = fs.readFileSync('index.html', 'utf8');
  const fn = source.match(/function normalizeWordSearchCard\([^)]*\) \{[\s\S]*?\n\}/)[0];
  const normalize = new Function('StudyTools', `${fn}; return normalizeWordSearchCard;`)(Tools);
  const studyCard = normalize({ input: 'affect 和 effect', study: comparison, apiKey: 'secret' });
  assert.deepEqual(studyCard.study, comparison);
  const word = normalize({ input: 'affect', result: { word: 'affect', mnemonic } });
  assert.deepEqual(word.result.mnemonic, mnemonic);
  assert.doesNotMatch(JSON.stringify(studyCard), /secret/);
  const flipped = normalize({ input: 'affect', study: { kind: 'mnemonic', word: 'affect', mnemonic }, studyFace: 'definition', result: { word: 'affect' } });
  assert.equal(flipped.studyFace, 'definition');
});
