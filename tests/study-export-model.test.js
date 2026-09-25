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

test('normalizes structured forms into readable inflection and derivative text', () => {
  const result = StudyExport.normalizeFavorites([{
    word: 'aspire',
    forms: {
      inflections: [
        { type: '过去式', word: 'aspired' },
        { type: '现在分词', word: 'aspiring' }
      ],
      derivatives: [
        { pos: 'n.', word: 'aspiration', meaning: '抱负；渴望' }
      ]
    }
  }]);

  assert.equal(result[0].forms,
    '词形变化：过去式 aspired；现在分词 aspiring；同根派生：n. aspiration 抱负；渴望');
});

test('builds a deterministic timestamped filename', () => {
  const date = new Date(2026, 8, 25, 14, 3, 9);
  assert.equal(StudyExport.createFilename('pdf', date), 'cet6-vocabulary-20260925-140309.pdf');
});
