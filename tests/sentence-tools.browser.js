const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].slice(1) || 'index.html';
    if (!/^[\w.-]+\.(html|js|css)$/.test(name) || !fs.existsSync(path.join(__dirname, '..', name))) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, '..', name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const requests = [], errors = [];
  let fail = false, incomplete = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('https://api.deepseek.com/**', async route => {
    const body = route.request().postDataJSON();
    const dictionary = body.messages[0].content.includes('词典专家');
    const input = dictionary ? body.messages[1].content.match(/查询"([^"]+)"/)[1] : JSON.parse(body.messages[1].content);
    requests.push({ input, system: body.messages[0].content });
    if (fail) { await route.fulfill({ status: 503, body: '{}' }); return; }
    let data;
    if (dictionary) data = { word: input, phonetic: '英 /ˈkɒmbæt/　美 /ˈkɑːmbæt/', definitions: ['战斗'], pos: 'n.', forms: { inflections: [], derivatives: [] }, sourceForm: '', inflection: '', sentences: [] };
    else if (input.sentence) data = { translation: '我要是早知道，就会帮忙了。', structure: '条件从句倒装，主句为虚拟语气。', grammar: [{ point: '省略 if 的倒装', explanation: 'Had 置于主语之前，表示与过去事实相反的假设。' }], ...(input.question && !incomplete ? { answer: '省略 if 后，将 had 放到主语之前。' } : {}) };
    else if (input.words.length === 1) data = { word: input.words[0], breakdown: 'combat（战斗） + s（复数） → 多场战斗' };
    else data = { summary: '影响与结果', tip: '动词和名词', items: input.words.map(word => ({ word, meaning: '释义', usage: '使用说明', collocations: [], example: { en: 'An example.', cn: '一个例子。' } })) };
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(data) } }] } });
  });
  const sentences = () => page.evaluate(() => StudyToolsUI.getSentences());
  const firstCard = () => page.locator('.word-search-wrapper').filter({ has: page.locator('[data-study-action="save-sentence"]') }).first();
  const sentence = 'Had I known, I would have helped.';
  async function generate(question = '') {
    await page.locator('#sentenceInput').fill(sentence);
    await page.locator('#sentenceQuestion').fill(question);
    await page.locator('#sentenceForm button').click();
    await page.waitForFunction(() => !document.querySelector('#sentenceForm button').disabled);
  }
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => { localStorage.setItem('cet6_api_key', 'sk-test'); initKey(); });
    await generate();
    assert.deepEqual(requests.at(-1).input, { sentence, question: '' });
    assert.match(requests.at(-1).system, /例句讲解/);
    assert.equal(await firstCard().locator('.study-result-title').textContent(), sentence);
    assert.equal(await firstCard().locator('.sentence-content .study-takeaway').count(), 0);
    assert.equal((await sentences()).length, 0, 'AI results are not saved automatically');
    await firstCard().locator('[data-study-action="save-sentence"]').click();
    assert.equal((await sentences()).length, 1);
    await generate();
    assert.equal(await firstCard().locator('[data-study-action="save-sentence"]').textContent(), '取消收藏');
    await firstCard().locator('[data-study-action="save-sentence"]').click();
    assert.equal((await sentences()).length, 0);
    await firstCard().locator('[data-study-action="save-sentence"]').click();
    assert.equal((await sentences()).length, 1);
    await generate('这里为什么倒装？');
    assert.match(await firstCard().textContent(), /你的疑问：这里为什么倒装？/);
    assert.match(await firstCard().textContent(), /省略 if 后/);
    await firstCard().locator('[data-study-action="save-sentence"]').click();
    assert.equal((await sentences()).length, 2, 'different questions retain separate explanations');
    assert.equal(await page.locator('#vocabFavCount').textContent(), '(2)');
    if (process.env.SENTENCE_SCREENSHOT) await page.screenshot({ path: process.env.SENTENCE_SCREENSHOT, fullPage: false });
    console.log('PASS: optional question, structured explanation, explicit save/cancel and sentence/question deduplication');

    fail = true;
    await generate('这次需要失败后重试');
    await page.locator('[data-study-action="retry"]').waitFor();
    await page.reload();
    await page.locator('[data-study-action="retry"]').waitFor();
    assert.match(await page.locator('.study-draft-question').textContent(), /失败后重试/);
    fail = false;
    await page.locator('[data-study-action="retry"]').click();
    await page.waitForFunction(() => !document.querySelector('#sentenceForm button').disabled);
    assert.equal(requests.at(-1).input.question, '这次需要失败后重试');
    const before = await page.locator('.word-search-wrapper').count();
    await firstCard().locator('[data-study-action="regenerate"]').click();
    await page.waitForFunction(() => !document.querySelector('#sentenceForm button').disabled);
    assert.equal(await page.locator('.word-search-wrapper').count(), before, 'regeneration reuses the card');
    incomplete = true;
    await generate('必须直接回答这个问题');
    assert.match(await page.locator('[data-study-action="retry"]').locator('..').textContent(), /返回内容不完整/);
    incomplete = false;
    await page.locator('[data-study-action="retry"]').click();
    await page.waitForFunction(() => !document.querySelector('#sentenceForm button').disabled);
    const snapshot = await page.evaluate(() => captureWordSearchCards());
    assert.equal(await page.evaluate(() => savePageRecord()), true);
    await page.evaluate(() => applyWordSearchCards([{ input: '', mode: 'lemma', result: null }]));
    await page.evaluate(cards => applyWordSearchCards(cards), snapshot);
    assert.equal(await page.locator('[data-study-action="save-sentence"]').count(), 5);
    await page.reload();
    assert.equal(await page.locator('[data-study-action="save-sentence"]').count(), 5);
    console.log('PASS: failure, refresh-safe retry, incomplete response rejection, regeneration, saved-page and session restore');

    await page.locator('#btnOpenVocabFav').click();
    await page.locator('#sentenceFavoritesTab').click();
    assert.equal(await page.locator('#sentenceFavList details').count(), 2);
    await page.locator('#sentenceSearch').fill('倒装');
    assert.equal(await page.locator('#sentenceFavList details').count(), 2);
    await page.locator('#sentenceSearch').fill('no match');
    assert.equal(await page.locator('#sentenceFavList details').count(), 0);
    await page.locator('#sentenceSearch').fill('');
    await page.locator('#sentenceFavList summary').first().click();
    await page.locator('[data-sentence-action="pin"]').first().click();
    assert.equal((await sentences())[0].pinned, true);
    await page.locator('[data-sentence-action="open"]').first().click();
    assert.equal(await page.locator('.word-search-wrapper').count(), before + 1);
    for (const format of ['html', 'md']) {
      const downloaded = page.waitForEvent('download');
      await page.evaluate(format => StudyToolsUI.exportSentences(format), format);
      const download = await downloaded;
      const contents = fs.readFileSync(await download.path(), 'utf8');
      assert.match(contents, /例句讲解复习讲义/);
      assert.match(contents, /Had I known/);
      assert.match(contents, /省略 if 后/);
    }
    const downloadEvent = page.waitForEvent('download');
    await page.evaluate(() => exportData());
    const download = await downloadEvent;
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(backup.sentences.length, 2);
    assert.ok(backup.pageRecords[0].cards.some(card => card.study?.kind === 'sentence'));
    await page.evaluate(() => applyImport('overwrite', { favorites: [] }));
    assert.equal((await sentences()).length, 2, 'old backups preserve new collection');
    await page.evaluate(() => localStorage.removeItem('cet6_sentence_favorites'));
    await page.evaluate(data => applyImport('merge', data), backup);
    await page.evaluate(data => applyImport('merge', data), backup);
    assert.equal((await sentences()).length, 2);
    const saved = JSON.stringify(await sentences());
    await page.evaluate(() => applyImport('overwrite', { favorites: [], sentences: [{ kind: 'sentence', sentence: 'bad' }] }));
    assert.equal(JSON.stringify(await sentences()), saved, 'malformed import preserves stored explanations');
    await page.evaluate(async backup => {
      const native = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key === 'cet6_sentence_favorites') throw new Error('quota'); return native.call(this, key, value); };
      try { await applyImport('overwrite', { ...backup, favorites: [{ word: 'should roll back' }] }); } finally { Storage.prototype.setItem = native; }
    }, backup);
    assert.equal(await page.evaluate(() => getVFavs().length), 0, 'failed sentence import rolls back word writes');
    assert.equal(JSON.stringify(await sentences()), saved);
    await page.locator('#btnOpenVocabFav').click();
    await page.evaluate(() => StudyToolsUI.selectFavoriteTab('sentences'));
    if (!await page.locator('#sentenceFavList details').first().evaluate(el => el.open)) await page.locator('#sentenceFavList summary').first().click();
    await page.locator('[data-sentence-action="delete"]').first().click();
    assert.equal((await sentences()).length, 1);
    await page.locator('[data-close="modalVocabFav"]').click();
    console.log('PASS: favorite search/open/pin/delete, HTML/Markdown exports, full backup round trip, old backups and failed-import rollback');

    await page.setViewportSize({ width: 390, height: 850 });
    await page.locator('#sentenceToolTab').click();
    await page.waitForFunction(() => document.querySelector('#mobileToolTabs').dataset.active === 'sentence');
    assert.equal(await page.locator('#sentenceForm').evaluate(el => el.inert), false);
    assert.equal(await page.locator('#mnemonicForm').evaluate(el => el.inert), true);
    await page.locator('#sentenceToolTab').focus();
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#mobileToolTabs').getAttribute('data-active'), 'mnemonic');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#mobileToolTabs').getAttribute('data-active'), 'sentence');
    await page.locator('#studyToolPages').evaluate(el => el.scrollTo({ left: el.clientWidth, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('#mobileToolTabs').dataset.active === 'comparison');
    await page.locator('#btnOpenVocabFav').click();
    await page.locator('#sentenceFavoritesTab').focus();
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#wordFavoritesTab').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#sentenceFavoritesTab').getAttribute('aria-selected'), 'true');
    const first = await page.locator('#wordFavoritesTab').boundingBox(), last = await page.locator('#sentenceFavoritesTab').boundingBox();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2, { steps: 12 });
    await page.mouse.up();
    assert.equal(await page.locator('#wordFavoritesTab').getAttribute('aria-selected'), 'true', 'third capsule supports dragging');
    await page.locator('[data-close="modalVocabFav"]').click();
    for (const width of [1920, 1440, 1240, 1024, 768, 601, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, overflow: Array.from(document.querySelectorAll('body *')).filter(el => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed'; }).slice(0, 12).map(el => ({ name: el.id || el.className, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })) }));
      assert.equal(bounds.scroll <= width, true, `no overflow at ${width}: ${JSON.stringify(bounds)}`);
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('#mnemonicInput').fill('  ＣＯＭＢＡＴＳ  ');
    await page.locator('#mnemonicForm button').click();
    await page.waitForFunction(() => !document.querySelector('#mnemonicForm button').disabled);
    assert.deepEqual(requests.at(-1).input.words, ['combats']);
    await page.locator('#compareLeft').fill('  ＡＦＦＥＣＴ ');
    await page.locator('#compareRight').fill(' EFFECT  ');
    await page.locator('#comparisonForm button').click();
    await page.waitForFunction(() => !document.querySelector('#comparisonForm button').disabled);
    assert.deepEqual(requests.at(-1).input.words, ['affect', 'effect']);
    await page.evaluate(async () => { const wrapper = createWordSearchModule(); $wsModules.appendChild(wrapper); await searchWord('  ＣＯＭＢＡＴＳ  ', wrapper, 'original'); });
    assert.equal(requests.at(-1).input, 'combats');
    assert.deepEqual(errors, []);
    console.log('PASS: three mobile tabs, swipe position, keyboard, inert controls, capsule dragging, responsive widths and shared word normalization');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
