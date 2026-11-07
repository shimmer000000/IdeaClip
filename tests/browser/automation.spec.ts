import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { collectionHarness, clickAction } from './collection-harness';
import { mockCompletion } from '../ai-fixture';
import type { AITask } from '../../src/automation/model';
import { qualityCapture, qualityText } from '../quality-fixture';

let server: Server; let endpoint: string; let base: string; let hold = false;
const calls: { body: string; authorization: string }[] = []; const held: ServerResponse[] = []; const errors: string[] = []; const external: string[] = [];
const key = 'synthetic-automation-browser-credential';
let harness: Awaited<ReturnType<typeof collectionHarness>>; let settings: Page;
test.beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); response.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (request.method !== 'POST') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); const text = request.url?.includes('low-quality') ? '只有产品简介' : qualityText; response.end('<!doctype html><meta charset="utf-8"><title>公开 SaaS 工具</title><main><h1>SaaS 商业工具</h1><p>' + text.replaceAll('\n', '</p><p>') + '</p><p style="display:none">hidden-test-secret</p><textarea>typed-test-secret</textarea></main>' + (request.url?.includes('password') ? '<input type="password" aria-label="密码">' : '')); return; }
    let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => { calls.push({ body, authorization: request.headers.authorization ?? '' }); if (hold) { held.push(response); return; } response.setHeader('Content-Type', 'application/json'); const system = JSON.parse(body).messages[0].content as string; const schema = JSON.parse(system.slice(system.indexOf('Schema：') + 7));
      response.end(JSON.stringify(mockCompletion({ schemaVersion: schema.properties.schemaVersion.const, sections: Object.fromEntries(schema.properties.sections.required.map((key: string) => [key, [{ kind: 'hypothesis', text: '基于本机 Mock 的验证假设，先访谈再测试。', evidence: null }]])) }))); });
  }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; endpoint = base + '/v1/chat/completions';
});
test.afterAll(async () => { held.forEach(response => response.destroy()); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
async function instrument() {
  // Only the native host-permission prompt is mocked; extension pages, storage,
  // service worker messages, Web Locks, browser restarts and HTTP requests are real.
  await harness.context.addInitScript(() => {
    if (!globalThis.chrome?.runtime?.id) return;
    chrome.permissions.request = async details => details.origins?.every(origin => origin === 'http://127.0.0.1/*') === true;
    chrome.permissions.contains = async details => !(globalThis as unknown as { denyMockPermission?: boolean }).denyMockPermission && details.origins?.every(origin => origin === 'http://127.0.0.1/*') === true;
    chrome.permissions.remove = async () => true;
  });
  harness.context.on('page', page => { page.on('console', message => errors.push(message.text())); page.on('pageerror', error => errors.push(error.message)); });
  await harness.context.route(/^https?:\/\//, route => { if (route.request().url().startsWith(base + '/')) return route.continue(); external.push(route.request().url()); return route.abort(); });
}
test.beforeEach(async () => { calls.length = 0; errors.length = 0; external.length = 0; hold = false; held.splice(0).forEach(response => response.destroy()); harness = await collectionHarness(); await instrument(); settings = await harness.context.newPage(); await settings.goto(`chrome-extension://${harness.extensionId}/settings.html`); await expect(settings.getByRole('heading', { name: '自动分析与浏览辅助' })).toBeVisible(); });
test.afterEach(async () => { expect(errors.join('\n')).not.toContain(key); expect(external).toEqual([]); await harness.context.close().catch(() => {}); });
async function configure(persistent = false, timeout = '60000') {
  await settings.getByLabel('AI 服务商', { exact: true }).selectOption('custom'); await settings.getByLabel('AI 模型名称', { exact: true }).fill('mock'); await settings.getByLabel('AI 接口地址', { exact: true }).fill(endpoint); await settings.getByLabel('AI API Key', { exact: true }).fill(key);
  for (const label of ['AI 每日预算', 'AI 输入单价', 'AI 输出单价']) await settings.getByLabel(label, { exact: true }).fill('1'); await settings.getByLabel('AI 请求超时', { exact: true }).fill(timeout);
  if (persistent) { await settings.getByRole('checkbox', { name: /长期本地保存密钥（默认关闭）/ }).check(); await settings.getByRole('checkbox', { name: '我理解长期本地保存密钥的安全风险' }).check(); }
  await settings.getByRole('checkbox', { name: /我授权向上方指定端点/ }).check(); await settings.getByRole('button', { name: '保存配置并授权域名' }).click(); await expect(settings.getByLabel('AI API Key', { exact: true })).toHaveValue('');
  await settings.getByRole('switch', { name: 'AI 分析总开关' }).click(); await expect(settings.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
}
async function automatic(mode = 'after-save', enabled = true) {
  await settings.getByLabel('分析模式', { exact: true }).selectOption(mode); await settings.getByLabel('自动分析白名单').fill('127.0.0.1');
  if (enabled) {
    await settings.getByRole('checkbox', { name: '开启自动分析（默认关闭）', exact: true }).check();
    const cap = settings.getByLabel('单次自动费用上限');
    await cap.fill('1'); await cap.blur();
    // Keep the synthetic budget fixed before scrolling/clicking consent controls.
    await expect(cap).toHaveValue('1');
    await settings.getByRole('checkbox', { name: /我明确授权自动发送白名单/ }).check();
    await expect(cap).toHaveValue('1');
  }
  if (mode === 'assist') await settings.getByRole('checkbox', { name: /我授权在上方白名单网站显示本地规则建议/ }).check();
  await settings.getByRole('button', { name: '保存分析模式与授权' }).click(); await expect(settings.getByText(/分析模式已保存|模式已保存，但网页脚本注册未完成/)).toBeVisible();
}
async function rows(page = settings) {
  return page.evaluate(async () => { const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ideaclip'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); try { return await new Promise<AITask[]>((resolve, reject) => { const r = database.transaction('aiTasks').objectStore('aiTasks').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); } finally { database.close(); } });
}
async function put(page: Page, table: string, id: string, patch: Record<string, unknown>) {
  await page.evaluate(async ({ table, id, patch }) => { const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ideaclip'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); const tx = database.transaction(table, 'readwrite'); const store = tx.objectStore(table); const item = store.get(id); item.onsuccess = () => store.put({ ...item.result, id, ...patch }); await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); database.close(); }, { table, id, patch });
}
async function editor(title: string, url = base + '/public-product') {
  const before = harness.context.pages(); await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'IC_NOTE_OPEN', kind: 'blank', requestId: crypto.randomUUID() })); await expect.poll(() => harness.context.pages().find(p => !before.includes(p) && p.url().includes('note.html'))).toBeTruthy(); const page = harness.context.pages().find(p => !before.includes(p) && p.url().includes('note.html'))!;
  const capture = qualityCapture(url);
  // Controlled synthetic extraction fixture; permission/network/queue APIs remain real
  // apart from the explicitly documented native-prompt boundary in this suite.
  await put(settings, 'contentCaptures', capture.id, capture as unknown as Record<string, unknown>);
  await page.reload(); // native IDB fixture writes do not publish Dexie liveQuery mutations
  await page.getByLabel('灵感标题', { exact: true }).fill(title); await page.getByLabel('原始网页 URL', { exact: true }).fill(url); await page.getByLabel('选择已有正文采集', { exact: true }).selectOption(capture.id); await page.getByRole('button', { name: '采用采集内容', exact: true }).click(); await page.getByLabel('我的感悟', { exact: true }).fill('先访谈用户，再验证付费意愿。'); return page;
}
async function save(page: Page, draft = false) { await page.getByRole('button', { name: draft ? '保存草稿' : '保存灵感', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: draft ? '已保存草稿' : '已保存灵感' })).toBeVisible(); }
async function tasks() {
  let page = harness.context.pages().find(p => p.url().includes('tasks.html')); if (!page) { page = await harness.context.newPage(); await page.goto(`chrome-extension://${harness.extensionId}/tasks.html`); } await expect(page.getByRole('heading', { name: 'AI 任务中心', exact: true })).toBeVisible(); return page;
}
async function pause(page: Page) { await page.getByRole('button', { name: '暂停自动分析', exact: true }).click(); await expect(page.getByRole('status')).toContainText('已暂停'); }

async function collectActual(path: string) {
  const source = await harness.context.newPage(); await source.goto(base + path);
  const before = harness.context.pages(); await clickAction(source, harness.cdp, harness.extensionId, '收藏当前网页');
  await expect.poll(() => harness.context.pages().find(p => !before.includes(p) && p.url().includes('note.html'))).toBeTruthy();
  const page = harness.context.pages().find(p => !before.includes(p) && p.url().includes('note.html'))!;
  await page.getByRole('button', { name: '提取正文', exact: true }).click();
  await expect(page.getByLabel('本次采集预览')).not.toHaveValue('');
  await page.getByRole('button', { name: '采用采集内容', exact: true }).click(); return page;
}

test('真实页面采集显示完整质量和来源段落，隐藏及输入内容不进入 AI', async ({}, info) => {
  await configure(); await automatic(); const page = await collectActual('/public-product');
  await expect(page.getByRole('heading', { name: '正文质量：完整（当前可读范围）' })).toBeVisible();
  const quality = page.locator('.quality-summary'); await quality.locator('summary').click();
  await expect(quality.getByRole('link', { name: /在原网页查找此段/ }).first()).toHaveAttribute('href', /#:~:text=/);
  await quality.screenshot({ path: info.outputPath('content-quality.png') });
  await save(page); await expect.poll(async () => (await rows())[0]?.state).toBe('done');
  expect(calls).toHaveLength(1); expect(calls[0].body).not.toMatch(/hidden-test-secret|typed-test-secret|image_url/);
});

test('短正文和手动补充可保存，但不会自动发送；恢复队列仍要求来源核对', async () => {
  await configure(); await automatic(); const page = await collectActual('/low-quality');
  await expect(page.getByRole('heading', { name: '正文质量：部分，待核对' })).toBeVisible();
  await save(page); const center = await tasks(); await expect.poll(async () => (await rows())[0]?.errorCode).toBe('quality');
  expect(calls).toHaveLength(0); await center.getByRole('button', { name: '恢复未发送任务' }).click();
  await expect(center.getByRole('status')).toContainText('恢复 0 条'); expect(calls).toHaveLength(0);
  await page.getByLabel('采集正文', { exact: true }).fill(qualityText); await save(page);
  await expect.poll(async () => (await rows()).every(r => r.errorCode === 'quality' || r.errorCode === 'snapshot')).toBe(true);
  await page.reload(); await expect(page.getByLabel('采集正文', { exact: true })).toHaveValue(qualityText);
  await expect(page.locator('.quality-summary')).toContainText('待核对'); expect(calls).toHaveLength(0);
});

test('默认手动且总开关关闭；配置、草稿和浏览均无请求，显式保存后自动执行并去重', async ({}, info) => {
  await expect(settings.getByLabel('分析模式', { exact: true })).toHaveValue('manual'); await expect(settings.getByRole('switch')).toHaveAttribute('aria-checked', 'false'); await configure(); const page = await editor('手动模式保存'); await save(page); expect(await rows()).toHaveLength(0); expect(calls).toHaveLength(0);
  await automatic(); const pending = await editor('自动分析笔记'); await save(pending, true); expect(await rows()).toHaveLength(0); await save(pending); const center = await tasks(); await expect.poll(async () => (await rows()).map(r => r.state)).toEqual(['done']); expect(calls).toHaveLength(1); expect(calls[0].body).not.toContain('image_url'); expect(calls[0].body).toContain('产品正文'); await save(pending); await expect.poll(async () => (await rows()).length).toBe(1); expect(calls).toHaveLength(1);
  const reportEvent = harness.context.waitForEvent('page'); await center.getByRole('link', { name: '查看分析结果', exact: true }).click(); const report = await reportEvent; await expect(report.locator('.ai-report section')).toHaveCount(15);
  await center.screenshot({ path: info.outputPath('automatic-task-center.png'), fullPage: true }); await settings.locator('.automation-settings').screenshot({ path: info.outputPath('automatic-settings.png') });
});

test('暂停后保存为暂停，人工恢复执行；多执行页不重复，取消全部等待任务生效', async () => {
  await configure(); await automatic(); const center = await tasks(); await pause(center); const first = await editor('暂停待恢复'); await save(first); const second = await editor('取消候选'); await save(second); expect((await rows()).map(r => r.state)).toEqual(['paused', 'paused']); expect(calls).toHaveLength(0);
  const duplicate = await harness.context.newPage(); await duplicate.goto(center.url()); await center.locator('.task-row').filter({ hasText: '取消候选' }).getByRole('button', { name: '取消任务', exact: true }).click(); await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect.poll(async () => (await rows()).filter(r => r.state === 'done').length).toBe(1); expect(calls).toHaveLength(1);
  await pause(center); const third = await editor('全部取消'); await save(third); await center.getByRole('button', { name: '取消全部等待任务' }).click(); await expect.poll(async () => (await rows()).filter(r => r.state === 'cancelled').length).toBe(2); expect(calls).toHaveLength(1); await duplicate.close();
});

test('运行取消立即中止客户端，排队任务暂停；手动重试须再次确认重复费用', async () => {
  await configure(); await automatic(); hold = true; const first = await editor('运行取消'); await save(first); const center = await tasks(); await expect.poll(() => calls.length).toBe(1); const second = await editor('下一任务'); await save(second);
  await center.locator('.task-row').filter({ hasText: '运行取消' }).getByRole('button', { name: '取消任务', exact: true }).click(); await expect.poll(async () => (await rows()).filter(r => r.state === 'cancelled').length).toBe(1); await expect.poll(async () => (await rows()).filter(r => r.state === 'paused').length).toBe(1); expect(calls).toHaveLength(1);
  hold = false; const row = center.locator('.task-row').filter({ hasText: '运行取消' }); await row.getByRole('button', { name: '手动重试（需确认费用）', exact: true }).click(); const dialog = center.getByRole('dialog', { name: '本次 AI 分析确认' }); await expect(dialog).toBeVisible(); await dialog.getByRole('checkbox', { name: /我确认发送上述资料/ }).check(); await expect(dialog.getByRole('button', { name: '确认并发起本次分析' })).toBeDisabled(); expect(calls).toHaveLength(1); await dialog.getByRole('checkbox', { name: '我理解可能重复计费，确认手动重试' }).check(); await dialog.getByRole('button', { name: '确认并发起本次分析' }).click(); await expect(row.locator('.badge')).toHaveText('完成'); expect(calls).toHaveLength(2);
});

test('AI 总开关关闭取消执行并暂停下一任务；关闭时新保存不入队', async () => {
  await configure(); await automatic(); hold = true; await save(await editor('关闭取消')); const center = await tasks(); await expect.poll(() => calls.length).toBe(1); await save(await editor('关闭排队')); await settings.getByRole('switch').click(); await expect.poll(async () => (await rows()).filter(r => r.state === 'failed').length).toBe(1); await expect.poll(async () => (await rows()).filter(r => r.state === 'paused').length).toBe(1); await save(await editor('关闭后保存')); expect(await rows()).toHaveLength(2); expect(calls).toHaveLength(1); await expect(center.getByText('费用或结果可能未知，不会自动重复请求。')).toBeVisible();
});

test('预算耗尽暂停，权限撤销阻止发送，修改后的旧快照失效，敏感来源被阻止', async () => {
  await configure(); await automatic(); const center = await tasks(); await pause(center); const page = await editor('过期快照'); await save(page); const task = (await rows())[0]; await put(settings, 'notes', task.noteId, { content: '已变更正文' }); await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect.poll(async () => (await rows())[0].errorCode).toBe('snapshot'); expect(calls).toHaveLength(0);
  await save(await editor('敏感页面', 'https://mail.example.com/inbox')); await expect.poll(async () => (await rows()).filter(r => r.errorCode === 'source').length).toBe(1); expect(calls).toHaveLength(0);
  await center.evaluate(() => { (globalThis as unknown as { denyMockPermission: boolean }).denyMockPermission = true; }); await save(await editor('权限已撤销')); await expect.poll(async () => (await rows()).find(r => r.state === 'paused')?.errorCode).toBe('permission'); expect(calls).toHaveLength(0);
  await center.evaluate(() => { (globalThis as unknown as { denyMockPermission: boolean }).denyMockPermission = false; }); await put(settings, 'aiUsage', 'spent', { noteId: task.noteId, day: new Date().toISOString().slice(0, 10), createdAt: Date.now(), model: 'mock', status: 'failed', reservedMicros: 1000000, estimatedInput: 1, maxOutput: 1 }); await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect.poll(async () => (await rows()).find(r => r.errorCode === 'budget')?.state).toBe('paused'); expect(calls).toHaveLength(0);
});

test('API 超时保留费用与失败原因，不自动重试', async () => {
  await configure(false, '1000'); await automatic(); hold = true; await save(await editor('超时任务')); const center = await tasks(); await expect.poll(async () => (await rows())[0]?.errorCode).toBe('timeout'); await expect(center.getByText(/请求超时/)).toBeVisible(); expect(calls).toHaveLength(1); await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect(center.getByRole('status')).toContainText('恢复 0 条'); expect(calls).toHaveLength(1);
});

test('真实 Chrome 关闭重启保留任务，运行中断不重发，仅人工恢复未发送任务', async () => {
  await configure(true); await automatic(); hold = true; await save(await editor('重启中断')); await expect.poll(() => calls.length).toBe(1); await save(await editor('重启等待')); await expect.poll(async () => (await rows()).filter(r => r.state === 'waiting').length).toBe(1); const profile = harness.profile;
  await harness.context.close(); harness = await collectionHarness(profile); await instrument(); settings = await harness.context.newPage(); await settings.goto(`chrome-extension://${harness.extensionId}/settings.html`); const center = await tasks(); await expect.poll(async () => (await rows()).map(r => r.state).sort()).toEqual(['failed', 'paused']); expect(calls).toHaveLength(1); await expect(center.getByText(/上次执行中断/)).toBeVisible(); hold = false; await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect.poll(async () => (await rows()).filter(r => r.state === 'done').length).toBe(1); expect(calls).toHaveLength(2); expect((await rows()).filter(r => r.errorCode === 'interrupted')).toHaveLength(1);
});

async function injectAssist(source: Page) {
  await clickAction(source, harness.cdp, harness.extensionId, '设置'); const worker = harness.context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${harness.extensionId}/`))!;
  // Native domain grant is mocked. activeTab is obtained by the real action above,
  // then Chrome executes the production IIFE in its real isolated content world.
  await worker.evaluate(async url => { const tabs = await chrome.tabs.query({}); const tab = tabs.find(tab => tab.url === url); if (!tab?.id) throw new Error('测试源页面没有 activeTab 授权'); await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['assist.js'] }); }, source.url());
}
async function mockAssistRegistration() {
  const worker = harness.context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${harness.extensionId}/`))!;
  await worker.evaluate(() => {
    chrome.permissions.contains = async details => details.origins?.every(origin => origin === 'http://127.0.0.1/*') === true;
    chrome.scripting.getRegisteredContentScripts = async () => [];
    chrome.scripting.registerContentScripts = async scripts => { (globalThis as unknown as { registeredAssist: chrome.scripting.RegisteredContentScript[] }).registeredAssist = scripts; };
  }); return worker;
}
test('浏览辅助本地提示不上传不保存，真实点击后编辑并明确勾选保存才入队', async () => {
  await configure(); const worker = await mockAssistRegistration(); await automatic('assist'); const registration = await worker.evaluate(() => (globalThis as unknown as { registeredAssist: chrome.scripting.RegisteredContentScript[] }).registeredAssist); expect(registration[0]).toMatchObject({ matches: ['http://127.0.0.1/*'], allFrames: false, js: ['assist.js'] });
  const source = await harness.context.newPage(); await source.goto(base + '/public-product'); await injectAssist(source); await expect(source.locator('[data-ideaclip-assist]')).toHaveCount(1); expect(calls).toHaveLength(0); expect(await rows()).toHaveLength(0);
  const session = await harness.context.newCDPSession(source); await session.send('Accessibility.enable'); const tree = await session.send('Accessibility.getFullAXTree'); const node = tree.nodes.find(n => n.role?.value === 'button' && n.name?.value === '确认收藏灵感'); expect(node?.backendDOMNodeId).toBeTruthy(); const box = await session.send('DOM.getBoxModel', { backendNodeId: node!.backendDOMNodeId }); const rect = box.model.border; const before = harness.context.pages(); await source.mouse.click((rect[0] + rect[2]) / 2, (rect[1] + rect[5]) / 2);
  await expect.poll(() => harness.context.pages().find(p => !before.includes(p) && p.url().includes('note.html'))).toBeTruthy(); const note = harness.context.pages().find(p => !before.includes(p) && p.url().includes('note.html'))!; expect(calls).toHaveLength(0); await expect(note.getByRole('checkbox', { name: /本条保存灵感后/ })).not.toBeChecked(); await note.getByRole('button', { name: '提取正文', exact: true }).click(); await expect(note.getByLabel('本次采集预览')).toHaveValue(/产品正文/); await note.getByRole('button', { name: '采用采集内容', exact: true }).click(); await note.getByRole('checkbox', { name: /本条保存灵感后/ }).check(); await save(note); await expect.poll(async () => (await rows())[0]?.state).toBe('done'); expect(calls).toHaveLength(1); expect(calls[0].body).not.toContain('image_url');
});

test('敏感 DOM 不显示建议，撤销本地辅助后移除已注入提示，不发送 AI 请求', async () => {
  await configure(); await mockAssistRegistration(); await automatic('assist', false); const password = await harness.context.newPage(); await password.goto(base + '/public-password-product'); await injectAssist(password); await expect(password.locator('[data-ideaclip-assist]')).toHaveCount(0);
  const source = await harness.context.newPage(); await source.goto(base + '/public-product'); await injectAssist(source); await expect(source.locator('[data-ideaclip-assist]')).toHaveCount(1); await settings.getByLabel('分析模式', { exact: true }).selectOption('manual'); await settings.getByRole('button', { name: '保存分析模式与授权' }).click(); await expect(source.locator('[data-ideaclip-assist]')).toHaveCount(0); expect(calls).toHaveLength(0); expect(await rows()).toHaveLength(0);
});


test('Skills 自动授权固定默认模板，默认变更后旧任务不自动换模板或重复发送', async () => {
  await configure(); const manager = settings.locator('.skill-manager'); await manager.getByLabel('管理模板').selectOption('builtin-lean'); await manager.getByRole('button', { name: '设为默认模板' }).click(); await expect(manager.getByRole('status')).toContainText('默认模板已更新'); await automatic();
  await save(await editor('精益模板自动报告')); const center = await tasks(); await expect.poll(async () => (await rows())[0]?.state).toBe('done'); expect((await rows())[0].skillId).toBe('builtin-lean'); expect(calls).toHaveLength(1); expect(calls[0].body).toContain('constraints');
  await pause(center); await save(await editor('等待旧精益模板')); await manager.getByLabel('管理模板').selectOption('builtin-codex'); await manager.getByRole('button', { name: '设为默认模板' }).click(); await expect(manager.getByRole('status')).toContainText('默认模板已更新'); await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect(center.getByRole('alert')).toContainText('模板'); expect(calls).toHaveLength(1);
  await automatic(); await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect.poll(async () => (await rows()).find(r => r.state === 'paused')?.errorCode).toBe('template'); expect(calls).toHaveLength(1);
  await save(await editor('新 Codex 模板报告')); await expect.poll(async () => (await rows()).filter(r => r.state === 'done').length).toBe(2); expect(calls).toHaveLength(2); expect(calls[1].body).toContain('developmentPrompt');
  const reportEvent = harness.context.waitForEvent('page'); await center.locator('.task-row').filter({ hasText: '新 Codex 模板报告' }).getByRole('link', { name: '查看分析结果' }).click(); const report = await reportEvent; await expect(report.locator('.ai-report')).toContainText('完整中文开发指令');
});
