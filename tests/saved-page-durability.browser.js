// Optional real Edge regression. Set PLAYWRIGHT_MODULE when Playwright is installed outside this repo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const cp = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  assert.equal(process.platform, 'win32', 'This regression targets Edge process termination on Windows');
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const script = ['study-export.js', 'saved-page-store.js'].find(name => req.url.endsWith(name));
    res.setHeader('Content-Type', script ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, script || 'index.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profiles = [];
  let context;
  function newProfile() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cet6-edge-durability-'));
    profiles.push(profile);
    return profile;
  }
  async function open(profile) {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.EDGE_EXECUTABLE || path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
      headless: true
    });
    const page = context.pages()[0];
    await page.goto(url);
    await page.locator('.word-search-input').waitFor();
    return page;
  }
  async function close() {
    if (context) await context.close().catch(() => {});
    context = null;
  }
  try {
    for (const delay of [0, 100, 1000]) {
      const profile = newProfile();
      let page = await open(profile);
      await page.evaluate(() => {
        localStorage.setItem('cet6_api_key', 'old-key');
        localStorage.setItem('cet6_vocab_favorites', JSON.stringify([{ word: 'older-favorite' }]));
      });
      await close();
      page = await open(profile);
      const browser = context.browser();
      const cdp = await browser.newBrowserCDPSession();
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
      const browserProcess = processInfo.find(p => p.type === 'browser');
      assert.ok(browserProcess && browserProcess.id > 0);
      const command = cp.execFileSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter 'ProcessId = ${browserProcess.id}' | Select-Object -ExpandProperty CommandLine`], { encoding: 'utf8' });
      assert.ok(command.includes(profile), 'Only terminate our isolated browser, never the user browser');
      const before = await page.evaluate(async () => {
        applyWordSearchCards([{ input: 'recent-save', mode: 'lemma', result: { word: 'recent-save', definitions: ['刚保存的释义'] } }]);
        const saved = await savePageRecord();
        return { saved, count: (await getPageRecords()).length };
      });
      assert.deepEqual(before, { saved: true, count: 1 });
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const disconnected = new Promise(resolve => browser.once('disconnected', resolve));
      cp.execFileSync('taskkill', ['/PID', String(browserProcess.id), '/T', '/F'], { stdio: 'ignore' });
      await disconnected;
      context = null;
      page = await open(profile);
      assert.deepEqual(await page.evaluate(async () => ({ count: (await getPageRecords()).length,
        key: getApiKey(), favorites: getVFavs().length })), { count: 1, key: 'old-key', favorites: 1 });
      await close();
      console.log(`PASS: successful save survives whole Edge process-tree termination after ${delay} ms`);
    }

    const profile = newProfile();
    let page = await open(profile);
    await page.evaluate(() => {
      localStorage.setItem(PAGE_RECORD_PREFIX + 'legacy', JSON.stringify({ version: 1, savedAt: 123,
        cards: [{ input: 'legacy', mode: 'lemma', result: { word: 'legacy' } }] }));
      localStorage.setItem(PAGE_RECORD_PREFIX + 'damaged', '{bad');
    });
    await close();
    page = await open(profile);
    const migration = await page.evaluate(async () => ({ valid: (await getPageRecords()).length,
      raw: await getSavedPageStore().entries() }));
    assert.equal(migration.valid, 1);
    assert.equal(migration.raw.length, 2);
    assert.equal(migration.raw.find(([id]) => id === 'damaged')[1], '{bad');

    const batch = await page.evaluate(async () => {
      const store = getSavedPageStore();
      const original = await store.get('legacy');
      let rejected = false;
      try { await store.addMany([{ id: 'new-in-aborted-batch', raw: 'new' }, { id: 'legacy', raw: 'overwrite' }]); }
      catch { rejected = true; }
      return { rejected, inserted: await store.get('new-in-aborted-batch'), original, current: await store.get('legacy') };
    });
    assert.equal(batch.rejected, true);
    assert.equal(batch.inserted, null);
    assert.equal(batch.current, batch.original);

    await page.evaluate(async () => {
      const original = Storage.prototype.removeItem;
      Storage.prototype.removeItem = () => { throw new Error('legacy cleanup blocked'); };
      try { await getSavedPageStore().removeMany(['legacy']); }
      finally { Storage.prototype.removeItem = original; }
      if (!localStorage.getItem(PAGE_RECORD_PREFIX + 'legacy')) throw new Error('Expected stale legacy key for tombstone test');
    });
    await close();
    page = await open(profile);
    assert.equal(await page.evaluate(() => getSavedPageStore().get('legacy')), null);
    assert.equal(await page.evaluate(() => getSavedPageStore().has('legacy')), true);
    console.log('PASS: legacy migration preserves malformed raw data; aborted batches preserve originals; tombstones prevent resurrection');
    await close();

    const sharedProfile = newProfile();
    page = await open(sharedProfile);
    const other = await context.newPage();
    await other.goto(url);
    await Promise.all([page.evaluate(() => getSavedPageStore().ready()), other.evaluate(() => getSavedPageStore().ready())]);
    await page.locator('#btnRestorePage').click();
    await page.waitForFunction(() => document.getElementById('pageRecordList').textContent.includes('还没有保存'));
    await other.evaluate(() => {
      localStorage.setItem(PAGE_RECORD_PREFIX + 'late-legacy', JSON.stringify({ version: 1, savedAt: 456,
        cards: [{ input: 'late-legacy', mode: 'lemma', result: { word: 'late-legacy' } }] }));
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-page-record-id]').length === 1, null, { timeout: 3000 });
    assert.equal(await other.evaluate(async () => {
      applyWordSearchCards([{ input: 'other-tab', mode: 'lemma', result: { word: 'other-tab' } }]);
      return savePageRecord();
    }), true);
    await page.waitForFunction(() => document.querySelectorAll('[data-page-record-id]').length === 2);
    console.log('PASS: old-tab legacy saves and committed database changes refresh another tab\'s recovery dialog');
  } finally {
    await close();
    server.close();
    for (const profile of profiles) {
      // Each path came directly from this test's mkdtemp call; check its boundary before removal.
      assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(profile).startsWith('cet6-edge-durability-'));
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
