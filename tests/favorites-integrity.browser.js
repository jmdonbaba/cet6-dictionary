const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const keys = ['cet6_vocab_favorites', 'cet6_comparison_favorites', 'cet6_sentence_favorites'];
const mnemonic = version => ({ kind: 'mnemonic', word: 'reliable', mnemonic: { word: 'reliable', breakdown: `rely（依靠） + able（能…的） → 可靠的 ${version}`, parts: [{ part: 'rely', source: `依靠 ${version}` }] } });
const dictionary = { word: 'reliable', phonetic: '英 /rɪˈlaɪəbl/　美 /rɪˈlaɪəbl/', definitions: ['可靠的'], sentences: [], forms: '' };
const comparison = version => ({ kind: 'comparison', left: 'affect', right: 'effect', summary: `比较结果 ${version}`, tip: `提示 ${version}`, items: ['affect', 'effect'].map(word => ({ word, meaning: `释义 ${version}`, usage: `用法 ${version}`, collocations: [], example: { en: 'An example.', cn: '一个例子。' } })) });
const sentence = version => ({ kind: 'sentence', sentence: 'Had I known, I would have helped.', question: '', translation: `翻译 ${version}`, structure: `结构 ${version}`, grammar: [{ point: '虚拟语气', explanation: `讲解 ${version}` }] });

(async () => {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]);
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const failures = [];
  let response;
  await context.route('https://api.deepseek.com/**', route => route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(response) } }] } }));
  await page.goto(url);
  const favorite = () => page.evaluate(() => getVFavs());
  const read = key => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), key);
  const button = action => page.locator(`#wordSearchModules ${action === 'save-mnemonic' ? '.study-result-actions ' : ''}[data-study-action="${action}"]`).first();
  async function reset() {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(keys => {
      if (window.originalStorageGet) Storage.prototype.getItem = window.originalStorageGet;
      if (window.originalStorageSet) Storage.prototype.setItem = window.originalStorageSet;
      delete window.originalStorageGet; delete window.originalStorageSet;
      keys.forEach(key => localStorage.removeItem(key));
      localStorage.setItem('cet6_api_key', 'sk-test');
      closeModal(); renderVFavs(); applyWordSearchCards([{ input: '', mode: 'original', result: null }]);
    }, keys);
  }
  async function show(study, result) {
    await page.evaluate(({ study, result }) => applyWordSearchCards([{ input: study.word || study.sentence || `${study.left} 和 ${study.right}`, mode: 'original', study, result }]), { study, result });
  }
  async function run(name, fn) {
    await reset();
    try { await fn(); console.log('PASS: ' + name); }
    catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL: ' + name + ': ' + error.message); }
  }
  try {
    await run('the definition face saves only the word even when the card has a draft mnemonic', async () => {
      await show(mnemonic('A'), dictionary);
      await button('flip').click();
      const wordButton = page.locator('#wordSearchModules .word-header .btn-favorite');
      await wordButton.click();
      assert.equal((await favorite()).length, 1);
      assert.equal((await favorite())[0].mnemonic, undefined, 'saving a word must not implicitly save the draft mnemonic');
      assert.equal(await wordButton.textContent(), '取消收藏');
      await button('flip').click();
      assert.equal(await button('save-mnemonic').textContent(), '收藏');
      await page.reload();
      assert.equal(await button('save-mnemonic').textContent(), '收藏');
      await button('flip').click();
      assert.equal(await wordButton.textContent(), '取消收藏');
    });

    for (const savedMnemonic of [undefined, mnemonic('A').mnemonic]) {
      await run(`a saved word remains saved when its ${savedMnemonic ? 'regenerated' : 'first'} mnemonic is still a draft`, async () => {
        await page.evaluate(({ dictionary, savedMnemonic }) => {
          setVFavs([{ ...dictionary, id: 'saved-word', pinned: true, createdAt: 'keep-time', ...(savedMnemonic ? { mnemonic: savedMnemonic } : {}) }]); renderVFavs();
        }, { dictionary, savedMnemonic });
        await show(mnemonic('B'), dictionary);
        assert.equal(await button('save-mnemonic').textContent(), '收藏');
        await button('flip').click();
        const wordButton = page.locator('#wordSearchModules .word-header .btn-favorite');
        assert.equal(await wordButton.textContent(), '取消收藏', 'the definition button depends on the word, not the draft mnemonic');
        await wordButton.click();
        assert.equal((await favorite()).length, 0, 'cancelling the word also removes any saved mnemonic');
        await button('flip').click();
        assert.equal(await button('save-mnemonic').textContent(), '收藏');
        await button('save-mnemonic').click();
        const saved = (await favorite())[0];
        assert.equal(saved.word, dictionary.word);
        assert.match(saved.mnemonic.breakdown, /B/);
      });
    }

    await run('cancelling a mnemonic keeps word buttons saved across cards and refresh', async () => {
      await page.evaluate(({ dictionary, study }) => {
        setVFavs([{ ...dictionary, id: 'saved-word', mnemonic: study.mnemonic }]); renderVFavs();
        applyWordSearchCards([
          { input: study.word, study, result: { ...dictionary, mnemonic: study.mnemonic }, studyFace: 'definition' },
          { input: study.word, study, result: dictionary }
        ]);
      }, { dictionary, study: mnemonic('A') });
      await button('save-mnemonic').click();
      assert.equal((await favorite()).length, 1);
      assert.equal((await favorite())[0].mnemonic, undefined);
      const wordButton = page.locator('#wordSearchModules .word-header .btn-favorite');
      assert.equal(await wordButton.textContent(), '取消收藏', 'removing the mnemonic cannot unset the word favorite');
      assert.equal(await button('save-mnemonic').textContent(), '收藏');
      await page.reload();
      assert.equal(await wordButton.textContent(), '取消收藏');
      assert.equal(await button('save-mnemonic').textContent(), '收藏');
    });

    await run('removing and re-adding a word never resurrects its cancelled mnemonic', async () => {
      await page.evaluate(({ dictionary, study }) => {
        setVFavs([{ ...dictionary, id: 'saved-word', mnemonic: study.mnemonic }]); renderVFavs();
        applyWordSearchCards([
          { input: study.word, study, result: { ...dictionary, mnemonic: study.mnemonic }, studyFace: 'definition' },
          { input: study.word, study, result: dictionary }
        ]);
      }, { dictionary, study: mnemonic('A') });
      const wordButton = page.locator('#wordSearchModules .word-header .btn-favorite');
      await wordButton.click();
      assert.equal((await favorite()).length, 0);
      assert.equal(await button('save-mnemonic').textContent(), '收藏');
      await wordButton.click();
      assert.equal((await favorite()).length, 1);
      assert.equal((await favorite())[0].mnemonic, undefined, 'old card content is a draft after the favorite is removed');
      assert.equal(await button('save-mnemonic').textContent(), '收藏');
      await button('save-mnemonic').click();
      assert.match((await favorite())[0].mnemonic.breakdown, /A/);
      assert.equal(await wordButton.textContent(), '取消收藏');
      await button('save-mnemonic').click();
      assert.equal((await favorite()).length, 1);
      assert.equal((await favorite())[0].mnemonic, undefined);
      assert.equal(await wordButton.textContent(), '取消收藏');
    });

    await run('word deletion and re-addition synchronize independent face states in another tab', async () => {
      const other = await context.newPage();
      try {
        await page.evaluate(({ dictionary, study }) => {
          setVFavs([{ ...dictionary, id: 'saved-word', mnemonic: study.mnemonic }]); renderVFavs();
          applyWordSearchCards([{ input: study.word, study, result: dictionary, studyFace: 'definition' }]);
        }, { dictionary, study: mnemonic('A') });
        await other.goto(url);
        await other.evaluate(({ dictionary, study }) => applyWordSearchCards([
          { input: study.word, study, result: dictionary, studyFace: 'definition' },
          { input: study.word, study, result: dictionary }
        ]), { dictionary, study: mnemonic('A') });
        const wordButton = page.locator('#wordSearchModules .word-header .btn-favorite');
        await wordButton.click();
        await other.waitForFunction(() => document.querySelector('#wordFavoriteCount').textContent === '0');
        assert.equal(await other.locator('.word-header .btn-favorite').textContent(), '收藏');
        assert.equal(await other.locator('.study-result-actions [data-study-action="save-mnemonic"]').textContent(), '收藏');
        await wordButton.click();
        await other.waitForFunction(() => document.querySelector('#wordFavoriteCount').textContent === '1');
        assert.equal(await other.locator('.word-header .btn-favorite').textContent(), '取消收藏');
        assert.equal(await other.locator('.study-result-actions [data-study-action="save-mnemonic"]').textContent(), '收藏');
      } finally { await other.close(); }
    });

    await run('failed word cancellation preserves both favorites and retries as one operation', async () => {
      await page.evaluate(({ dictionary, study }) => {
        setVFavs([{ ...dictionary, id: 'saved-word', pinned: true, createdAt: 'keep-time', mnemonic: study.mnemonic }]); renderVFavs();
        applyWordSearchCards([
          { input: study.word, study, result: dictionary, studyFace: 'definition' },
          { input: study.word, study, result: dictionary }
        ]);
        window.originalStorageSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) { if (key !== 'cet6_vocab_favorites') return window.originalStorageSet.call(this, key, value); };
      }, { dictionary, study: mnemonic('A') });
      const before = await favorite();
      const wordButton = page.locator('#wordSearchModules .word-header .btn-favorite');
      await wordButton.click();
      assert.deepEqual(await favorite(), before);
      assert.equal(await wordButton.textContent(), '取消收藏');
      assert.equal(await button('save-mnemonic').textContent(), '取消收藏');
      await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; });
      await wordButton.click();
      assert.equal((await favorite()).length, 0);
      assert.equal(await wordButton.textContent(), '收藏');
      assert.equal(await button('save-mnemonic').textContent(), '收藏');
    });

    await run('deleting a word from the favorites list also clears both card favorite states', async () => {
      await page.evaluate(({ dictionary, study }) => {
        setVFavs([{ ...dictionary, id: 'saved-word', mnemonic: study.mnemonic }]); renderVFavs();
        applyWordSearchCards([
          { input: study.word, study, result: dictionary, studyFace: 'definition' },
          { input: study.word, study, result: dictionary }
        ]);
        delVFav('saved-word');
      }, { dictionary, study: mnemonic('A') });
      assert.equal((await favorite()).length, 0);
      assert.equal(await page.locator('#wordSearchModules .word-header .btn-favorite').textContent(), '收藏');
      assert.equal(await button('save-mnemonic').textContent(), '收藏');
      assert.equal(await page.locator('#wordFavoriteCount').textContent(), '0');
    });

    await run('mnemonic save synchronizes the actual word favorite list in another tab', async () => {
      const other = await context.newPage();
      try {
        await other.goto(url);
        await show(mnemonic('A'), dictionary);
        await button('save-mnemonic').click();
        await other.waitForFunction(() => document.querySelector('#wordFavoriteCount').textContent === '1');
        assert.equal(await other.locator('#favListContainer .vf-compact').count(), 1);
        assert.equal(await other.locator('#favListContainer [data-act="flipvfav"]').count(), 1);
        await other.reload();
        assert.match((await other.evaluate(() => getVFavs()))[0].mnemonic.breakdown, /A/);
      } finally { await other.close(); }
    });

    await run('a failed ordinary word write never turns its button into cancel favorite', async () => {
      await page.evaluate(info => applyWordSearchCards([{ input: info.word, result: info }]), dictionary);
      await page.evaluate(() => {
        window.originalStorageSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) { if (key === 'cet6_vocab_favorites') throw new Error('quota'); return window.originalStorageSet.call(this, key, value); };
      });
      await page.locator('#wordSearchModules .btn-favorite').click();
      assert.equal((await favorite()).length, 0);
      assert.equal(await page.locator('#wordSearchModules .btn-favorite').textContent(), '收藏');
      await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; });
      await page.locator('#wordSearchModules .btn-favorite').click();
      assert.equal((await favorite()).length, 1);
    });

    await run('a failed read cannot overwrite previously stored mnemonic favorites', async () => {
      await page.evaluate(() => setVFavs([{ id: 'keep', word: 'keep', definitions: ['保留'] }]));
      await show(mnemonic('A'), dictionary);
      const before = await read(keys[0]);
      await page.evaluate(() => {
        window.originalStorageGet = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) { if (key === 'cet6_vocab_favorites') throw new Error('blocked read'); return window.originalStorageGet.call(this, key); };
      });
      await button('save-mnemonic').click();
      await page.evaluate(() => { Storage.prototype.getItem = window.originalStorageGet; });
      assert.deepEqual(await read(keys[0]), before);
      assert.equal(await button('save-mnemonic').textContent(), '收藏');
    });

    await run('malformed word imports cannot hide the entire valid favorites collection', async () => {
      await page.evaluate(() => { setVFavs([{ id: 'keep', word: 'keep', definitions: ['保留'] }]); renderVFavs(); });
      const before = await read(keys[0]);
      await page.evaluate(() => applyImport('overwrite', { favorites: [{ word: 'valid' }, { word: '   ' }] }));
      assert.deepEqual(await read(keys[0]), before);
      assert.deepEqual(await favorite(), before);
      const notice = await page.locator('#toast').textContent();
      assert.doesNotMatch(notice, /^已覆盖导入/);
      await page.evaluate(() => addVFav({ word: '   ' }));
      assert.deepEqual(await favorite(), before);
    });

    await run('drag sorting cannot replace favorites with null after a storage read error', async () => {
      await page.evaluate(() => {
        setVFavs(['one', 'two', 'three'].map(word => ({ id: word, word, definitions: [word] })));
        renderVFavs(); openModal($modalVocabFav, true); StudyToolsUI.selectFavoriteTab('words');
      });
      const before = await read(keys[0]);
      const handle = await page.locator('#favListContainer .vf-drag-handle').first().boundingBox();
      const target = await page.locator('#favListContainer .vf-compact').nth(2).boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + target.height * .75, { steps: 5 });
      await page.evaluate(() => {
        window.originalStorageGet = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) { if (key === 'cet6_vocab_favorites') throw new Error('blocked read'); return window.originalStorageGet.call(this, key); };
      });
      await page.mouse.up();
      await page.evaluate(() => { Storage.prototype.getItem = window.originalStorageGet; });
      assert.deepEqual(await read(keys[0]), before);
      assert.equal(await page.evaluate(() => dragActive), false);
    });

    await run('a visible mnemonic favorite button stays disabled until its flip finishes', async () => {
      await page.evaluate(({ dictionary, study }) => applyWordSearchCards([{ input: 'reliable', result: { ...dictionary, mnemonic: study.mnemonic } }]), { dictionary, study: mnemonic('A') });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await button('flip').click();
      await page.waitForFunction(() => { const card = document.querySelector('#wordSearchModules .word-search-wrapper'); return card._searching && card._studyFace === 'memory'; });
      assert.equal(await button('save-mnemonic').isDisabled(), true);
      await page.waitForFunction(() => !document.querySelector('#wordSearchModules .word-search-wrapper')._flipping);
      assert.equal(await button('save-mnemonic').isEnabled(), true);
      await button('flip').click();
      await page.waitForFunction(() => { const card = document.querySelector('#wordSearchModules .word-search-wrapper'); return card._searching && card._studyFace === 'definition'; });
      const wordButton = page.locator('#wordSearchModules .word-header .btn-favorite');
      assert.equal(await wordButton.isDisabled(), true);
      await page.waitForFunction(() => !document.querySelector('#wordSearchModules .word-search-wrapper')._flipping);
      assert.equal(await wordButton.isEnabled(), true);
    });

    for (const [kind, make, key] of [['mnemonic', mnemonic, keys[0]], ['comparison', comparison, keys[1]], ['sentence', sentence, keys[2]]]) {
      await run(`${kind} regeneration requires explicit saving and preserves favorite metadata`, async () => {
        await show(make('A'), kind === 'mnemonic' ? dictionary : undefined);
        await button(`save-${kind}`).click();
        const stored = (await read(key))[0];
        await page.evaluate(({ key, id }) => {
          const items = JSON.parse(localStorage.getItem(key)); items.find(item => item.id === id).pinned = true; localStorage.setItem(key, JSON.stringify(items)); StudyToolsUI.refreshFavorites();
        }, { key, id: stored.id });
        if (kind === 'mnemonic') { await button('flip').click(); }
        response = kind === 'mnemonic' ? make('B').mnemonic : make('B');
        await button('regenerate').click();
        await page.waitForFunction(() => !document.querySelector('#wordSearchModules .word-search-wrapper')._searching);
        assert.equal(await button(`save-${kind}`).textContent(), '收藏');
        const content = item => item.mnemonic?.breakdown || item.summary || item.translation;
        assert.equal(content((await read(key))[0]), content(make('A')));
        await button(`save-${kind}`).click();
        const updated = await read(key);
        assert.equal(updated.length, 1);
        assert.equal(updated[0].id, stored.id);
        assert.equal(updated[0].pinned, true);
        assert.equal(content(updated[0]), content(make('B')));
        await page.reload();
        assert.equal(await button(`save-${kind}`).textContent(), '取消收藏');
      });
    }

    for (const [kind, make, key] of [['mnemonic', mnemonic, keys[0]], ['comparison', comparison, keys[1]], ['sentence', sentence, keys[2]]]) {
      await run(`${kind} refuses silent write failures, retries saving, and keeps data when cancellation fails`, async () => {
        await show(make('A'), kind === 'mnemonic' ? dictionary : undefined);
        await page.evaluate(key => {
          window.originalStorageSet = Storage.prototype.setItem;
          Storage.prototype.setItem = function (name, value) { if (name !== key) return window.originalStorageSet.call(this, name, value); };
        }, key);
        await button(`save-${kind}`).click();
        assert.equal((await read(key)).length, 0);
        assert.equal(await button(`save-${kind}`).textContent(), '收藏');
        await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; });
        await button(`save-${kind}`).click();
        const stored = await read(key);
        assert.equal(stored.length, 1);
        if (kind === 'mnemonic') await button('flip').click();
        await page.evaluate(key => {
          Storage.prototype.setItem = function (name, value) { if (name !== key) return window.originalStorageSet.call(this, name, value); };
        }, key);
        await button(`save-${kind}`).click();
        assert.deepEqual(await read(key), stored);
        assert.equal(await button(`save-${kind}`).textContent(), '取消收藏');
        await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; });
        await page.reload();
        assert.equal(await button(`save-${kind}`).textContent(), '取消收藏');
      });
    }

    await run('imported comparisons with duplicate IDs can be deleted independently', async () => {
      const first = { ...comparison('A'), id: 'collision' };
      const second = { ...comparison('B'), left: 'adapt', right: 'adopt', id: 'collision', items: comparison('B').items.map((item, index) => ({ ...item, word: index ? 'adopt' : 'adapt' })) };
      await page.evaluate(data => applyImport('merge', data), { favorites: [], comparisons: [first, second] });
      const ids = await page.locator('#comparisonFavList details').evaluateAll(items => items.map(item => item.dataset.comparisonId));
      assert.equal(new Set(ids).size, 2);
      await page.evaluate(() => { openModal($modalVocabFav, true); StudyToolsUI.selectFavoriteTab('comparisons'); });
      await page.locator('#comparisonFavList summary').nth(1).click();
      await page.locator('#comparisonFavList [data-comparison-action="delete"]').nth(1).click();
      const remaining = await read(keys[1]);
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].left, 'affect');
    });

    for (const [kind, make, key] of [['mnemonic', mnemonic, keys[0]], ['comparison', comparison, keys[1]], ['sentence', sentence, keys[2]]]) {
      await run(`${kind} opening a saved A version keeps the unsaved B card separate`, async () => {
        if (kind === 'mnemonic') {
          await page.evaluate(({ dictionary, study }) => { setVFavs([{ ...dictionary, id: 'saved-A', mnemonic: study.mnemonic }]); renderVFavs(); }, { dictionary, study: make('A') });
          await show(make('B'), { ...dictionary, mnemonic: make('A').mnemonic });
          await page.evaluate(() => openFavoriteInCard('saved-A'));
        } else {
          await page.evaluate(({ key, study }) => { localStorage.setItem(key, JSON.stringify([{ ...study, id: 'saved-A' }])); StudyToolsUI.refreshFavorites(); }, { key, study: make('A') });
          await show(make('B'));
          await page.evaluate(kind => { openModal($modalVocabFav, true); StudyToolsUI.selectFavoriteTab(kind === 'sentence' ? 'sentences' : 'comparisons'); }, kind);
          await page.locator(`#${kind === 'sentence' ? 'sentence' : 'comparison'}FavList summary`).click();
          await page.locator(`[data-${kind}-action="open"]`).click();
        }
        assert.equal(await page.locator('#wordSearchModules .word-search-wrapper').count(), 2);
        const contents = await page.locator('#wordSearchModules .word-search-wrapper').evaluateAll(cards => cards.map(card => card._studyData));
        assert.ok(contents.some(study => (study.mnemonic?.breakdown || study.summary || study.translation).includes('A')));
        assert.ok(contents.some(study => (study.mnemonic?.breakdown || study.summary || study.translation).includes('B')));
      });
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
