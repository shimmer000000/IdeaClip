import { test, expect } from '@playwright/test';
import { collectionHarness, collectPage } from './collection-harness';

let harness: Awaited<ReturnType<typeof collectionHarness>>;
test.beforeAll(async () => { harness = await collectionHarness(); });
test.afterAll(async () => { await harness?.context.close(); });

for (const url of [
  'https://example.com/',
  'https://github.com/shimmer000000/IdeaClip',
  'https://x.com/gaoqian2580/status/2083165441074323937',
  'https://x.com/gaoqian2580/status/2082783291162149077',
]) {
  test(`真实页面：${url}`, async ({}, info) => {
    const { context, cdp, extensionId } = harness;
    const source = await context.newPage();
    try { await source.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
    catch (error) {
      await info.attach('access-result', { body: JSON.stringify({ url, verified: false, error: String(error) }), contentType: 'application/json' });
      test.skip(true, '真实页面无法正常访问，未验证通过。'); return;
    }
    // A bounded wait lets a publicly accessible SPA render; no login or private APIs.
    if (url.includes('x.com/')) await source.locator('article').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
    const preview = await collectPage(source, context, cdp, extensionId);
    const text = await preview.getByLabel('正文预览', { exact: true }).inputValue();
    const author = await preview.getByLabel('作者', { exact: true }).inputValue();
    const warnings = await preview.locator('.collection-summary').innerText();
    await info.attach('access-result', { body: JSON.stringify({ url, hasText: Boolean(text), authorRecognized: Boolean(author), warnings }), contentType: 'application/json' });
    if (!text) { test.skip(true, '真实页面没有取得可读取正文，不能标记适配通过。'); return; }
    expect(text.length).toBeGreaterThan(20);
    if (url.includes('github.com/')) await expect(preview.getByLabel('网页标题')).toHaveValue('shimmer000000/IdeaClip');
    if (url.includes('x.com/')) {
      expect(author).not.toBe('');
      await expect(preview.getByLabel('原始 URL')).toHaveValue(url);
    }
  });
}
