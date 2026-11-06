import { chromium, expect, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

export async function collectionHarness() {
  const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath = process.env.IDEACLIP_BROWSER_PATH ?? (existsSync(installed) ? installed : chromium.executablePath());
  const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'ideaclip-collect-')), { executablePath, headless: false, viewport: { width: 1100, height: 800 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--window-position=-2000,-2000'] });
  const cdp = await context.browser()!.newBrowserCDPSession();
  const loaded = await cdp.send('Extensions.loadUnpacked' as never, { path: resolve('dist') } as never) as { id: string };
  return { context, cdp, extensionId: loaded.id };
}

let commandId = 0;
async function popupEvaluate<T>(cdp: CDPSession, targetId: string, expression: string): Promise<T> {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: ++commandId, method: 'Runtime.runIfWaitingForDebugger' }) });
  const id = ++commandId;
  let timer: ReturnType<typeof setTimeout>;
  let listener: (event: { sessionId: string; message: string }) => void;
  const response = new Promise<T>((done, fail) => {
    timer = setTimeout(() => fail(new Error('扩展弹窗执行超时')), 10_000);
    listener = event => {
      if (event.sessionId !== sessionId) return;
      const data = JSON.parse(event.message); if (data.id !== id) return;
      if (data.error || data.result?.exceptionDetails) fail(new Error(JSON.stringify(data)));
      else done(data.result.result.value as T);
    };
    cdp.on('Target.receivedMessageFromTarget', listener);
  });
  try {
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }) });
    return await response;
  } finally {
    clearTimeout(timer!); cdp.off('Target.receivedMessageFromTarget', listener!);
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}
export async function clickAction(source: Page, cdp: CDPSession, extensionId: string, label: string) {
  await source.bringToFront();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const target = targetInfos.find(target => target.url === source.url());
  if (!target) throw new Error('找不到源网页');
  await cdp.send('Extensions.triggerAction' as never, { id: extensionId, targetId: target.targetId } as never);
  let popupId = '';
  await expect.poll(async () => {
    popupId = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url.includes('/popup.html') || t.type === 'other' && !t.url)?.targetId ?? '';
    return popupId;
  }).toBeTruthy();
  await expect.poll(() => popupEvaluate(cdp, popupId, `!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)})`)).toBe(true);
  await popupEvaluate(cdp, popupId, `Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
}
export async function collectPage(source: Page, context: BrowserContext, cdp: CDPSession, extensionId: string) {
  const before = context.pages();
  await clickAction(source, cdp, extensionId, '提取网页内容');
  await expect.poll(() => context.pages().find(page => !before.includes(page) && page.url().includes('/collection.html'))).toBeTruthy();
  const preview = context.pages().find(page => !before.includes(page) && page.url().includes('/collection.html'))!;
  await expect(preview.getByRole('heading', { name: '采集预览与修改' })).toBeVisible();
  return preview;
}
