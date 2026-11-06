import { test, expect, chromium, type BrowserContext, type Page, type CDPSession } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { stat } from 'node:fs/promises';

let context: BrowserContext;
let cdp: CDPSession;
let extensionId: string;
let source: Page;
let server: Server;
let origin: string;

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>截图测试页</title><style>body{margin:0;background:#fff;height:2000px}#target{position:absolute;left:100px;top:120px;width:240px;height:160px;background:rgb(240,50,70)}#marker{position:absolute;left:0;top:0;width:24px;height:24px;background:rgb(30,80,230)}h1{margin:20px}</style><h1>IdeaClip screenshot fixture</h1><div id="target"><div id="marker"></div></div>');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试服务器未启动');
  origin = `http://127.0.0.1:${address.port}`;
  const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath = process.env.IDEACLIP_BROWSER_PATH ?? (existsSync(installedChrome) ? installedChrome : chromium.executablePath());
  const profile = await mkdtemp(join(tmpdir(), 'ideaclip-test-'));
  context = await chromium.launchPersistentContext(profile, { executablePath, headless: false, viewport: { width: 1000, height: 700 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--window-position=-2000,-2000'] });
  source = context.pages()[0];
  cdp = await context.browser()!.newBrowserCDPSession();
  const loaded = await cdp.send('Extensions.loadUnpacked' as never, { path: resolve('dist') } as never) as { id: string };
  extensionId = loaded.id;
  await source.goto(origin);
});
test.afterAll(async () => { await context?.close(); server?.close(); });

let commandId = 0;
async function popupEvaluate<T>(targetId: string, expression: string): Promise<T> {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: ++commandId, method: 'Runtime.runIfWaitingForDebugger' }) });
  const id = ++commandId;
  let timer: ReturnType<typeof setTimeout>;
  let listener: (event: { sessionId: string; message: string }) => void;
  const response = new Promise<T>((done, fail) => {
    timer = setTimeout(() => fail(new Error('扩展弹窗执行超时')), 10_000);
    listener = event => {
      if (event.sessionId !== sessionId) return;
      const data = JSON.parse(event.message);
      if (data.id !== id) return;
      if (data.error || data.result?.exceptionDetails) fail(new Error(JSON.stringify(data)));
      else done(data.result.result.value as T);
    };
    cdp.on('Target.receivedMessageFromTarget', listener);
  });
  await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }) });
  try { return await response; }
  finally { clearTimeout(timer!); cdp.off('Target.receivedMessageFromTarget', listener!); await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {}); }
}

async function popup() {
  await source.bringToFront();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const targetInfo = targetInfos.find(target => target.url === source.url());
  if (!targetInfo) throw new Error(`找不到网页标签目标：${JSON.stringify(targetInfos)}`);
  await cdp.send('Extensions.triggerAction' as never, { id: extensionId, targetId: targetInfo.targetId } as never);
  let popupId = '';
  await expect.poll(async () => {
    popupId = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.url.includes('/popup.html') || target.type === 'other' && !target.url)?.targetId ?? '';
    return popupId;
  }).toBeTruthy();
  await expect.poll(() => popupEvaluate<boolean>(popupId, '!!document.querySelector("button")')).toBe(true);
  return { click: (label: string) => popupEvaluate(popupId, `Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`) };
}

test('通过真实扩展按钮截图、持久化预览并下载图片', async ({}, testInfo) => {
  const action = await popup();
  await action.click('截取可见页面');
  await expect.poll(() => context.pages().find(page => page.url().includes('/capture.html'))).toBeTruthy();
  const preview = context.pages().find(page => page.url().includes('/capture.html'))!;
  await expect(preview.getByRole('status')).toContainText('已保存到本地数据库');
  await expect(preview.getByRole('img')).toBeVisible();
  await preview.reload();
  await expect(preview.getByRole('img')).toBeVisible();
  const downloadPending = preview.waitForEvent('download');
  await preview.getByRole('link', { name: '保存图片到电脑' }).click();
  const downloaded = await downloadPending;
  expect((await stat((await downloaded.path())!)).size).toBeGreaterThan(0);
  expect((await stat((await downloaded.path())!)).size).toBeLessThanOrEqual(2 * 1024 * 1024);
  await preview.screenshot({ path: testInfo.outputPath('preview.png'), fullPage: true });
});

for (const [zoom, dpr] of [[1, 1], [1.25, 1.5], [1.5, 2]]) {
  test(`区域截图位置与颜色准确：页面缩放 ${zoom}，DPR ${dpr}`, async () => {
    await source.bringToFront();
    const session = await context.newCDPSession(source);
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: dpr, mobile: false });
    const worker = context.serviceWorkers().find(w => w.url().includes(extensionId))!;
    await worker.evaluate(async zoomValue => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await chrome.tabs.setZoom(tab.id!, zoomValue);
    }, zoom);
    const box = await source.locator('#target').boundingBox();
    if (!box) throw new Error('找不到截图测试区域');
    const action = await popup();
    await action.click('选择区域截图');
    await expect(source.locator('#ideaclip-region-selector')).toBeAttached();
    const previousPreviews = context.pages().filter(p => p.url().includes('capture.html'));
    await source.mouse.move(box.x, box.y);
    await source.mouse.down();
    await source.mouse.move(box.x + box.width, box.y + box.height, { steps: 10 });
    await source.mouse.up();
    await expect(source.locator('#ideaclip-region-selector')).not.toBeAttached();
    await expect.poll(() => context.pages().find(page => page.url().includes('/capture.html') && !previousPreviews.includes(page))).toBeTruthy();
    const preview = context.pages().find(page => page.url().includes('/capture.html') && !previousPreviews.includes(page))!;
    await expect(preview.getByRole('status')).toContainText('选定区域');
    await expect(preview.getByRole('img')).toBeVisible();
    const pixels = await preview.getByRole('img').evaluate((element: HTMLImageElement) => {
      const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0);
      const at = (x: number, y: number) => [...ctx.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data].slice(0, 3);
      return { width: canvas.width, height: canvas.height, marker: at(0.04, 0.04), center: at(0.5, 0.5), corner: at(0.96, 0.96) };
    });
    expect(pixels.width / pixels.height).toBeCloseTo(1.5, 1);
    // WebP may be lossy: distinguish colors and positions without demanding lossless channels.
    for (const [actual, expected] of [[pixels.marker, [30, 80, 230]], [pixels.center, [240, 50, 70]], [pixels.corner, [240, 50, 70]]]) {
      actual.forEach((channel, index) => expect(Math.abs(channel - expected[index])).toBeLessThanOrEqual(5));
    }
    await session.detach();
  });
}

test('区域选择支持 Esc、右键和滚动变化取消', async () => {
  await source.bringToFront();
  for (const method of ['escape', 'contextmenu', 'scroll']) {
    const action = await popup(); await action.click('选择区域截图');
    await expect(source.locator('#ideaclip-region-selector')).toBeAttached();
    if (method === 'escape') await source.keyboard.press('Escape');
    if (method === 'contextmenu') await source.mouse.click(400, 300, { button: 'right' });
    if (method === 'scroll') await source.evaluate(() => scrollTo(0, 100));
    await expect(source.locator('#ideaclip-region-selector')).not.toBeAttached();
  }
});

test('重新截图保留原图，源网页跳转时明确报错', async () => {
  await source.bringToFront();
  const previousCount = context.pages().filter(page => page.url().includes('/capture.html')).length;
  const action = await popup(); await action.click('截取可见页面');
  await expect.poll(() => context.pages().filter(page => page.url().includes('/capture.html')).length).toBeGreaterThan(previousCount);
  const preview = context.pages().filter(page => page.url().includes('/capture.html')).at(-1)!;
  const originalUrl = preview.url();
  await expect(preview.getByRole('img')).toBeVisible();
  await preview.getByRole('button', { name: '重新截取可见页面' }).click();
  await expect.poll(() => preview.url()).not.toBe(originalUrl);
  await expect(preview.getByRole('img')).toBeVisible();
  const original = await context.newPage(); await original.goto(originalUrl);
  await expect(original.getByRole('img')).toBeVisible();
  await source.goto(`${origin}/changed`);
  await preview.bringToFront();
  await preview.getByRole('button', { name: '重新截取可见页面' }).click();
  await expect(preview.getByRole('alert')).toContainText('原网页已关闭或跳转');
});

test('大图压缩限制长边与体积，截图不含区域浮层', async () => {
  await source.bringToFront();
  const session = await context.newCDPSession(source);
  await session.send('Emulation.setDeviceMetricsOverride', { width: 3200, height: 1600, deviceScaleFactor: 1, mobile: false });
  const prior = context.pages().filter(page => page.url().includes('/capture.html'));
  const regionAction = await popup(); await regionAction.click('选择区域截图');
  await expect(source.locator('#ideaclip-region-selector')).toBeAttached();
  const action = await popup(); await action.click('截取可见页面');
  await expect(source.locator('#ideaclip-region-selector')).not.toBeAttached();
  await expect.poll(() => context.pages().find(page => page.url().includes('/capture.html') && !prior.includes(page))).toBeTruthy();
  const preview = context.pages().find(page => page.url().includes('/capture.html') && !prior.includes(page))!;
  await expect(preview.getByRole('img')).toBeVisible();
  const size = await preview.getByRole('img').evaluate((img: HTMLImageElement) => ({ width: img.naturalWidth, height: img.naturalHeight }));
  expect(Math.max(size.width, size.height)).toBe(2560);
  const background = await preview.getByRole('img').evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(canvas.width - 30, canvas.height - 30, 1, 1).data].slice(0, 3);
  });
  background.forEach(channel => expect(channel).toBeGreaterThan(250));
  await expect(preview.getByRole('status')).toContainText('已保存到本地数据库');
  const pendingDownload = preview.waitForEvent('download');
  await preview.getByRole('link', { name: '保存图片到电脑' }).click();
  const file = await pendingDownload;
  expect((await stat((await file.path())!)).size).toBeLessThanOrEqual(2 * 1024 * 1024);
  await session.detach();
});

test('浏览器内部页面明确拒绝截图，不保存错误内容', async () => {
  await source.goto('chrome://extensions/');
  const before = context.pages().filter(page => page.url().includes('/capture.html')).length;
  const action = await popup(); await action.click('截取可见页面');
  await expect.poll(async () => {
    const targets = (await cdp.send('Target.getTargets')).targetInfos;
    const target = targets.find(t => t.url.includes('/popup.html'));
    return target ? popupEvaluate<string>(target.targetId, 'document.body.innerText') : '';
  }).toContain('此页面不支持截图');
  expect(context.pages().filter(page => page.url().includes('/capture.html')).length).toBe(before);
});

test('源标签关闭后重新截图给出明确提示', async () => {
  source = await context.newPage(); await source.goto(origin);
  const prior = context.pages().filter(page => page.url().includes('/capture.html'));
  const action = await popup(); await action.click('截取可见页面');
  await expect.poll(() => context.pages().find(page => page.url().includes('/capture.html') && !prior.includes(page))).toBeTruthy();
  const preview = context.pages().find(page => page.url().includes('/capture.html') && !prior.includes(page))!;
  await expect(preview.getByRole('img')).toBeVisible();
  await source.close();
  await preview.getByRole('button', { name: '重新截取可见页面' }).click();
  await expect(preview.getByRole('alert')).toContainText('原网页已关闭');
});
