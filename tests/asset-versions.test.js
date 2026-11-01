const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
test('deployment asset versions match the shipped scripts and styles', () => {
  const result=spawnSync(process.execPath,['tools/stamp-assets.cjs','--check'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
