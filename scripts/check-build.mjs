import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const pkg=JSON.parse(await readFile('package.json','utf8'));
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
assert.equal(manifest.version,pkg.version,'插件与项目版本必须一致');
assert.equal(lock.version,pkg.version,'锁文件版本必须一致');
assert.equal(lock.packages[''].version,pkg.version);
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage', 'webRequest']);
assert.equal(manifest.background.type, 'module');
await access(`dist/${manifest.background.service_worker}`);
await access('dist/collect.js');
await access('dist/assist.js');
assert.deepEqual(manifest.host_permissions, ['https://t.co/*']);
assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'self'; connect-src https: http://localhost:* http://127.0.0.1:*");
assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-eval|unsafe-inline/);
for (const page of [manifest.action.default_popup, manifest.options_page, 'notes.html', 'capture.html', 'collection.html', 'note.html', 'analysis.html', 'tasks.html']) {
  const html = await readFile(`dist/${page}`, 'utf8');
  assert.match(html, /<script type="module"[^>]+src="[^"]+"/);
  for (const [, path] of html.matchAll(/(?:src|href)="(\.\/assets\/[^"?]+)"/g)) await access(`dist/${path}`);
}
console.log('Manifest V3、页面入口、静态资源与网络限制检查通过。');
