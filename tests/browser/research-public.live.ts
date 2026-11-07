import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createResearchProxy, secureGet } from '../../tools/research-proxy';
import { sourceDigest, validateSource } from '../../src/research/online/model';
import { collectionHarness } from './collection-harness';
import { seedLibrary } from './library-fixture';

// Explicit opt-in: three public, free reads only. Never uses a search or AI key.
test('IC-016：三个真实公开来源经生产代理保存证据、哈希、历史，重启不重发', async ({}, info) => {
  test.skip(process.env.IDEACLIP_PUBLIC_VALIDATION !== 'IC-016', '仅在明确授权三个公开来源时单独运行');
  test.setTimeout(120_000);
  let harness = await collectionHarness();
  const base = `chrome-extension://${harness.extensionId}/`;
  const key = 'synthetic-ic016-local-proxy-token';
  const urls = ['https://github.com/shimmer000000/IdeaClip', 'https://obsidian.md/', 'https://paulgraham.com/ds.html'];
  const upstream = ['https://api.github.com/repos/shimmer000000/IdeaClip', ...urls.slice(1)];
  const calls: string[] = [], unexpected: string[] = [], errors: string[] = [];
  const proxy = createResearchProxy({ token: key, origins: [base.slice(0, -1)], hosts: ['github.com', 'obsidian.md', 'paulgraham.com'],
    get: async (url, headers, signal) => {
      if (!upstream.includes(url.href) || calls.includes(url.href) || calls.length >= 3) throw new Error('Live request outside the three approved URLs');
      calls.push(url.href);
      return secureGet(url, headers, signal);
    } });
  await new Promise<void>(r => proxy.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(proxy.address() as {port:number}).port}/research`;
  async function isolation() {
    // Native permission dialogs are not claimed as validated by this fixture.
    await harness.context.addInitScript(() => {
      if (!globalThis.chrome?.runtime?.id) return;
      chrome.permissions.request = async d => d.origins?.every(o => o === 'http://127.0.0.1/*') === true;
      chrome.permissions.contains = async () => true;
    });
    await harness.context.route('**/*', route => {
      const u = new URL(route.request().url());
      if (['http:', 'https:'].includes(u.protocol) && u.origin !== new URL(endpoint).origin) { unexpected.push(u.origin); return route.abort(); }
      return route.continue();
    });
    harness.context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  }
  async function rows(page: import('@playwright/test').Page, table: string) {
    return page.evaluate(async table => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ideaclip'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try { return await new Promise<Record<string, unknown>[]>((resolve, reject) => { const r = db.transaction(table).objectStore(table).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
      finally { db.close(); }
    }, table);
  }
  try {
    await isolation();
    let page = await harness.context.newPage();
    await page.goto(base + 'notes.html');
    await expect(page.getByRole('heading', {name:'灵感管理中心',exact:true})).toBeVisible();
    await seedLibrary(page, 8);
    await page.goto(base + 'notes.html?research&wizard&from=note&id=n-00005');
    await expect(page.getByLabel('向导研究名称', {exact:true})).toBeVisible();
    await page.getByLabel('向导研究名称', {exact:true}).fill('IC016 公开来源免费验收');
    await page.getByLabel('向导研究目标', {exact:true}).fill('核对三类公开来源的读取、证据与保存，不执行搜索或AI');
    await page.getByRole('button', {name:'保存目标并创建研究向导',exact:true}).click();
    await page.getByLabel('向导搜索关键词', {exact:true}).fill('');
    await page.getByRole('button', {name:'保存调查计划并确认范围',exact:true}).click();
    for (const [label, value] of [['研究代理端点',endpoint],['研究代理密钥',key],['研究允许域名','github.com\nobsidian.md\npaulgraham.com'],['每次研究请求估算USD','0'],['研究每日预算USD','0.1'],['研究超时毫秒','30000']]) await page.getByLabel(label,{exact:true}).fill(value);
    await page.getByRole('checkbox', {name:/我已确认代理可信/}).check();
    await page.getByRole('button', {name:'保存研究代理并授权域名'}).click();
    await expect(page.getByText(/研究配置保存成功/)).toBeVisible();
    await page.getByRole('button', {name:'检查连接（免费）'}).click();
    await expect(page.getByRole('status', {name:'研究连接状态'})).toHaveText('缺少搜索服务配置');
    expect(calls).toHaveLength(0);
    await page.getByRole('switch', {name:'联网研究总开关'}).click();
    await page.getByRole('button', {name:'范围已核对，进入资料采集',exact:true}).click();
    await page.getByLabel('联网研究问题', {exact:true}).fill('三类公开资料目前可以读取哪些内容，信息缺口是什么？');
    await page.getByLabel('研究搜索词', {exact:true}).fill('');
    await page.getByLabel('研究待读URL', {exact:true}).fill(urls.join('\n'));
    await page.getByRole('button', {name:'预览联网计划与费用'}).click();
    const dialog = page.getByRole('dialog', {name:'联网研究逐次确认'});
    for (const url of urls) await expect(dialog).toContainText(url);
    expect(calls).toHaveLength(0);
    await dialog.getByRole('checkbox', {name:/我确认本次计划/}).check();
    await dialog.getByRole('button', {name:'确认执行本次联网研究'}).click();
    await expect(page.getByText('联网研究完成，资料已保存；尚未调用AI综合。', {exact:true})).toBeVisible({timeout:80_000});
    const sources = (await rows(page, 'researchSources')).map(validateSource);
    expect(calls).toEqual(upstream);
    expect(sources).toHaveLength(3);
    const summary = [];
    for (const source of sources) {
      expect(['readable','partial']).toContain(source.status);
      expect(source.content.length).toBeGreaterThan(100);
      expect(source.excerpt.length).toBeGreaterThan(0);
      expect(source.content).toContain(source.excerpt);
      expect(source.hash).toBe(await sourceDigest(source));
      expect(source.collectedAt).toBeGreaterThan(Date.now() - 120_000);
      summary.push({url:source.url,title:source.title,type:source.type,status:source.status,publishedAt:source.publishedAt,collectedAt:new Date(source.collectedAt).toISOString(),characters:source.content.length,excerptCharacters:source.excerpt.length,hash:source.hash});
    }
    expect(sources.find(s=>s.type==='github')!.content).toContain('shimmer000000/IdeaClip');
    await page.getByRole('button', {name:'资料已保存，审核来源证据',exact:true}).click();
    await expect(page.getByRole('heading', {name:'5. 人工审核来源证据',exact:true})).toBeVisible();
    for (const checkbox of await page.getByRole('checkbox', {name:/审核来源：/}).all()) await checkbox.check();
    await page.getByRole('checkbox', {name:/我已人工审核所选来源/}).check();
    await page.getByRole('button', {name:'保存证据审核并进入AI综合',exact:true}).click();
    await expect(page.getByRole('heading', {name:'6. AI 综合研究',exact:true})).toBeVisible();
    const workflowUrl = page.url();
    const before = await rows(page, 'researchWorkflows');
    expect(before[0].history).toBeTruthy();
    expect(await rows(page, 'researchReports')).toHaveLength(0);
    await writeFile(info.outputPath('public-source-summary.json'), JSON.stringify(summary,null,2));
    const profile = harness.profile;
    await harness.context.close();
    harness = await collectionHarness(profile);
    await isolation();
    page = await harness.context.newPage();
    await page.goto(workflowUrl);
    await expect(page.getByRole('heading', {name:'6. AI 综合研究',exact:true})).toBeVisible();
    expect((await rows(page, 'researchSources')).map(s=>s.hash).sort()).toEqual(sources.map(s=>s.hash).sort());
    expect(await rows(page, 'researchWorkflows')).toEqual(before);
    expect(await rows(page, 'researchReports')).toHaveLength(0);
    expect(calls).toEqual(upstream);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await harness.context.close();
    proxy.closeAllConnections();
    await new Promise<void>(r=>proxy.close(()=>r()));
  }
});
