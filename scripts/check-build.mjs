import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['activeTab']);
assert.equal(manifest.host_permissions, undefined);
assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
for (const page of [manifest.action.default_popup, manifest.options_page, 'notes.html']) {
  const html = await readFile(`dist/${page}`, 'utf8');
  assert.match(html, /<script type="module"[^>]+src="[^"]+"/);
  for (const [, path] of html.matchAll(/(?:src|href)="(\.\/assets\/[^"?]+)"/g)) await access(`dist/${path}`);
}
console.log('Manifest V3、页面入口、静态资源与网络限制检查通过。');
