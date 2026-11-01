// Keep static deployments from mixing cached scripts/styles with newer markup.
// Run after asset edits, before committing; --check never writes files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const stale = [];
const stamped = html.replace(/<(?:script|link)\b[^>]*\b(?:src|href)="([\w./-]+\.(?:css|js))(?:\?v=[a-f0-9]+)?"[^>]*>/g, (tag, asset) => {
  // Normalize newlines so Windows checkouts and GitHub Pages use the same version.
  const content = fs.readFileSync(path.join(root, asset), 'utf8').replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
  const updated = tag.replace(/((?:src|href)=")[^"]+"/, '$1'+asset+'?v='+hash+'"');
  if (updated !== tag) stale.push(asset);
  return updated;
});
if (process.argv.includes('--check')) {
  if (stale.length) {
    console.error('Asset versions need updating: '+stale.join(', ')+'. Run node tools/stamp-assets.cjs');
    process.exitCode = 1;
  } else console.log('PASS: asset versions match their contents');
} else {
  if (stamped !== html) fs.writeFileSync(file, stamped);
  console.log('Updated '+stale.length+' asset versions');
}
