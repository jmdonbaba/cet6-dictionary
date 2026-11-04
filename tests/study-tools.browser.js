const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const mnemonic = word => ({ word, breakdown: 'af + fect', parts: [{ part: 'af', source: '词根：朝向' }, { part: 'fect', source: '联想到 effect（结果），纯记忆联想' }] });
const phraseMnemonic = {
  word: 'resolve to',
  breakdown: 'resolve（下定决心） + to（引出要做的事） → 下定决心去做 → 决心、决定（做某事）',
  parts: [{ part: 'resolve', source: '动词：在这个搭配中表示下定决心' }, { part: 'to', source: '不定式标记：后接动词原形，引出决心要做的事' }]
};
const dict = word => ({ word, phonetic: '英 /əˈfekt/　美 /əˈfekt/', pos: 'v.', definitions: ['影响'], forms: { inflections: [], derivatives: [] }, sentences: [{ en: 'Stress can affect memory.', cn: '压力会影响记忆。' }] });

(async () => {
  const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].slice(1) || 'index.html';
    if (!['index.html', 'study-tools.js', 'study-tools-ui.js', 'study-tools.css', 'study-export.js', 'saved-page-store.js'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, '..', name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  let dictionaryFail = false;
  let dictionaryRequests = 0;
  let mnemonicFail = false;
  const mnemonicRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.deepseek.com/**', async route => {
    const body = route.request().postDataJSON();
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    let data;
    if (system.includes('记忆方法')) {
      const word = JSON.parse(user).words[0];
      if (word === 'resolve to') {
        assert.match(system, /完整单词/);
        assert.doesNotMatch(system, /plaus|advisable/);
        await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(phraseMnemonic) } }] } });
        return;
      }
      assert.match(system, /词块（中文含义）/);
      assert.match(system, /advise（建议） \+ able（能…的）/);
      assert.match(system, /parts 与 breakdown 的词块一一对应/);
      assert.match(system, /词根、前缀或后缀/);
      assert.match(system, /联想到某词/);
      assert.match(system, /不写额外的联想段落或记忆提示/);
      mnemonicRequests.push(JSON.parse(user).words[0]);
      if (mnemonicFail) { await route.fulfill({ status: 503, body: '{}' }); return; }
      data = mnemonic(JSON.parse(user).words[0]);
    }
    else if (system.includes('词语对比')) {
      const names = JSON.parse(user).words;
      data = { summary: 'affect 侧重影响的动作，effect 侧重结果。', tip: '动作看 affect，结果看 effect。', items: names.map(word => ({ word, meaning: word === 'affect' ? '影响' : '结果', usage: word === 'affect' ? '通常作动词' : '通常作名词', collocations: ['have an effect on'], example: { en: 'The effect is lasting.', cn: '影响是持久的。' } })) };
    } else {
      dictionaryRequests++;
      if (dictionaryFail) { await route.fulfill({ status: 503, body: '{}' }); return; }
      data = dict(user.match(/查询"([^"]+)"/)[1]);
    }
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(data) } }] } });
  });
  const favorites = () => page.evaluate(() => getVFavs());
  async function remember(word) {
    await page.locator('#mnemonicInput').fill(word);
    await page.locator('#mnemonicForm button').click();
    await page.locator('.study-card [data-study-action="save-mnemonic"]').last().waitFor();
  }
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => { localStorage.setItem('cet6_api_key', 'sk-test'); initKey(); });
    await remember('affect');
    assert.equal((await favorites()).length, 0, 'generating must not save');
    const memoryId = await page.locator('.study-card').first().getAttribute('id');
    const memoryCard = page.locator(`#${memoryId}`);
    assert.equal(await memoryCard.locator('[data-study-action="save-mnemonic"]').textContent(), '收藏');
    assert.match(await memoryCard.locator('.study-parts').textContent(), /词块来源：af ← 词根：朝向；fect ← 联想到 effect（结果），纯记忆联想/);
    assert.equal(await memoryCard.locator('.study-section-label, .study-takeaway').count(), 0, 'memory cards no longer repeat the formula as prose');
    assert.equal(await memoryCard.locator('.study-example, .study-footnote, .study-save-state').count(), 0);
    await memoryCard.locator('[data-study-action="flip"]').click();
    await memoryCard.locator('.word-header .word').waitFor();
    assert.equal((await favorites()).length, 0, 'flipping must not favorite the word');
    assert.equal(dictionaryRequests, 1);
    await page.reload();
    const restoredMemoryId = await page.locator('.word-search-wrapper').first().getAttribute('id');
    // Refresh restores the visible face without fetching or writing a favorite.
    const restoredMemory = page.locator(`#${restoredMemoryId}`);
    assert.equal(await restoredMemory.locator('.word-header .word').textContent(), 'affect');
    assert.equal((await favorites()).length, 0);
    await restoredMemory.locator('[data-study-action="flip"]').click();
    await restoredMemory.locator('.study-result-title').waitFor();
    await page.reload();
    assert.equal(await page.locator('.word-search-wrapper').first().locator('.study-result-title').textContent(), 'affect');
    assert.equal(dictionaryRequests, 1);
    const activeMemory = page.locator('.word-search-wrapper').first();
    // Exercise a real animation, including repeated pointer activation while it is turning.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await activeMemory.locator('[data-study-action="flip"]').click();
    await page.waitForFunction(() => document.querySelector('.word-search-wrapper')._flipping);
    await page.waitForFunction(() => !document.querySelector('.word-search-wrapper')._flipping);
    assert.equal(await activeMemory.locator('.word-header .word').textContent(), 'affect');
    const flipFrames = await page.evaluate(async () => {
      const card = document.querySelector('.word-search-wrapper');
      const frames = [];
      const start = performance.now();
      const sample = () => {
        const rect = card.getBoundingClientRect();
        const button = card.querySelector('[data-study-action^="save-"]');
        frames.push({ top: rect.top, height: rect.height, saveLabel: button ? button.textContent : null });
        if (performance.now() - start < 900) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      document.querySelector('.word-header [data-study-action="flip"]').click();
      await new Promise(resolve => setTimeout(resolve, 900));
      return frames;
    });
    await page.waitForFunction(() => !document.querySelector('.word-search-wrapper')._flipping);
    const flipHeights = flipFrames.map(frame => frame.height);
    const flipTops = flipFrames.map(frame => frame.top);
    const flipRange = Math.abs(flipHeights.at(-1) - flipHeights[0]);
    const maxFrameStep = Math.max(...flipHeights.slice(1).map((height, index) => Math.abs(height - flipHeights[index])));
    assert.ok(flipRange > 20, 'the two faces have different heights');
    assert.ok(maxFrameStep < Math.max(25, flipRange / 3), `card height glides instead of jumping: ${JSON.stringify(flipFrames)}`);
    assert.ok(Math.max(...flipTops) - Math.min(...flipTops) < 3, `the card top stays still while turning: ${JSON.stringify(flipTops)}`);
    assert.ok(flipFrames.every(frame => frame.saveLabel === '收藏' || frame.saveLabel === '取消收藏'), `the save button keeps its label while the card turns: ${JSON.stringify(flipFrames.map(frame => frame.saveLabel))}`);
    assert.equal(await activeMemory.locator('[data-study-action^="save-"]').textContent(), '收藏');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(dictionaryRequests, 1, 'flipping back reuses the dictionary data');
    const finalMemoryId = await activeMemory.getAttribute('id');
    await activeMemory.locator('[data-study-action="save-mnemonic"]').click();
    await page.waitForFunction(() => getVFavs().length === 1);
    assert.equal(dictionaryRequests, 1);
    assert.equal((await favorites())[0].mnemonic.word, 'affect');
    assert.equal(await page.evaluate(() => document.getElementById('toast').textContent), '单词与记法已一起收藏', 'the combined toast only fires while the word is still unfavorited');
    assert.deepEqual((await favorites())[0].mnemonic.parts, mnemonic('affect').parts);
    assert.equal((await favorites())[0].mnemonic.association, undefined, 'saved mnemonics no longer store repeated prose');
    assert.equal(await activeMemory.locator('.word-header .word').textContent(), 'affect');
    assert.equal(await page.locator('.word-search-wrapper').first().getAttribute('id'), finalMemoryId, 'word card stays in place ahead of blank draft');
    // The memory face only owns the mnemonic: cancelling there keeps the word saved.
    await activeMemory.locator('[data-study-action="flip"]').click();
    await activeMemory.locator('.study-result-title').waitFor();
    await page.waitForFunction(() => !document.querySelector('.word-search-wrapper')._flipping);
    await activeMemory.locator('[data-study-action="save-mnemonic"]').click();
    assert.equal((await favorites()).length, 1, 'cancelling on the memory face keeps the word favorite');
    assert.equal((await favorites())[0].mnemonic, undefined);
    assert.equal(await page.evaluate(() => document.getElementById('toast').textContent), '已取消记法收藏');
    assert.equal(await activeMemory.locator('[data-study-action="save-mnemonic"]').textContent(), '收藏');
    await activeMemory.locator('[data-study-action="save-mnemonic"]').click();
    await page.waitForFunction(() => Boolean(getVFavs()[0].mnemonic));
    assert.equal(await page.evaluate(() => document.getElementById('toast').textContent), '记法已补充到单词收藏', 're-adding a mnemonic supplements the kept word favorite');
    // The word face owns the whole favorite: cancelling there removes the word too.
    await activeMemory.locator('[data-study-action="flip"]').click();
    await activeMemory.locator('.word-header .word').waitFor();
    await page.waitForFunction(() => !document.querySelector('.word-search-wrapper')._flipping);
    assert.equal(await activeMemory.locator('[data-study-action="save-mnemonic"]').textContent(), '取消收藏');
    await activeMemory.locator('[data-study-action="save-mnemonic"]').click();
    assert.equal((await favorites()).length, 0, 'cancelling on the word face removes the whole favorite');
    assert.equal(await page.evaluate(() => document.getElementById('toast').textContent), '已取消收藏');
    assert.equal(await activeMemory.locator('[data-study-action="save-mnemonic"]').textContent(), '收藏');
    await activeMemory.locator('[data-study-action="save-mnemonic"]').click();
    await page.waitForFunction(() => getVFavs().length === 1);
    assert.equal(await page.evaluate(() => document.getElementById('toast').textContent), '单词与记法已一起收藏');
    console.log('PASS: generation is unsaved; first save queries and favorites a full word at the current position');

    await page.evaluate(() => {
      const favs = getVFavs(); delete favs[0].mnemonic; favs[0].pinned = true; setVFavs(favs); renderVFavs();
    });
    await remember('affect');
    assert.equal((await favorites())[0].mnemonic, undefined);
    await page.locator('.study-card [data-study-action="save-mnemonic"]').click();
    await page.waitForFunction(() => Boolean(getVFavs()[0].mnemonic));
    assert.equal(await page.evaluate(() => document.getElementById('toast').textContent), '记法已补充到单词收藏', 'an already favorited word only gets the mnemonic added');
    assert.equal(await page.locator('.study-card [data-study-action="save-mnemonic"]').textContent(), '取消收藏');
    assert.equal(dictionaryRequests, 1, 'existing favorite mnemonic update needs no dictionary request');
    assert.equal((await favorites()).length, 1);
    assert.equal((await favorites())[0].pinned, true);
    console.log('PASS: existing favorite is only updated by a manual click and retains metadata');

    dictionaryFail = true;
    await remember('resilient');
    await page.locator('.study-card [data-study-action="save-mnemonic"]').first().click();
    await page.locator('.study-error').waitFor();
    assert.equal((await favorites()).length, 1);
    assert.ok(await page.locator('.study-card').filter({ hasText: 'resilient' }).count());
    dictionaryFail = false;
    await page.locator('.study-card').filter({ hasText: 'resilient' }).locator('[data-study-action="save-mnemonic"]').click();
    await page.waitForFunction(() => getVFavs().length === 2);
    console.log('PASS: dictionary failure preserves the mnemonic with retry and no partial favorite');

    await page.locator('#compareLeft').fill('affect');
    await page.locator('#compareRight').fill('effect');
    await page.locator('#comparisonForm button').click();
    await page.locator('[data-study-action="save-comparison"]').waitFor();
    assert.equal(await page.evaluate(() => StudyToolsUI.getComparisons().length), 0);
    await page.locator('[data-study-action="save-comparison"]').click();
    assert.equal(await page.evaluate(() => StudyToolsUI.getComparisons().length), 1);
    await page.locator('#compareLeft').fill('effect');
    await page.locator('#compareRight').fill('affect');
    await page.locator('#comparisonForm button').click();
    await page.waitForFunction(() => !document.querySelector('#comparisonForm button').disabled);
    assert.equal(await page.locator('[data-study-action="save-comparison"]').first().textContent(), '取消收藏');
    await page.locator('[data-study-action="save-comparison"]').first().click();
    assert.equal(await page.evaluate(() => StudyToolsUI.getComparisons().length), 0);
    assert.equal(await page.locator('[data-study-action="save-comparison"]').last().textContent(), '收藏');
    await page.locator('[data-study-action="save-comparison"]').first().click();
    assert.equal(await page.evaluate(() => StudyToolsUI.getComparisons().length), 1);
    console.log('PASS: comparison is manually saved with reversed pair deduplication');

    await page.reload();
    assert.equal(await page.locator('.study-card .comparison-grid').count(), 2);
    assert.equal(await page.locator('.word-result .mnemonic-block').count(), 0);
    assert.equal(await page.locator('.word-result [data-study-action="flip"]').count(), 2);
    const saved = await page.evaluate(async () => { await savePageRecord(); return (await getPageRecords())[0]; });
    assert.equal(saved.cards.filter(card => card.study).length, 5);
    await page.evaluate(() => applyWordSearchCards([{ input: '', mode: 'lemma', result: null }]));
    await page.evaluate(cards => { applyWordSearchCards(cards); saveWordSearchSession(); }, saved.cards);
    assert.equal(await page.locator('.study-card .comparison-grid').count(), 2);
    assert.equal(await page.locator('[data-study-action="save-comparison"]').first().textContent(), '取消收藏');
    assert.equal(await page.locator('[data-study-action="save-comparison"]').first().isDisabled(), false);
    await page.evaluate(() => openModal($modalVocabFav));
    await page.locator('[data-favorite-tab="comparisons"]').click();
    assert.equal(await page.locator('#comparisonFavList details').count(), 1);
    await page.locator('#comparisonSearch').fill('missing');
    assert.equal(await page.locator('#comparisonFavList details').count(), 0);
    await page.locator('#comparisonSearch').fill('effect');
    assert.equal(await page.locator('#comparisonFavList details').count(), 1);
    await page.evaluate(() => closeModal());
    console.log('PASS: refresh, saved pages and comparison favorite search retain results');

    const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportData())]);
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(backup.comparisons.length, 1);
    assert.equal(backup.favorites.filter(item => item.mnemonic).length, 2);
    await page.evaluate(() => { localStorage.removeItem('cet6_comparison_favorites'); localStorage.removeItem(VFAV_KEY); });
    await page.evaluate(data => applyImport('merge', data), backup);
    assert.equal((await favorites()).length, 2);
    assert.equal(await page.evaluate(() => StudyToolsUI.getComparisons().length), 1);
    await page.evaluate(data => applyImport('merge', data), backup);
    assert.equal(await page.evaluate(() => StudyToolsUI.getComparisons().length), 1);
    const beforeMalformed = await page.evaluate(() => localStorage.getItem('cet6_comparison_favorites'));
    page.on('dialog', dialog => dialog.accept());
    await page.evaluate(() => applyImport('overwrite', { favorites: [], comparisons: [{ left: 'bad' }] }));
    assert.equal(await page.evaluate(() => localStorage.getItem('cet6_comparison_favorites')), beforeMalformed);
    assert.equal((await favorites()).length, 2);
    await page.evaluate(() => applyImport('overwrite', { favorites: [{ word: 'legacy' }] }));
    assert.equal(await page.evaluate(() => StudyToolsUI.getComparisons().length), 1, 'old backup must retain comparison favorites');
    await page.evaluate(data => applyImport('overwrite', data), backup);
    await page.evaluate(async data => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'cet6_comparison_favorites') throw new Error('test quota failure');
        return original.call(this, key, value);
      };
      try { await applyImport('overwrite', { ...data, favorites: [{ word: 'replacement' }] }); }
      finally { Storage.prototype.setItem = original; }
    }, backup);
    assert.equal((await favorites()).length, 2, 'failed comparison write rolls back the word favorites write');
    assert.equal(await page.evaluate(() => StudyToolsUI.getComparisons().length), 1);
    await page.evaluate(() => localStorage.setItem('cet6_comparison_favorites', JSON.stringify([{ kind: 'comparison', left: 'damaged' }])));
    const corruptLocal = await page.evaluate(() => localStorage.getItem('cet6_comparison_favorites'));
    await page.evaluate(data => applyImport('merge', data), backup);
    assert.equal(await page.evaluate(() => localStorage.getItem('cet6_comparison_favorites')), corruptLocal, 'merge refuses to silently discard corrupt local entries');
    await page.evaluate(data => applyImport('overwrite', data), backup);
    console.log('PASS: backups round-trip both favorites; malformed data and failed imports preserve saved data');

    await page.evaluate(() => openModal($modalVocabFav));
    await page.locator('[data-favorite-tab="words"]').click();
    const [wordExport] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportStudyDocument('html'))]);
    const wordHtml = fs.readFileSync(await wordExport.path(), 'utf8');
    assert.match(wordHtml, /怎么记/);
    assert.doesNotMatch(wordHtml, /sk-test/);
    await page.locator('[data-favorite-tab="comparisons"]').click();
    const [compareExport] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportStudyDocument('markdown'))]);
    assert.match(fs.readFileSync(await compareExport.path(), 'utf8'), /词语对比复习讲义/);
    await page.locator('#comparisonFavList summary').click();
    await page.locator('[data-comparison-action="pin"]').click();
    assert.equal(await page.evaluate(() => StudyToolsUI.getComparisons()[0].pinned), true);
    const cardCount = await page.locator('.word-search-wrapper').count();
    await page.locator('[data-comparison-action="open"]').click();
    assert.equal(await page.locator('.word-search-wrapper').count(), cardCount, 'open reuses an already displayed comparison');
    await page.locator('[data-comparison-action="delete"]').click();
    assert.equal(await page.evaluate(() => StudyToolsUI.getComparisons().length), 0);
    await page.evaluate(() => closeModal());
    await page.evaluate(data => applyImport('merge', data), backup);
    console.log('PASS: both study export formats, comparison pin/delete/open controls');

    await remember('retain');
    await page.evaluate(() => {
      window.testOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'cet6_vocab_favorites') throw new Error('test quota failure');
        return window.testOriginalSetItem.call(this, key, value);
      };
    });
    await page.locator('.study-card').filter({ hasText: 'retain' }).locator('[data-study-action="save-mnemonic"]').click();
    await page.locator('.study-card').filter({ hasText: 'retain' }).locator('.study-error').waitFor();
    assert.equal((await favorites()).length, 2);
    await page.evaluate(() => { Storage.prototype.setItem = window.testOriginalSetItem; delete window.testOriginalSetItem; });
    await page.locator('.study-card').filter({ hasText: 'retain' }).locator('[data-study-action="save-mnemonic"]').click();
    await page.waitForFunction(() => getVFavs().length === 3);
    await page.evaluate(() => { $apiKeyInput.value = 'sk-new-test'; saveKey(); });
    assert.ok(await page.locator('.study-card [data-study-action="save-comparison"]').count(), 'changing a key retains study results');
    console.log('PASS: favorite storage failure keeps retryable content; changing API Key retains study cards');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-tool-tab="comparison"]').click();
    await page.waitForFunction(() => document.querySelector('[data-tool-tab="comparison"]').getAttribute('aria-selected') === 'true');
    assert.ok(await page.locator('#compareLeft').isVisible());
    await page.locator('#studyToolPages').evaluate(el => el.scrollTo({ left: 0, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('[data-tool-tab="mnemonic"]').getAttribute('aria-selected') === 'true');
    await page.locator('[data-tool-tab="mnemonic"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-tool-tab="comparison"]').getAttribute('aria-selected'), 'true');
    await page.locator('[data-tool-tab="mnemonic"]').click();
    await page.locator('#studyToolPages').scrollIntoViewIfNeeded();
    const rect = await page.locator('#studyToolPages').boundingBox();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + rect.width - 12, y: rect.y + 12 }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x + rect.width - 12 - (rect.width - 30) * step / 8, y: rect.y + 12 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('[data-tool-tab="comparison"]').getAttribute('aria-selected') === 'true');
    await cdp.detach();
    console.log('PASS: mobile tool pages switch by tab, horizontal scrolling and keyboard');

    for (const width of [1920, 1440, 1280, 1240, 1239, 1024, 768, 510, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      const bounds = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, inputs: Array.from(document.querySelectorAll('.study-tool-form input')).map(el => el.getBoundingClientRect().width) }));
      assert.ok(bounds.scroll <= width, `no overflow at ${width}: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.inputs.every(width => width > 48));
      const center = await page.locator('.dictionary-main').evaluate(el => { const r = el.getBoundingClientRect(); return r.x + r.width / 2; });
      assert.ok(Math.abs(center - width / 2) < 1, `main cards centered at ${width}`);
    }
    assert.equal(await page.locator('.study-toolbox-heading, .study-toolbox-note, .study-tool-form label span').count(), 0);
    const originalCards = await page.evaluate(() => captureWordSearchCards());
    const originalFavorites = await favorites();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => applyWordSearchCards([{ input: '', mode: 'lemma', result: null }]));
    await remember('resolve to');
    const phraseCard = page.locator('#wordSearchModules .study-card');
    assert.deepEqual(await phraseCard.locator('.study-parts strong').allTextContents(), ['resolve', 'to']);
    assert.match(await phraseCard.locator('.study-parts').textContent(), /^词语解释：resolve：动词/);
    assert.doesNotMatch(await phraseCard.locator('.study-content').textContent(), /re-|词块来源/);
    assert.deepEqual(await favorites(), originalFavorites, 'phrase generation is not automatically favorited');
    await phraseCard.screenshot({ path: path.join(process.env.TEMP, 'cet6-phrase-memory-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await phraseCard.screenshot({ path: path.join(process.env.TEMP, 'cet6-phrase-memory-mobile.png') });
    await phraseCard.locator('[data-study-action="save-mnemonic"]').click();
    await page.waitForFunction(() => getVFavs().some(item => item.word === 'resolve to' && item.mnemonic));
    await page.reload();
    await page.locator('#wordSearchModules [data-study-action="flip"]').click();
    await page.waitForFunction(() => !document.querySelector('#wordSearchModules .word-search-wrapper')._flipping);
    assert.match(await page.locator('#wordSearchModules .study-parts').textContent(), /^词语解释：resolve：动词/);
    await page.evaluate(favorites => { setVFavs(favorites); renderVFavs(); }, originalFavorites);
    console.log('PASS: phrase memory uses whole words and keeps word explanations through manual favorites and refresh');
    await page.evaluate(info => applyWordSearchCards([{ input: 'novels', mode: 'lemma', result: { ...info, sourceForm: 'novels', inflection: '复数' } }]), dict('novel'));
    const directCard = page.locator('#wordSearchModules .word-search-wrapper');
    assert.equal(await directCard.locator('[data-study-action="generate-mnemonic"]').count(), 1);
    const favoritesBeforeDirect = JSON.stringify(await favorites());
    mnemonicFail = true;
    await directCard.locator('[data-study-action="generate-mnemonic"]').click();
    await directCard.locator('.study-error').waitFor();
    assert.equal(await directCard.locator('.word-header .word').textContent(), 'novel', 'failed generation keeps the dictionary visible');
    assert.equal(await directCard.locator('[data-study-action="generate-mnemonic"]').isEnabled(), true);
    mnemonicFail = false;
    await directCard.locator('[data-study-action="generate-mnemonic"]').click();
    await directCard.locator('.study-result-title').waitFor();
    assert.equal(await directCard.locator('.study-result-title').textContent(), 'novel');
    assert.equal(mnemonicRequests.at(-1), 'novel', 'generation uses the displayed lemma, not the inflected query');
    assert.equal(await page.locator('#wordSearchModules .word-search-wrapper').count(), 1, 'generation stays on the same card');
    assert.equal(JSON.stringify(await favorites()), favoritesBeforeDirect, 'inline generation does not modify favorites');
    await directCard.locator('[data-study-action="flip"]').click();
    assert.equal(await directCard.locator('.word-search-input').inputValue(), 'novels');
    assert.equal(await directCard.locator('.word-header .word').textContent(), 'novel');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const headerBox = await directCard.locator('.word-header').boundingBox();
    const actionBox = await directCard.locator('.word-header [data-study-action="flip"]').boundingBox();
    const favoriteBox = await directCard.locator('.word-header .btn-favorite').boundingBox();
    assert.ok(Math.abs(headerBox.x + headerBox.width - actionBox.x - actionBox.width) <= 1, 'mnemonic action hugs the header right edge');
    assert.ok(favoriteBox.x + favoriteBox.width + 100 < actionBox.x, 'favorite toggle stays next to the word info');
    console.log('PASS: the mnemonic action sits at the far right of the word header');
    console.log('PASS: inline generation uses the result word, retains the same card and safely retries failures');
    await page.evaluate(() => applyWordSearchCards([{ input: 'advisable', study: { kind: 'mnemonic', word: 'advisable', mnemonic: {
      word: 'advisable', breakdown: 'advise（建议） + able（能…的） → 能接受建议的 → 明智的、可取的。', association: '采纳建议是明智的。', tip: 'advise + able，建议可取。'
    } } }]));
    assert.equal(await page.locator('#wordSearchModules .study-breakdown strong').count(), 3);
    assert.match(await page.locator('#wordSearchModules .study-breakdown').textContent(), /拆分记忆：/);
    assert.equal(await page.locator('#wordSearchModules .study-parts').count(), 0, 'legacy mnemonics without chunk sources still render');
    assert.equal(await page.locator('#wordSearchModules .study-section-label, #wordSearchModules .study-takeaway').count(), 0, 'stored prose is hidden once the formula exists');
    assert.equal(await page.locator('#wordSearchModules .study-breakdown').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#wordSearchModules .word-search-wrapper').screenshot({ path: path.join(process.env.TEMP, 'cet6-split-memory-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#wordSearchModules .word-search-wrapper').screenshot({ path: path.join(process.env.TEMP, 'cet6-split-memory-mobile.png') });
    await page.evaluate(() => applyWordSearchCards([{ input: 'legacy', study: { kind: 'mnemonic', word: 'legacy', mnemonic: {
      word: 'legacy', association: '只有旧联想', tip: '只有旧提示'
    } } }]));
    assert.match(await page.locator('#wordSearchModules .study-content').textContent(), /只有旧联想/);
    assert.match(await page.locator('#wordSearchModules .study-content').textContent(), /只有旧提示/);
    assert.equal(await page.locator('#wordSearchModules .study-breakdown').count(), 0, 'prose-only legacy cards still render without a formula');
    await page.evaluate(({ info, memory }) => applyWordSearchCards([
      { input: 'affects', mode: 'lemma', result: { ...info, sourceForm: 'affects', inflection: '三单', mnemonic: memory } },
      { input: 'affect', mode: 'original', study: { kind: 'mnemonic', word: 'affect', mnemonic: memory } }
    ]), { info: dict('affect'), memory: mnemonic('affect') });
    await page.locator('.word-search-wrapper').nth(1).locator('[data-study-action="flip"]').click();
    assert.equal(await page.locator('.word-search-wrapper').nth(1).locator('.base-form-hint').count(), 0, 'a reused dictionary must not inherit another query\'s inflection hint');
    await page.locator('.word-search-wrapper').first().locator('[data-study-action="flip"]').click();
    await page.locator('.word-search-wrapper').first().locator('[data-study-action="flip"]').click();
    assert.equal(await page.locator('.word-search-wrapper').first().locator('.word-search-input').inputValue(), 'affects');
    assert.match(await page.locator('.word-search-wrapper').first().locator('.base-form-hint').textContent(), /affects/);
    dictionaryFail = true;
    await page.locator('.word-search-wrapper').first().locator('.word-search-input').fill('different');
    await page.locator('.word-search-wrapper').first().locator('.word-search-submit').click();
    await page.waitForFunction(() => !document.querySelector('.word-search-wrapper')._searching);
    await page.reload();
    assert.equal(await page.locator('.word-search-wrapper').first().locator('.word-search-input').inputValue(), 'different', 'a failed new lookup retains its new word draft');
    assert.equal(await page.locator('.word-search-wrapper').first().locator('.study-result-title').count(), 0);
    dictionaryFail = false;
    await page.evaluate(cards => applyWordSearchCards(cards), originalCards);
    assert.deepEqual(errors, []);
    console.log('PASS: centered layouts from 320 to 1920px, cached inflection hints and no runtime errors');
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(process.env.TEMP, 'cet6-study-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(process.env.TEMP, 'cet6-study-mobile.png') });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
