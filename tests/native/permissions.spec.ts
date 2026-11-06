import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { collectionHarness, clickAction } from '../browser/collection-harness';
import { mockCompletion } from '../ai-fixture';

// Interactive acceptance: a person/desktop agent chooses the REAL Chrome permission
// bubbles. No permission API, content registration or injection mocks are allowed.
test('原生 Chrome 权限拒绝/授予/撤销与自动队列安全', async ({}, info) => {
  const calls: string[] = []; const held: ServerResponse[] = []; let hold = false;
  const article = '<!doctype html><meta charset="utf-8"><title>公开 SaaS 工具研究</title><main><h1>公开 SaaS 工具研究</h1>' + Array.from({ length: 5 }, (_, i) => `<p>产品研究段落 ${i}：为小团队提供工作流工具，按月订阅，先通过用户访谈验证需求、定价和获客渠道。这里是完整且公开的产品介绍，用于本机测试，不包含任何私人内容。</p>`).join('') + '</main>';
  const server: Server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (request.method !== 'POST') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(article); return; }
    let body = ''; request.on('data', b => { body += b; }); request.on('end', () => { calls.push(body); if (hold) held.push(response); else { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(mockCompletion())); } });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port;
  const sourceUrl = `http://127.0.0.1:${port}/public-product`; const endpoint = `http://localhost:${port}/v1/chat/completions`;
  let harness = await collectionHarness(process.env.IDEACLIP_NATIVE_RESTART_PROFILE, true); let settings!: Page;
  console.log('NATIVE_PROFILE', harness.profile);
  const fence = () => harness.context.route(/^https?:\/\//, route => { const url = new URL(route.request().url()); if (['localhost', '127.0.0.1'].includes(url.hostname) && url.port === String(port)) return route.continue(); return route.abort(); });
  const openSettings = async () => { settings = await harness.context.newPage(); await settings.goto(`chrome-extension://${harness.extensionId}/settings.html`); await settings.evaluate(() => { document.title = 'IdeaClip 原生权限验收'; }); };
  const permission = (host: string) => settings.evaluate(host => chrome.permissions.contains({ origins: [`http://${host}/*`] }), host);
  const tasks = async () => { const p = harness.context.pages().find(p => p.url().includes('tasks.html')) ?? await harness.context.newPage(); if (!p.url().includes('tasks.html')) await p.goto(`chrome-extension://${harness.extensionId}/tasks.html`); return p; };
  const records = () => settings.evaluate(async () => { const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ideaclip'); r.onsuccess = () => resolve(r.result); }); try { return await new Promise<{ id: string; state: string; errorCode: string }[]>(resolve => { const r = db.transaction('aiTasks').objectStore('aiTasks').getAll(); r.onsuccess = () => resolve(r.result); }); } finally { db.close(); } });
  const collect = async (name: string) => {
    const source = await harness.context.newPage(); await source.goto(sourceUrl + '?case=' + encodeURIComponent(name)); const before = harness.context.pages(); await clickAction(source, harness.cdp, harness.extensionId, '收藏当前网页');
    await expect.poll(() => harness.context.pages().find(p => !before.includes(p) && p.url().includes('note.html'))).toBeTruthy(); const note = harness.context.pages().find(p => !before.includes(p) && p.url().includes('note.html'))!;
    await note.getByRole('button', { name: '提取正文', exact: true }).click(); await expect(note.getByLabel('本次采集预览')).toHaveValue(/产品研究段落/); await note.getByRole('button', { name: '采用采集内容' }).click(); await note.getByLabel('灵感标题', { exact: true }).fill(name); await note.getByRole('checkbox', { name: /本条保存灵感后/ }).check(); await note.getByRole('button', { name: '保存灵感', exact: true }).click(); await expect(note.getByRole('status')).toContainText('已保存灵感'); return { source, note };
  };
  try {
    await fence();
    if (process.env.IDEACLIP_NATIVE_RESTART_PROFILE) {
      // Continue only the restart assertions after an interrupted interactive run.
      // This does not count as a new native deny/grant acceptance run.
      await openSettings(); const center = await tasks();
      expect((await records()).map(r => r.state).sort()).toEqual(['cancelled', 'done', 'done', 'failed', 'paused']);
      expect(await permission('localhost')).toBe(false); expect(await permission('127.0.0.1')).toBe(false);
      await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect(center.getByRole('alert')).toContainText('授权失效');
      expect(calls).toHaveLength(0); console.log('NATIVE_RESTART_CONTINUATION_PASSED'); return;
    }
    await openSettings(); await settings.getByLabel('AI 服务商', { exact: true }).selectOption('custom'); await settings.getByLabel('AI 模型名称', { exact: true }).fill('local-mock'); await settings.getByLabel('AI 接口地址', { exact: true }).fill(endpoint); await settings.getByLabel('AI API Key', { exact: true }).fill('synthetic-native-credential');
    for (const label of ['AI 每日预算', 'AI 输入单价', 'AI 输出单价']) await settings.getByLabel(label, { exact: true }).fill('1');
    await settings.getByRole('checkbox', { name: /长期本地保存密钥（默认关闭）/ }).check(); await settings.getByRole('checkbox', { name: '我理解长期本地保存密钥的安全风险' }).check(); await settings.getByRole('checkbox', { name: /我授权向上方指定端点/ }).check();
    if (!process.env.IDEACLIP_NATIVE_GRANTS_ONLY) { console.log('NATIVE_STAGE API_DENY: 在 Chrome 原生权限弹窗选择拒绝'); await settings.getByRole('button', { name: '保存配置并授权域名' }).click(); await expect(settings.getByRole('alert')).toContainText('拒绝'); expect(await permission('localhost')).toBe(false); expect(calls).toHaveLength(0); }
    console.log('NATIVE_STAGE API_ALLOW: 在 Chrome 原生权限弹窗选择允许'); await settings.getByRole('button', { name: '保存配置并授权域名' }).click(); await expect(settings.getByLabel('AI API Key', { exact: true })).toHaveValue(''); expect(await permission('localhost')).toBe(true); await settings.getByRole('switch').click();
    await settings.getByLabel('分析模式', { exact: true }).selectOption('assist'); await settings.getByLabel('自动分析白名单').fill('127.0.0.1'); await settings.getByRole('checkbox', { name: '开启自动分析（默认关闭）', exact: true }).check(); await settings.getByLabel('单次自动费用上限').fill('1'); await settings.getByRole('checkbox', { name: /我明确授权自动发送白名单/ }).check(); await settings.getByRole('checkbox', { name: /我授权在上方白名单网站显示本地规则建议/ }).check();
    if (!process.env.IDEACLIP_NATIVE_GRANTS_ONLY) { console.log('NATIVE_STAGE SITE_DENY: 在 Chrome 原生权限弹窗选择拒绝'); await settings.getByRole('button', { name: '保存分析模式与授权' }).click(); await expect(settings.locator('.automation-settings [role="alert"]')).toContainText('拒绝'); expect(await permission('127.0.0.1')).toBe(false); expect(calls).toHaveLength(0); }
    console.log('NATIVE_STAGE SITE_ALLOW: 在 Chrome 原生权限弹窗选择允许'); await settings.getByRole('button', { name: '保存分析模式与授权' }).click(); await expect(settings.locator('.automation-settings [role="status"]')).toContainText('分析模式已保存'); expect(await permission('127.0.0.1')).toBe(true);
    const candidate = await harness.context.newPage(); await candidate.goto(sourceUrl); await expect(candidate.locator('[data-ideaclip-assist]')).toHaveCount(1); expect(calls).toHaveLength(0); // native dynamic registration, no executeScript substitution
    await collect('原生授权后保存'); let center = await tasks(); await expect.poll(async () => (await records()).filter(r => r.state === 'done').length).toBe(1); expect(calls).toHaveLength(1); expect(calls[0]).not.toContain('image_url');
    await center.getByRole('button', { name: '暂停自动分析', exact: true }).click(); await collect('原生暂停待恢复'); await expect.poll(async () => (await records()).filter(r => r.state === 'paused').length).toBe(1); expect(calls).toHaveLength(1); await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect.poll(async () => (await records()).filter(r => r.state === 'done').length).toBe(2);
    hold = true; await collect('原生取消运行'); await expect.poll(() => calls.length).toBe(3); await center.locator('.task-row').filter({ hasText: '原生取消运行' }).getByRole('button', { name: '取消任务', exact: true }).click(); await expect.poll(async () => (await records()).filter(r => r.state === 'cancelled').length).toBe(1); await expect.poll(() => held[0]?.destroyed).toBe(true);
    await center.getByRole('button', { name: '恢复未发送任务' }).click(); await collect('原生关闭运行'); await expect.poll(() => calls.length).toBe(4); await settings.getByRole('switch').click(); await expect.poll(async () => (await records()).filter(r => r.state === 'failed').length).toBe(1); await collect('AI关闭后保存'); expect(calls).toHaveLength(4); expect((await records()).length).toBe(4);
    hold = false; await settings.getByRole('switch').click(); await center.getByRole('button', { name: '恢复未发送任务' }).click();
    await settings.evaluate(async () => { const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ideaclip'); r.onsuccess = () => resolve(r.result); }); const tx = database.transaction('aiUsage', 'readwrite'); tx.objectStore('aiUsage').put({ id: 'native-budget-fixture', noteId: 'local-budget', day: new Date().toISOString().slice(0, 10), createdAt: Date.now(), model: 'local-mock', status: 'failed', reservedMicros: 1000000, estimatedInput: 1, maxOutput: 1 }); await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); database.close(); });
    await collect('原生预算耗尽'); await expect.poll(async () => (await records()).find(r => r.errorCode === 'budget')?.state).toBe('paused'); expect(calls).toHaveLength(4);
    console.log('NATIVE_STAGE SITE_REVOKE: 使用真实 Chrome permissions.remove 撤销网站，不替换 API'); expect(await settings.evaluate(() => chrome.permissions.remove({ origins: ['http://127.0.0.1/*'] }))).toBe(true); expect(await permission('127.0.0.1')).toBe(false); expect(await permission('localhost')).toBe(true); await expect(center.getByText(/权限被撤销/).first()).toBeVisible(); await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect(center.getByRole('alert')).toContainText('网站权限已撤销'); expect(calls).toHaveLength(4);
    const prior = (await records()).map(r => ({ id: r.id, state: r.state })).sort((a, b) => a.id.localeCompare(b.id)); const profile = harness.profile;
    await harness.context.close(); harness = await collectionHarness(profile, true); await fence(); await openSettings(); center = await tasks(); await expect.poll(async () => (await records()).map(r => ({ id: r.id, state: r.state })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(prior); expect(calls).toHaveLength(4);
    // CDP loadUnpacked is ephemeral and drops host grants on reload. Do not mock
    // them back: absence must fail closed. Normal installed-profile persistence
    // remains a separate manual release check.
    expect(await permission('localhost')).toBe(false); await center.getByRole('button', { name: '恢复未发送任务' }).click(); await expect(center.getByRole('alert')).toContainText('授权失效'); expect(calls).toHaveLength(4);
    await center.screenshot({ path: info.outputPath('native-task-center.png'), fullPage: true }); console.log('NATIVE_PERMISSION_ACCEPTANCE_PASSED', JSON.stringify({ modelRequests: calls.length, permissionMocks: 0, registeredInjectionMocks: 0 }));
  } finally { await harness.context.close(); held.forEach(r => r.destroy()); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
