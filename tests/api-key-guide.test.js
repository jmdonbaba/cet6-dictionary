const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('shows a compact four-step DeepSeek API Key guide', () => {
  assert.match(source, /<details class="key-guide">\s*<summary>没有 API Key？查看获取步骤<\/summary>/);
  assert.match(source, /<ol class="key-guide-steps">[\s\S]*?<\/ol>/);
  assert.match(source, /href="https:\/\/platform\.deepseek\.com\/sign_in"[^>]*>DeepSeek<\/a>/);
  assert.match(source, /href="https:\/\/platform\.deepseek\.com\/top_up"[^>]*>充值<\/a>/);
  assert.match(source, /href="https:\/\/platform\.deepseek\.com\/api_keys"[^>]*>创建 API Key<\/a>/);
  assert.match(source, /复制 Key，粘贴到上方输入框并保存/);
});

test('keeps the guide safe, responsive, and hidden after a key is saved', () => {
  assert.match(source, /\.key-area\.saved \+ \.key-guide\s*\{\s*display:\s*none;/);
  assert.match(source, /\.key-guide\s*\{[^}]*max-width:\s*460px;[^}]*text-align:\s*left;/);
  assert.match(source, /target="_blank" rel="noopener noreferrer"/);
});

test('links the page footer to the GitHub project', () => {
  assert.match(source, /<a class="footer-project-link" href="https:\/\/github\.com\/jmdonbaba\/cet6-dictionary" target="_blank" rel="noopener noreferrer">/);
  assert.match(source, /觉得好用？前往 GitHub 点个 Star ⭐/);
  assert.match(source, /\.footer-project-link\s*\{[^}]*display:\s*inline-block;[^}]*margin-top:\s*10px;[^}]*color:\s*var\(--primary\);/);
});
