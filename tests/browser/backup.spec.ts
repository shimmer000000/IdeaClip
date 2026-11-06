import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { collectionHarness } from './collection-harness';
import { seedLibrary } from './library-fixture';
import { readZip, writeZip } from '../../src/backup/zip';

let harness: Awaited<ReturnType<typeof collectionHarness>>; let page: Page;
test.beforeEach(async () => { harness = await collectionHarness(); page = await harness.context.newPage(); await page.goto(`chrome-extension://${harness.extensionId}/settings.html`); await expect(page.getByRole('heading', { name: '数据备份与恢复' })).toBeVisible(); });
test.afterEach(async () => { await harness?.context.close().catch(() => {}); });
async function seed() {
  await seedLibrary(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ideaclip'); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['settings', 'analyses', 'projects'], 'readwrite');
    tx.objectStore('settings').put({ id: 'general', aiEnabled: false, apiKey: 'synthetic-do-not-export', accessToken: 'synthetic-access-do-not-export' });
    tx.objectStore('analyses').put({ id: 'old-analysis', noteId: 'n-00001', createdAt: 1, content: '已有分析，仅作历史存储' }); tx.objectStore('projects').put({ id: 'old-project', title: '已有项目', noteIds: ['n-00001', 'n-00002'], createdAt: 1, updatedAt: 1 });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  });
}
async function state() {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ideaclip'); r.onsuccess = () => resolve(r.result); });
    const result: Record<string, unknown[]> = {};
    for (const name of ['notes', 'noteDrafts', 'screenshots', 'contentCaptures', 'settings', 'analyses', 'projects']) {
      // Only tests read entire fixture metadata; production uses bounded batches.
      const rows = await new Promise<Record<string, unknown>[]>(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
      result[name] = [];
      for (const row of rows) {
        if (name === 'screenshots') { const blob = row.blob as Blob; row.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join(''); delete row.blob; }
        delete row.sourceTabId; if (name === 'settings') { delete row.apiKey; delete row.accessToken; }
        if (name === 'screenshots') row.sourceUrl = new URL(row.sourceUrl as string).href;
        result[name].push(row);
      }
    }
    db.close(); return result;
  });
}
async function download(info: TestInfo, filename = 'IdeaClip-Backup.zip') {
  const start = Date.now(); const received = page.waitForEvent('download'); await page.getByRole('button', { name: '立即备份', exact: true }).click(); const file = await received; expect(file.suggestedFilename()).toMatch(/^IdeaClip-Backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const path = info.outputPath(filename); await mkdir(dirname(path), { recursive: true }); await file.saveAs(path); expect(await file.failure()).toBeNull(); await expect(page.getByRole('button', { name: '立即备份', exact: true })).toBeEnabled(); return { path, elapsed: Date.now() - start };
}
async function choose(path: string) { await page.getByLabel('选择 IdeaClip 备份文件').setInputFiles(path); await expect(page.getByRole('heading', { name: '恢复预览' })).toBeVisible(); await expect(page.getByRole('button', { name: '开始恢复' })).toBeEnabled(); }
async function replace() { await page.getByLabel('恢复方式').selectOption('replace'); await page.getByRole('button', { name: '开始恢复' }).click(); const dialog = page.getByRole('dialog', { name: '完整替换二次确认' }); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '确认替换全部数据' }).click(); }
async function changeLocalBody(body: string) {
  await page.evaluate(async body => { const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ideaclip'); r.onsuccess = () => resolve(r.result); }); const tx = db.transaction('notes', 'readwrite'); const store = tx.objectStore('notes'); const request = store.get('n-00001'); request.onsuccess = () => store.put({ ...request.result, body }); await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close(); }, body);
}

test('空数据库 ZIP、恢复预览、合并和存储用量', async ({}, info) => {
  const file = await download(info); const entries = await readZip(new Blob([await readFile(file.path)])); expect(entries).toHaveLength(1);
  await choose(file.path); await expect(page.locator('.backup-preview')).toContainText('笔记 0 条，截图 0 张'); await page.getByRole('button', { name: '开始恢复' }).click(); await expect(page.locator('.backup-result')).toContainText('成功 0 条，失败 0 条，跳过 0 条'); await page.getByRole('button', { name: '查看数据库使用量' }).click(); await expect(page.locator('.backup-panel')).toContainText('笔记 0 条，截图 0 张；当前扩展存储估算');
});

test('完整备份替换：二次确认、多图 Blob 与草稿关联、自动刷新、重启保留且无网络请求', async ({}, info) => {
  await seed(); const original = await state(); const file = await download(info); const entries = await readZip(new Blob([await readFile(file.path)])); expect(entries.filter(entry => entry.name.startsWith('images/'))).toHaveLength(48);
  const allMetadata = (await Promise.all(entries.filter(entry => entry.name.startsWith('data/')).map(entry => entry.blob.text()))).join(''); expect(allMetadata).not.toContain('synthetic-do-not-export'); expect(allMetadata).not.toContain('synthetic-access-do-not-export');
  await changeLocalBody('本地修改，需要还原'); const changed = await state(); const library = await harness.context.newPage(); await library.goto(`chrome-extension://${harness.extensionId}/notes.html`); await expect(library.getByText('找到 54 条灵感', { exact: true })).toBeVisible();
  await choose(file.path); await page.locator('.backup-preview').screenshot({ path: info.outputPath('restore-preview.png') });
  const otherSettings = await harness.context.newPage(); await otherSettings.goto(`chrome-extension://${harness.extensionId}/settings.html`); await expect(otherSettings.getByRole('heading', { name: '数据备份与恢复' })).toBeVisible();
  await expect.poll(() => otherSettings.evaluate(async () => (await indexedDB.databases()).filter(db => db.name?.startsWith('ideaclip-restore-stage-')).length)).toBe(1); await otherSettings.close();
  await page.getByLabel('恢复方式').selectOption('replace'); await page.getByRole('button', { name: '开始恢复' }).click(); let dialog = page.getByRole('dialog', { name: '完整替换二次确认' }); await expect(dialog.getByRole('button', { name: '确认替换全部数据' })).toBeDisabled(); await dialog.getByRole('button', { name: '取消替换' }).click(); expect(await state()).toEqual(changed);
  const requests: string[] = []; harness.context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  const refreshed = library.waitForEvent('load'); await replace(); await expect(page.locator('.backup-result')).toContainText('成功 113 条，失败 0 条，跳过 0 条'); await refreshed; expect(await state()).toEqual(original); expect(requests).toEqual([]);
  await expect(library.getByText('找到 54 条灵感', { exact: true })).toBeVisible(); await expect(library.locator('article.note img').first()).toBeVisible(); await library.getByRole('button', { name: /草稿（6）/ }).click(); await expect(library.getByText('找到 6 条灵感', { exact: true })).toBeVisible();
  const profile = harness.profile; await harness.context.close(); harness = await collectionHarness(profile); page = await harness.context.newPage(); await page.goto(`chrome-extension://${harness.extensionId}/settings.html`); expect(await state()).toEqual(original);
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).filter(db => db.name?.startsWith('ideaclip-restore-stage-')).length)).toBe(0);
});

test('合并去重和 ID 冲突明确跳过，本地内容不覆盖', async ({}, info) => {
  await seed(); const file = await download(info); await choose(file.path); await page.getByRole('button', { name: '开始恢复' }).click(); await expect(page.locator('.backup-result')).toContainText('成功 0 条，失败 0 条，跳过 113 条');
  await changeLocalBody('冲突版本必须保留'); await choose(file.path); await page.getByRole('button', { name: '开始恢复' }).click(); await expect(page.locator('.backup-result')).toContainText('成功 0 条'); await expect(page.locator('.backup-result')).not.toContainText('冲突或关联冲突 0 条'); expect((await state()).notes.find((row: unknown) => (row as { id: string }).id === 'n-00001')).toMatchObject({ body: '冲突版本必须保留' });
});

test('损坏文件与未来版本拒绝，预览前不改动原数据库', async ({}, info) => {
  await seed(); const before = await state(); const file = await download(info); const buffer = await readFile(file.path); buffer[55] ^= 1; await page.getByLabel('选择 IdeaClip 备份文件').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer }); await expect(page.locator('.backup-panel [role=alert]')).toBeVisible(); await expect(page.getByRole('heading', { name: '恢复预览' })).toHaveCount(0); expect(await state()).toEqual(before);
  const entries = await readZip(new Blob([await readFile(file.path)])); const manifest = entries.find(entry => entry.name === 'manifest.json')!; const data = JSON.parse(await manifest.blob.text()); data.formatVersion = 999;
  const incompatible = await writeZip(entries.map(entry => ({ name: entry.name, blob: entry.name === 'manifest.json' ? new Blob([JSON.stringify(data)]) : entry.blob })));
  await page.getByLabel('选择 IdeaClip 备份文件').setInputFiles({ name: 'future.zip', mimeType: 'application/zip', buffer: Buffer.from(await incompatible.arrayBuffer()) }); await expect(page.locator('.backup-panel [role=alert]')).toContainText('不兼容'); expect(await state()).toEqual(before);
});

test('真实 IndexedDB 配额错误和中途 abort 都回滚，失败后可重试', async ({}, info) => {
  await seed(); const file = await download(info); await changeLocalBody('原数据库必须保留'); const before = await state(); await choose(file.path);
  for (const fault of ['quota', 'abort']) {
    await page.evaluate(fault => {
      const original = IDBObjectStore.prototype.put; let once = true;
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        if (once && this.name === 'noteSearch' && this.transaction.db.name === 'ideaclip') { once = false; IDBObjectStore.prototype.put = original; if (fault === 'quota') throw new DOMException('synthetic quota', 'QuotaExceededError'); const request = original.apply(this, args); this.transaction.abort(); return request; }
        return original.apply(this, args);
      };
    }, fault);
    await replace(); await expect(page.locator('.backup-panel [role=alert]')).toContainText(fault === 'quota' ? '空间不足' : '回滚'); expect(await state()).toEqual(before);
  }
  await replace(); await expect(page.locator('.backup-result')).toContainText('成功 113 条'); expect((await state()).notes.find((row: unknown) => (row as { id: string }).id === 'n-00001')).not.toMatchObject({ body: '原数据库必须保留' });
});

test('恢复写入期间关闭 Chrome 进程，重开后原数据库完整且临时校验清理', async ({}, info) => {
  await seed(); const file = await download(info); await changeLocalBody('中断之前的原文'); const before = await state(); await choose(file.path);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put; let once = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const request = original.apply(this, args);
      if (once && this.name === 'noteSearch' && this.transaction.db.name === 'ideaclip') {
        once = false; IDBObjectStore.prototype.put = original; const store = this;
        // Keep an actual destination transaction pending until the browser process exits.
        function hold() { const next = store.get('synthetic-keepalive'); next.onsuccess = hold; }
        hold(); (globalThis as unknown as { restoreHolding: boolean }).restoreHolding = true;
      }
      return request;
    };
  });
  await replace(); await expect.poll(() => page.evaluate(() => (globalThis as unknown as { restoreHolding?: boolean }).restoreHolding)).toBe(true);
  const profile = harness.profile; await harness.context.close(); harness = await collectionHarness(profile); page = await harness.context.newPage(); await page.goto(`chrome-extension://${harness.extensionId}/settings.html`); expect(await state()).toEqual(before); await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).filter(db => db.name?.startsWith('ideaclip-restore-stage-')).length)).toBe(0);
});

test('128 张原图的大型备份分批校验恢复，二进制哈希一致', async ({}, info) => {
  test.setTimeout(90000); await seedLibrary(page, 240, true);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ideaclip'); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction('screenshots', 'readwrite'); const store = tx.objectStore('screenshots'); const first = store.get('image-1'); const second = store.get('image-2');
    second.onsuccess = () => { for (let index = 49; index <= 128; index++) store.put({ ...(index % 2 ? first.result : second.result), id: `image-${index}` }); };
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  });
  const before = await state(); const file = await download(info, 'IdeaClip-Large-Backup.zip'); const bytes = (await readFile(file.path)).length; const validationStart = Date.now(); await choose(file.path); const validationMs = Date.now() - validationStart; const restoreStart = Date.now(); await replace(); await expect(page.locator('.backup-result')).toContainText('成功 369 条'); const restoreMs = Date.now() - restoreStart; expect(await state()).toEqual(before);
  const metrics = { notes: 240, screenshots: 128, archiveBytes: bytes, exportMs: file.elapsed, validationMs, restoreMs }; await writeFile(info.outputPath('backup-performance.json'), JSON.stringify(metrics, null, 2)); console.log('BACKUP_PERFORMANCE', JSON.stringify(metrics));
});
