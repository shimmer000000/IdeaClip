import { test, expect } from '@playwright/test';
import { articleHtml, githubHtml, wechatHtml, xHtml } from '../fixtures/pages';
import { clickAction, collectPage, collectionHarness } from './collection-harness';

let harness: Awaited<ReturnType<typeof collectionHarness>>;
test.beforeAll(async () => {
  harness = await collectionHarness();
  await harness.context.route('**/*', route => ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.fallback());
  await harness.context.route('https://fixture.ideaclip.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: route.request().url().endsWith('/empty') ? '<nav>只有导航</nav><form>请登录</form>' : articleHtml }));
  await harness.context.route('https://x.com/fixture/status/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: xHtml(new URL(route.request().url()).pathname.split('/').at(-1)) }));
  await harness.context.route('https://github.com/fixture/repository', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: githubHtml }));
  await harness.context.route('https://mp.weixin.qq.com/s/ideaclip-fixture', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: wechatHtml }));
});
test.afterAll(async () => { await harness?.context.close(); });

test('普通文章采集、编辑、安全预览与已有截图关联持久化', async ({}, info) => {
  const { context, cdp, extensionId } = harness;
  const source = await context.newPage(); await source.goto('https://fixture.ideaclip.test/story');
  const prior = context.pages(); await clickAction(source, cdp, extensionId, '截取可见页面');
  await expect.poll(() => context.pages().find(p => !prior.includes(p) && p.url().includes('/capture.html'))).toBeTruthy();
  const screenshotPreview = context.pages().find(p => !prior.includes(p) && p.url().includes('/capture.html'))!;
  await expect(screenshotPreview.getByRole('img')).toBeVisible();
  const preview = await collectPage(source, context, cdp, extensionId);
  await expect(preview.getByLabel('网页标题')).toHaveValue('测试文章 · 示例站');
  await expect(preview.getByLabel('作者', { exact: true })).toHaveValue('测试作者');
  const extracted = await preview.getByLabel('正文预览', { exact: true }).inputValue();
  expect(extracted).toContain('产品设计'); expect(extracted).not.toContain('无关评论');
  await preview.getByLabel('网页标题').fill('我修改的采集标题');
  await preview.getByLabel('正文预览', { exact: true }).fill('用户感兴趣的正文 <img src=x onerror=alert(1)> & 🚀');
  await preview.getByLabel('关联截图（可多选）').selectOption({ index: 0 });
  await preview.getByRole('button', { name: '保存采集修改' }).click();
  await expect(preview.getByRole('status')).toContainText('修改已保存');
  await preview.reload();
  await expect(preview.getByLabel('网页标题')).toHaveValue('我修改的采集标题');
  await expect(preview.getByLabel('正文预览', { exact: true })).toHaveValue('用户感兴趣的正文 <img src=x onerror=alert(1)> & 🚀');
  await expect(preview.getByRole('img')).toHaveCount(1);
  await expect(preview.getByRole('img')).toHaveAttribute('src', /^blob:/);
  expect(await preview.evaluate(() => (globalThis as typeof globalThis & { shouldNotRun?: boolean }).shouldNotRun)).toBeUndefined();
  await screenshotPreview.reload(); await expect(screenshotPreview.getByRole('img')).toBeVisible();
  await preview.screenshot({ path: info.outputPath('collection-preview.png'), fullPage: true });
});

test('本地模拟 X 页面只读当前主帖，展开和 DOM 更新后重新读取', async () => {
  const { context, cdp, extensionId } = harness;
  const source = await context.newPage(); await source.goto('https://x.com/fixture/status/2083165441074323937');
  const first = await collectPage(source, context, cdp, extensionId);
  const text = await first.getByLabel('正文预览', { exact: true }).inputValue();
  expect(text).toContain('当前主帖'); expect(text).not.toContain('推荐帖'); expect(text).not.toContain('引用内容');
  await expect(first.getByText('检测到展开入口', { exact: false })).toBeVisible();
  await expect(first.getByLabel('图片 URL')).toHaveCount(2);
  await expect(first.getByLabel('外部链接（每行一个 HTTP / HTTPS URL）')).toHaveValue(/example.org\/tool/);
  await source.evaluate(() => { document.querySelectorAll('[data-testid="tweetText"]')[2].textContent = '用户手动展开之后的长帖内容。'.repeat(100); document.querySelector('button')?.remove(); });
  const second = await collectPage(source, context, cdp, extensionId);
  await expect(second.getByLabel('正文预览', { exact: true })).toHaveValue(/展开之后的长帖内容/);
  await expect(second.getByText('检测到展开入口', { exact: false })).toHaveCount(0);
});

test('本地 GitHub 和微信页面提取来源与正文', async () => {
  const { context, cdp, extensionId } = harness;
  for (const [url, title] of [['https://github.com/fixture/repository', 'fixture/repository'], ['https://mp.weixin.qq.com/s/ideaclip-fixture', '微信文章标题']]) {
    const source = await context.newPage(); await source.goto(url);
    const preview = await collectPage(source, context, cdp, extensionId);
    await expect(preview.getByLabel('网页标题')).toHaveValue(title);
    expect((await preview.getByLabel('正文预览', { exact: true }).inputValue()).length).toBeGreaterThan(30);
  }
});

test('无正文与浏览器权限不足时可手动补正文，完整性状态保持真实', async () => {
  const { context, cdp, extensionId } = harness;
  for (const url of ['https://fixture.ideaclip.test/empty', 'chrome://extensions/']) {
    const source = await context.newPage(); await source.goto(url);
    const preview = await collectPage(source, context, cdp, extensionId);
    await expect(preview.getByLabel('正文预览', { exact: true })).toHaveValue('');
    await expect(preview.getByText('自动采集未取得正文', { exact: false })).toBeVisible();
    await preview.getByLabel('网页标题').fill('手动补充的内容');
    await preview.getByLabel('原始 URL').fill('https://example.com/manual');
    await preview.getByLabel('正文预览', { exact: true }).fill('经用户确认后手动粘贴的正文。');
    await preview.getByRole('button', { name: '保存采集修改' }).click();
    await expect(preview.getByRole('status')).toContainText('修改已保存');
    await expect(preview.getByText('当前文本来源：手动粘贴', { exact: false })).toBeVisible();
    await expect(preview.getByText('自动采集未取得正文', { exact: false })).toBeVisible();
  }
});
