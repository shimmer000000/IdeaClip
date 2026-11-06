import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { collectionHarness } from './collection-harness';
import { seedLibrary } from './library-fixture';

let harness: Awaited<ReturnType<typeof collectionHarness>>; let page: Page;
test.beforeEach(async ({}, info) => {
  harness = await collectionHarness(); page = await harness.context.newPage();
  await page.goto(`chrome-extension://${harness.extensionId}/notes.html`); await expect(page.getByText('找到 0 条灵感', { exact: true })).toBeVisible();
  if (!info.title.includes('10000')) { await seedLibrary(page); await page.reload(); await expect(page.getByText('找到 54 条灵感', { exact: true })).toBeVisible(); }
});
test.afterEach(async () => { await harness?.context.close(); });
async function search(value: string) { await page.getByRole('textbox', { name: '搜索灵感' }).fill(value); await expect(page.locator('.result-line')).not.toContainText('正在'); }
async function waitResult(text: string) { await expect(page.getByText(text, { exact: true })).toBeVisible(); }

test('卡片与列表、分页、完整笔记、缩略图和多图大图切换', async ({}, info) => {
  await expect(page.locator('article.note')).toHaveCount(24);
  await page.getByRole('button', { name: '列表模式', exact: true }).click(); await expect(page.locator('.library-results')).toHaveClass(/list/);
  await page.getByRole('button', { name: '卡片模式', exact: true }).click(); await expect(page.locator('.library-results')).toHaveClass(/cards/);
  await expect(page.locator('.result-line')).not.toContainText('正在'); await expect(page.locator('article.note img').first()).toBeVisible(); await page.screenshot({ path: info.outputPath('library-cards.png'), fullPage: true });
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await expect(page.locator('.pagination')).toContainText('第 2 / 3 页');
  await search('灵感 00005'); await waitResult('找到 1 条灵感');
  const thumbnail = page.getByRole('img', { name: '截图缩略图：灵感 00005' }); await expect(thumbnail).toBeVisible();
  expect(await thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeLessThanOrEqual(480);
  await page.getByRole('button', { name: '下一张截图：灵感 00005' }).click();
  await page.getByRole('button', { name: '查看大图：灵感 00005' }).click();
  const viewer = page.getByRole('dialog', { name: '截图大图' }); await expect(viewer.getByRole('img')).toBeVisible(); await expect(viewer).toContainText('2 / 2');
  expect(await viewer.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1280);
  await viewer.getByRole('button', { name: '上一张', exact: true }).click(); await expect(viewer).toContainText('1 / 2'); await viewer.getByRole('button', { name: '关闭截图大图' }).click();
  await page.getByRole('button', { name: '灵感 00005', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '完整笔记' }); await expect(detail).toContainText('正文5：有价值的网页内容。'); await expect(detail).toContainText('下一步如何验证');
  await expect(detail.getByRole('link')).toHaveAttribute('href', 'https://x.com/fixture/status/5');
});

test('全文范围、作者标签搜索、组合来源分类收藏日期筛选与草稿', async () => {
  for (const [scope, value] of [['title', '灵感 00008'], ['content', '正文8：'], ['body', '尾部感悟词'], ['tags', '设计'], ['author', '作者甲']]) {
    await page.getByLabel('搜索范围').selectOption(scope); await search(value);
    await expect(page.locator('article.note').first()).toBeVisible();
    if (scope === 'body') await expect(page.getByRole('button', { name: '灵感 00007', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: '清除筛选' }).click(); await waitResult('找到 54 条灵感');
  await page.getByLabel('来源网站', { exact: true }).selectOption(JSON.stringify('github.com'));
  await page.getByLabel('分类', { exact: true }).selectOption(JSON.stringify('研究'));
  await page.getByLabel('收藏', { exact: true }).selectOption('yes');
  await page.getByLabel('创建时间从').fill('2026-11-03'); await page.getByLabel('创建时间至').fill('2026-11-03');
  await waitResult('找到 4 条灵感');
  await page.getByRole('button', { name: '清除筛选' }).click(); await page.getByRole('button', { name: /^草稿（/ }).click(); await waitResult('找到 6 条灵感');
  await page.getByLabel('收藏', { exact: true }).selectOption('yes'); await waitResult('找到 3 条灵感');
});

test('批量分类、标签与收藏，未提交编辑跳过并报告部分成功', async () => {
  await search('批量候选'); await waitResult('找到 2 条灵感');
  await page.getByLabel('全选当前页', { exact: true }).check();
  await page.getByLabel('批量操作', { exact: true }).selectOption('category'); await page.getByLabel('批量操作内容').fill('新分类'); await page.getByRole('button', { name: '执行批量操作' }).click();
  await expect(page.getByRole('status')).toContainText('成功 1 条，失败 1 条'); await expect(page.getByRole('status')).toContainText('未提交编辑');
  await page.getByRole('button', { name: '清空选择' }).click();
  for (const [operation, value] of [['addTags', '新增, 待研究'], ['removeTags', '新增'], ['favorite', '']]) {
    await page.getByLabel('选择笔记：批量候选 00001', { exact: true }).check();
    await page.getByLabel('批量操作', { exact: true }).selectOption(operation); if (value) await page.getByLabel('批量操作内容').fill(value);
    await page.getByRole('button', { name: '执行批量操作' }).click(); await expect(page.getByRole('status')).toContainText('成功 1 条，失败 0 条');
    await expect(page.locator('.result-line')).not.toContainText('正在');
  }
  const card = page.locator('article.note').filter({ hasText: '批量候选 00001' }); await expect(card).toContainText('#待研究'); await expect(card).not.toContainText('#新增'); await expect(card.getByRole('button', { name: '取消收藏：批量候选 00001' })).toHaveAttribute('aria-pressed', 'true');
});

test('批量删除必须二次确认，取消不删除，确认后保留原图与采集', async () => {
  await search('批量候选'); await waitResult('找到 2 条灵感'); await page.getByLabel('全选当前页', { exact: true }).check(); await page.getByLabel('批量操作', { exact: true }).selectOption('delete');
  await page.getByRole('button', { name: '执行批量操作' }).click(); let dialog = page.getByRole('dialog', { name: '确认批量删除' });
  await expect(dialog.getByRole('button', { name: '确认删除 2 条' })).toBeDisabled(); await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.locator('article.note')).toHaveCount(2);
  await page.getByRole('button', { name: '执行批量操作' }).click(); dialog = page.getByRole('dialog', { name: '确认批量删除' }); await dialog.getByLabel('我确认删除所选笔记及未提交编辑').check(); await dialog.getByRole('button', { name: '确认删除 2 条' }).click();
  await expect(page.getByRole('status')).toContainText('成功 2 条，失败 0 条'); await waitResult('找到 0 条灵感');
  const preserved = await page.evaluate(async () => {
    const connection = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('ideaclip'); request.onsuccess = () => resolve(request.result); });
    const tx = connection.transaction(['screenshots', 'contentCaptures']);
    const images = await new Promise<number>(resolve => { const request = tx.objectStore('screenshots').count(); request.onsuccess = () => resolve(request.result); });
    const capture = await new Promise<{ noteId: string | null }>(resolve => { const request = connection.transaction('contentCaptures').objectStore('contentCaptures').get('fixture-capture'); request.onsuccess = () => resolve(request.result); }); connection.close(); return { images, capture };
  });
  expect(preserved.images).toBe(48); expect(preserved.capture.noteId).toBeNull();
});

test('管理修改在浏览器进程关闭重开后保留，编辑入口可继续使用', async () => {
  await search('灵感 00005'); await waitResult('找到 1 条灵感'); await page.getByRole('button', { name: '收藏：灵感 00005' }).click(); await expect(page.getByRole('status')).toContainText('成功 1 条');
  await expect(page.getByRole('button', { name: '取消收藏：灵感 00005' })).toBeVisible();
  const profile = harness.profile; await harness.context.close(); harness = await collectionHarness(profile); page = await harness.context.newPage(); await page.goto(`chrome-extension://${harness.extensionId}/notes.html`);
  await waitResult('找到 54 条灵感'); await search('灵感 00005'); await waitResult('找到 1 条灵感'); await expect(page.getByRole('button', { name: '取消收藏：灵感 00005' })).toBeVisible();
  const old = harness.context.pages(); await page.getByRole('button', { name: '编辑', exact: true }).click(); await expect.poll(() => harness.context.pages().find(p => !old.includes(p) && p.url().includes('note.html'))).toBeTruthy();
  const editor = harness.context.pages().find(p => !old.includes(p) && p.url().includes('note.html'))!; await expect(editor.getByLabel('灵感标题', { exact: true })).toHaveValue('灵感 00005');
});

test('10000 条模拟笔记性能、懒加载、原图读取并发和 object URL 释放', async ({}, info) => {
  test.setTimeout(120_000); await seedLibrary(page, 10000, true);
  await page.addInitScript(() => {
    const stats = { active: new Set<string>(), originalReads: 0, activeReads: 0, peakReads: 0, gaps: [] as number[] };
    (globalThis as unknown as { libraryProbe: typeof stats }).libraryProbe = stats;
    const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => { const url = create(value); stats.active.add(url); return url; };
    URL.revokeObjectURL = url => { stats.active.delete(url); revoke(url); };
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) { const request = get.call(this, key); if (this.name === 'screenshots') { stats.originalReads++; stats.activeReads++; stats.peakReads = Math.max(stats.peakReads, stats.activeReads); const finish = () => stats.activeReads--; request.addEventListener('success', finish, { once: true }); request.addEventListener('error', finish, { once: true }); } return request; };
    let last = performance.now(); setInterval(() => { const now = performance.now(); stats.gaps.push(now - last); last = now; }, 16);
  });
  const start = Date.now(); await page.reload(); await waitResult('找到 10000 条灵感'); const firstPageMs = Date.now() - start;
  await expect(page.locator('article.note')).toHaveCount(24); await expect(page.locator('article.note img').first()).toBeVisible();
  await page.getByLabel('搜索范围').selectOption('content'); const searchStart = Date.now(); await page.getByRole('textbox', { name: '搜索灵感' }).fill('独特研究词'); await waitResult('找到 1 条灵感'); const searchMs = Date.now() - searchStart;
  await expect(page.getByRole('button', { name: '灵感 07777', exact: true })).toBeVisible();
  const probe = () => page.evaluate(() => { const stats = (globalThis as unknown as { libraryProbe: { active: Set<string>; originalReads: number; peakReads: number; gaps: number[] } }).libraryProbe; const gaps = [...stats.gaps].sort((a, b) => a - b); return { liveObjectUrls: stats.active.size, originalReads: stats.originalReads, peakOriginalReads: stats.peakReads, heartbeatP95Ms: gaps[Math.floor(gaps.length * 0.95)] ?? 0, heartbeatMaxMs: Math.max(0, ...gaps) }; });
  await expect.poll(async () => (await probe()).liveObjectUrls).toBe(0);
  const metrics = { notes: 10000, contentCharactersPerNote: '产品研究与需求验证。'.length * 220, sourceImages: 48, pageSize: 24, firstPageMs, searchMs, ...await probe() };
  const output = info.outputPath('performance.json'); await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(metrics, null, 2)); console.log('LIBRARY_PERFORMANCE', JSON.stringify(metrics));
  expect(firstPageMs).toBeLessThan(5000); expect(searchMs).toBeLessThan(5000); expect(metrics.heartbeatP95Ms).toBeLessThan(250); expect(metrics.peakOriginalReads).toBeLessThanOrEqual(2); expect(metrics.originalReads).toBeLessThan(24);
});
