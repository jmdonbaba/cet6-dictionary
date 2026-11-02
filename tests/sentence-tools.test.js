const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Tools = require('../study-tools.js');
const sentence = { kind: 'sentence', sentence: 'Had I known, I would have helped.', question: '', translation: '我要是早知道，就会帮忙了。', structure: '省略 if 的虚拟条件句，had 提前形成倒装。', grammar: [{ point: '虚拟条件句', explanation: '过去完成时表示与过去事实相反的假设。' }] };

test('all word tools share NFKC, whitespace and lowercase normalization without lemmatization', () => {
  assert.equal(Tools.normalizeWord('  ＣＯＭＢＡＴＳ　 '), 'combats');
  assert.equal(Tools.normalizeWord('  TAKE\n  Part  '), 'take part');
  assert.equal(Tools.wordKey('ＥＦＦＥＣＴ'), Tools.normalizeWord('ＥＦＦＥＣＴ'));
  assert.equal(Tools.pairKey('ＡＦＦＥＣＴ', ' EFFECT '), Tools.pairKey('affect', 'effect'));
  const source = fs.readFileSync('index.html', 'utf8');
  assert.match(source, /async function searchWord\(word, wrapper, mode\) \{\s*word = StudyTools\.normalizeWord\(word\);/);
});

test('sentence results preserve original English case and punctuation and require usable explanations', () => {
  assert.deepEqual(Tools.normalizeStudy(sentence), sentence);
  for (const field of ['translation', 'structure', 'sentence']) assert.equal(Tools.normalizeStudy({ ...sentence, [field]: '' }), null);
  assert.equal(Tools.normalizeStudy({ ...sentence, grammar: [] }), null);
  assert.equal(Tools.normalizeStudy({ ...sentence, grammar: [{ point: 'missing explanation' }] }), null);
  assert.equal(Tools.normalizeStudy({ ...sentence, question: '为什么倒装？' }), null);
  const result = Tools.normalizeStudy({ ...sentence, question: '为什么倒装？', answer: '省略 if 后，将 had 放到主语之前。', apiKey: 'secret' });
  assert.equal(result.answer, '省略 if 后，将 had 放到主语之前。');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  assert.equal(Tools.normalizeStudy({ ...sentence, answer: 'unsolicited answer' }).answer, undefined);
});

test('sentence favorites deduplicate the sentence and question together and retain pin metadata', () => {
  const question = { ...sentence, question: '为什么倒装？', answer: '省略 if。' };
  const result = Tools.normalizeSentences([{ ...sentence, id: 'first', pinned: true, createdAt: 'today' }, { ...sentence, sentence: ` ${sentence.sentence} `, id: 'duplicate' }, question]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'first');
  assert.equal(result[0].pinned, true);
  assert.equal(result[1].question, question.question);
  assert.notEqual(Tools.sentenceKey('I like it.', ''), Tools.sentenceKey('i like it.', ''));
});

test('imported sentence IDs remain unique and pinned entries stay first', () => {
  const result=Tools.normalizeSentences([{...sentence,id:'same'}, {...sentence,sentence:'Another sentence.',id:'same',pinned:true}]);
  assert.equal(new Set(result.map(item=>item.id)).size,2,'deleting one imported entry must never target another');
  assert.equal(result[0].sentence,'Another sentence.');
});

test('sentence snapshots and failed drafts retain questions without persisting response markup or secrets', () => {
  const source = fs.readFileSync('index.html', 'utf8');
  const fn = source.match(/function normalizeWordSearchCard\([^)]*\) \{[\s\S]*?\n\}/)[0];
  const normalize = new Function('StudyTools', `${fn}; return normalizeWordSearchCard;`)(Tools);
  const study = { ...sentence, question: '为什么倒装？', answer: '省略 if。' };
  const result = normalize({ input: study.sentence, study, apiKey: 'secret', html: '<script>bad</script>' });
  assert.deepEqual(result.study, study);
  const draft = normalize({ input: sentence.sentence, studyDraft: { kind: 'sentence', words: [sentence.sentence, '为什么倒装？'], apiKey: 'secret' } });
  assert.deepEqual(draft.studyDraft, { kind: 'sentence', words: [sentence.sentence, '为什么倒装？'] });
  assert.doesNotMatch(JSON.stringify([result, draft]), /secret|script/);
  assert.equal(Tools.normalizeDraft({ kind: 'sentence', words: ['', 'question'] }), null);
  assert.equal(Tools.normalizeDraft({ kind: 'sentence', words: ['valid', 'q'.repeat(2001)] }), null);
});
