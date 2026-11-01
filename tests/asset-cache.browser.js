// Exercise a real HTTP cache across deployments; routing would disable the cache.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  let deployed = false;
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[\w./-]+$/.test(name) || name.includes('..')) {res.writeHead(404).end();return;}
    const file = path.join(root, name);
    if (!fs.existsSync(file)) {res.writeHead(404).end();return;}
    requests.push({name, deployed, query:url.search});
    let data = fs.readFileSync(file);
    if (name === 'index.html' && !deployed) data = Buffer.from(data.toString().replace(/\?v=[a-f0-9]+/g, ''));
    if (name === 'appearance.css' && !deployed) data = Buffer.concat([data, Buffer.from('\nhtml[data-interface="glass"] .word-result {background:rgba(255,255,255,.1)!important}')]);
    if (name === 'glass-renderer.js') data = Buffer.concat([data, Buffer.from('\ndocument.documentElement.dataset.cachedGlass="'+(deployed?'new':'old')+'";')]);
    res.setHeader('Content-Type', name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':'application/octet-stream');
    res.setHeader('Cache-Control',name==='index.html'?'no-store':'public, max-age=86400');
    res.end(data);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const url='http://127.0.0.1:'+server.address().port;
    await page.goto(url+'/?deployment=old');
    await page.evaluate(()=>Appearance.set('glass'));
    assert.equal(await page.locator('html').getAttribute('data-cached-glass'),'old');
    deployed=true;
    await page.goto(url+'/?deployment=new');
    await page.evaluate(()=>{
      document.querySelector('.word-search-result').innerHTML='<div class="word-result"><div class="word-forms">forms</div><div class="sentences"><div class="sen-item">example</div></div></div>';
      LiquidGlass.refresh();
    });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.word-result').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)','new deployment must bypass the still-fresh old stylesheet');
    assert.equal(await page.locator('html').getAttribute('data-cached-glass'),'new','new deployment must bypass the still-fresh old renderer');
    assert.equal(await page.evaluate(()=>GlassRenderer.getState().layers),1,'new transparent inner plate and renderer work together');
    assert.ok(requests.some(r=>r.deployed&&r.name==='appearance.css'&&r.query.startsWith('?v=')));
    assert.deepEqual(errors,[]);
    console.log('PASS: a new deployment replaces cached CSS and renderer without clearing browser data');
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(e=>{console.error(e);process.exitCode=1});
