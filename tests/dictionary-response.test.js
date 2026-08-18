const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('uses sourceForm instead of overloaded baseForm', () => {
  assert.match(source, /"sourceForm": "若输入发生词形还原，则填写用户原始输入；否则为空字符串"/);
  assert.doesNotMatch(source, /"baseForm":/);
});

test('requires direct JSON output and complete fields', () => {
  assert.match(source, /输出必须是可被 JSON\.parse 直接解析的单个 JSON 对象/);
  assert.match(source, /禁止 Markdown 代码块、说明文字或任何额外内容/);
  assert.match(source, /所有字段必须出现；不确定时使用空字符串、空数组或“无”，不得猜测或编造/);
});
