import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
assert.equal(manifest.background.type, 'module');
await access(`dist/${manifest.background.service_worker}`);
await access('dist/collect.js');
await access('dist/assist.js');
assert.equal(manifest.host_permissions, undefined);
assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'self'; connect-src https: http://localhost:* http://127.0.0.1:*");
assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-eval|unsafe-inline/);
for (const page of [manifest.action.default_popup, manifest.options_page, 'notes.html', 'capture.html', 'collection.html', 'note.html', 'analysis.html', 'tasks.html']) {
  const html = await readFile(`dist/${page}`, 'utf8');
  assert.match(html, /<script type="module"[^>]+src="[^"]+"/);
  for (const [, path] of html.matchAll(/(?:src|href)="(\.\/assets\/[^"?]+)"/g)) await access(`dist/${path}`);
}
console.log('Manifest V3、页面入口、静态资源与网络限制检查通过。');
