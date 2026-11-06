import { test, expect, type Page } from '@playwright/test';
import { articleHtml } from '../fixtures/pages';
import { clickAction, collectionHarness, collectPage } from './collection-harness';

let harness: Awaited<ReturnType<typeof collectionHarness>>;
async function routes() {
  await harness.context.route('https://notes.ideaclip.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: articleHtml }));
}
test.beforeAll(async () => { harness = await collectionHarness(); await routes(); });
test.afterAll(async () => { await harness?.context.close(); });
async function begin(path: string) {
  const source = await harness.context.newPage(); await source.goto(`https://notes.ideaclip.test/${path}`);
  const before = harness.context.pages(); await clickAction(source, harness.cdp, harness.extensionId, '收藏当前网页');
  await expect.poll(() => harness.context.pages().find(p => !before.includes(p) && p.url().includes('/note.html'))).toBeTruthy();
  const editor = harness.context.pages().find(p => !before.includes(p) && p.url().includes('/note.html'))!;
  await expect(editor.getByLabel('灵感标题', { exact: true })).toBeVisible(); return { source, editor };
}
async function persisted(editor: Page) { await expect(editor.getByRole('status')).toContainText('自动保留'); }

test('统一收藏：多张截图、采集正文、感悟、问题、分类、标签和收藏组合保存', async ({}, info) => {
  const { source, editor } = await begin('combined');
  await editor.getByRole('button', { name: '截取可见页面', exact: true }).click();
  await expect(editor.getByRole('img')).toHaveCount(1);
  await editor.getByRole('button', { name: '选择区域截图', exact: true }).click();
  await expect(source.locator('#ideaclip-region-selector')).toBeAttached();
  await source.mouse.move(30, 120); await source.mouse.down(); await source.mouse.move(500, 350, { steps: 5 }); await source.mouse.up();
  await expect(editor.getByRole('img')).toHaveCount(2);
  await editor.getByRole('button', { name: '提取正文', exact: true }).click();
  await expect(editor.getByLabel('本次采集预览')).toHaveValue(/产品设计/);
  await editor.getByRole('button', { name: '采用采集内容' }).click();
  await expect(editor.getByLabel('采集正文', { exact: true })).toHaveValue(/产品设计/);
  await editor.getByLabel('灵感标题', { exact: true }).fill('完整灵感组合');
  await editor.getByLabel('我的感悟', { exact: true }).fill('这个机会值得验证。<script>测试字面文本</script>');
  await editor.getByLabel('待研究问题', { exact: true }).fill('用户愿意为哪部分付费？');
  await editor.getByLabel('分类', { exact: true }).fill('产品机会');
  await editor.getByLabel('标签', { exact: true }).fill('产品, 商业');
  await editor.getByLabel('标记收藏', { exact: true }).check();
  await persisted(editor);
  await editor.getByRole('button', { name: '保存灵感', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('全部内容已关联');
  await editor.reload();
  await expect(editor.getByLabel('我的感悟', { exact: true })).toHaveValue(/值得验证/);
  await expect(editor.getByRole('img')).toHaveCount(2);
  await expect(editor.getByLabel('分类', { exact: true })).toHaveValue('产品机会');
  await expect(editor.getByLabel('标记收藏', { exact: true })).toBeChecked();
  await editor.screenshot({ path: info.outputPath('unified-editor.png'), fullPage: true });
  await editor.getByRole('button', { name: '移除截图 1', exact: true }).click(); await persisted(editor);
  await editor.getByRole('button', { name: '保存灵感', exact: true }).click();
  await editor.reload(); await expect(editor.getByRole('img')).toHaveCount(1);
});

test('未提交编辑关闭后可恢复，保存草稿后可转为已保存，重复点击只有一条笔记', async () => {
  const { editor } = await begin('draft-recovery'); const url = editor.url();
  await editor.getByLabel('灵感标题', { exact: true }).fill('草稿恢复案例');
  await editor.getByLabel('我的感悟', { exact: true }).fill('关闭前的未提交感悟'); await persisted(editor);
  await editor.close(); const reopened = await harness.context.newPage(); await reopened.goto(url);
  await expect(reopened.getByLabel('我的感悟', { exact: true })).toHaveValue('关闭前的未提交感悟');
  await reopened.getByRole('button', { name: '保存草稿', exact: true }).click(); await expect(reopened.getByRole('status')).toContainText('已保存草稿');
  await reopened.getByRole('button', { name: '保存灵感', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(reopened.getByRole('status')).toContainText('已保存灵感');
  const list = await harness.context.newPage(); await list.goto(`chrome-extension://${harness.extensionId}/notes.html`);
  await expect(list.locator('article.note').filter({ hasText: '草稿恢复案例' })).toHaveCount(1);
});

test('保存失败保留输入，恢复写入后可重试，未提交内容不覆盖已保存版本', async () => {
  const { editor } = await begin('write-error');
  await editor.getByLabel('灵感标题', { exact: true }).fill('保存失败案例'); await persisted(editor);
  await editor.getByRole('button', { name: '保存灵感', exact: true }).click(); await expect(editor.getByRole('status')).toContainText('已保存灵感');
  await editor.evaluate(() => {
    const scope = globalThis as typeof globalThis & { restorePut?: () => void };
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) { if (this.name === 'noteDrafts') throw new DOMException('test storage full', 'QuotaExceededError'); return original.apply(this, args); };
    scope.restorePut = () => { IDBObjectStore.prototype.put = original; };
  });
  await editor.getByLabel('我的感悟', { exact: true }).fill('空间不足时也不能丢失这段输入');
  await expect(editor.getByRole('alert')).toContainText('草稿自动保留失败');
  await expect(editor.getByLabel('我的感悟', { exact: true })).toHaveValue('空间不足时也不能丢失这段输入');
  const list = await harness.context.newPage(); await list.goto(`chrome-extension://${harness.extensionId}/notes.html`);
  await expect(list.locator('article.note').filter({ hasText: '保存失败案例' })).not.toContainText('空间不足时也不能丢失这段输入'); await list.close();
  await editor.evaluate(() => (globalThis as typeof globalThis & { restorePut?: () => void }).restorePut?.());
  await editor.getByRole('button', { name: '重试保留草稿' }).click(); await persisted(editor);
  await editor.getByRole('button', { name: '保存灵感', exact: true }).click(); await expect(editor.getByRole('status')).toContainText('已保存灵感');
  await editor.reload(); await expect(editor.getByLabel('我的感悟', { exact: true })).toHaveValue('空间不足时也不能丢失这段输入');
});

test('采集预览未提交的修改先保存再整理到笔记，删除笔记不会删除截图', async () => {
  const source = await harness.context.newPage(); await source.goto('https://notes.ideaclip.test/from-capture');
  const screenshotPages = harness.context.pages(); await clickAction(source, harness.cdp, harness.extensionId, '截取可见页面');
  await expect.poll(() => harness.context.pages().find(p => !screenshotPages.includes(p) && p.url().includes('/capture.html'))).toBeTruthy();
  const originalImage = harness.context.pages().find(p => !screenshotPages.includes(p) && p.url().includes('/capture.html'))!;
  const collection = await collectPage(source, harness.context, harness.cdp, harness.extensionId);
  await collection.getByLabel('网页标题').fill('采集转笔记');
  await collection.getByLabel('正文预览', { exact: true }).fill('预览中新改的正文');
  const before = harness.context.pages(); await collection.getByRole('button', { name: '整理为灵感', exact: true }).click();
  await expect.poll(() => harness.context.pages().find(p => !before.includes(p) && p.url().includes('/note.html'))).toBeTruthy();
  const editor = harness.context.pages().find(p => !before.includes(p) && p.url().includes('/note.html'))!;
  await expect(editor.getByLabel('采集正文', { exact: true })).toHaveValue('预览中新改的正文');
  await editor.getByText('选择已有截图（', { exact: false }).click();
  await editor.getByLabel(/选择截图 1 ·/).check(); await persisted(editor);
  await editor.getByRole('button', { name: '保存灵感', exact: true }).click(); await expect(editor.getByRole('status')).toContainText('已保存灵感');
  editor.once('dialog', dialog => dialog.accept()); await editor.getByRole('button', { name: '删除笔记', exact: true }).click();
  await expect(editor).toHaveURL(/notes.html$/); await expect(editor.locator('article.note').filter({ hasText: '采集转笔记' })).toHaveCount(0);
  await collection.reload(); await expect(collection.getByLabel('正文预览', { exact: true })).toHaveValue('预览中新改的正文');
  await originalImage.reload(); await expect(originalImage.getByRole('img')).toBeVisible();
});

test('真实浏览器进程关闭重开后笔记、草稿与截图 Blob 保留，AI 没有请求', async () => {
  const { editor } = await begin('process-restart'); const editorUrl = editor.url();
  await editor.getByRole('button', { name: '截取可见页面', exact: true }).click(); await expect(editor.getByRole('img')).toHaveCount(1);
  await editor.getByLabel('灵感标题', { exact: true }).fill('进程重启持久化');
  await editor.getByLabel('我的感悟', { exact: true }).fill('已保存感悟'); await persisted(editor);
  await editor.getByRole('button', { name: '保存灵感', exact: true }).click(); await expect(editor.getByRole('status')).toContainText('已保存灵感');
  await editor.getByLabel('待研究问题', { exact: true }).fill('未提交的问题也应恢复'); await persisted(editor);
  const profile = harness.profile; await harness.context.close(); harness = await collectionHarness(profile); await routes();
  const restored = await harness.context.newPage(); await restored.goto(editorUrl);
  await expect(restored.getByLabel('我的感悟', { exact: true })).toHaveValue('已保存感悟');
  await expect(restored.getByLabel('待研究问题', { exact: true })).toHaveValue('未提交的问题也应恢复');
  await expect(restored.getByRole('img')).toHaveCount(1); await expect(restored.getByRole('img')).toHaveAttribute('src', /^blob:/);
  let requests = 0;
  restored.on('request', request => { if (/^https?:/.test(request.url())) requests++; });
  await restored.getByRole('button', { name: '保存灵感', exact: true }).click(); await expect(restored.getByRole('status')).toContainText('已保存灵感');
  expect(requests).toBe(0);
  const settings = await harness.context.newPage(); await settings.goto(`chrome-extension://${harness.extensionId}/settings.html`);
  await expect(settings.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});
