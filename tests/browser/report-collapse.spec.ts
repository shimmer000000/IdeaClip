import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { collectionHarness } from './collection-harness';
import { seedLibrary } from './library-fixture';
import { BUILTINS, BUSINESS_ID, LEAN_ID, skillMarkdown, type Skill } from '../../src/skills/model';
import { markdown } from '../../src/ai/report';
import { mockReport } from '../ai-fixture';
import type { Analysis } from '../../src/storage';

let h: Awaited<ReturnType<typeof collectionHarness>>, page: Page;
const outbound: string[] = [];
const original = mockReport();
original.sections.summary = [{ kind: 'fact', text: '来源作者陈述，未独立核验。', evidence: '合成逐字摘录' }, { kind: 'inference', text: '合成推测', evidence: null }];
function structured(id: string, template: Skill, createdAt: number): Analysis {
  const skillReport = { schemaVersion: 2 as const, sections: Object.fromEntries(template.sections.map(s => [s.key, [{ kind: 'hypothesis' as const, text: '合成栏目建议，待验证。', evidence: null }]])) };
  return { id, noteId: 'n-00005', createdAt, model: 'mock-display-only', template, skillReport, content: skillMarkdown(skillReport, template, "mock-display-only", createdAt) };
}
const lean = BUILTINS.find(s => s.id === LEAN_ID)!;
const reports: Analysis[] = [
  structured('fold15-current', BUILTINS.find(s => s.id === BUSINESS_ID)!, 1),
  structured('fold06-current', lean, 2),
  structured('fold03-custom', { ...lean, id: 'custom-readonly-report', name: '自定义长栏目模板', builtin: false, sections: lean.sections.slice(0, 3).map((s, i) => ({ ...s, label: `自定义栏目${i + 1}：长标题换行与键盘验收` })) }, 3),
  { id: 'fold15-legacy', noteId: 'n-00005', createdAt: 4, report: original, content: markdown(original, "mock-display-only", 4) },
  { id: 'foldmd-legacy', noteId: 'n-00005', createdAt: 5, content: '# 旧版Markdown\n\n原显示保持；<script>作为文本显示</script>。' },
];
async function blockNetwork() {
  await h.context.route(/^https?:\/\//, route => { outbound.push(route.request().url()); return route.abort(); });
  await h.context.addInitScript(() => { navigator.clipboard.writeText = async text => { (window as any).collapseClipboard = text; }; });
}
async function open(id: string) {
  await page.goto(`chrome-extension://${h.extensionId}/analysis.html?noteId=n-00005&report=${id}`);
  await expect(page.locator('.ai-report')).toBeVisible();
}
test.beforeEach(async () => {
  outbound.length = 0; h = await collectionHarness(); await blockNetwork(); page = await h.context.newPage();
  await page.goto(`chrome-extension://${h.extensionId}/notes.html`); await expect(page.getByRole('heading', { name: '灵感管理中心', exact: true })).toBeVisible();
  await seedLibrary(page, 8);
  await page.evaluate(async rows => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ideaclip'); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction('analyses', 'readwrite'); for (const row of rows) tx.objectStore('analyses').put(row);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  }, reports);
});
test.afterEach(async () => { expect(outbound).toEqual([]); await h.context.close(); });

for (const [id, count] of [['fold15-current', 15], ['fold06-current', 6], ['fold03-custom', 3], ['fold15-legacy', 15]] as const) test(`0.2.9 ${id}默认折叠/独立及多项展开/全部切换`, async ({}, info) => {
  await open(id); const toggles = page.locator('.ai-section-toggle'), contents = page.locator('.ai-section-content');
  await expect(toggles).toHaveCount(count); await expect(page.locator('.ai-section-toggle[aria-expanded="true"]')).toHaveCount(0);
  await expect(contents.first()).toBeHidden(); await expect(toggles.first().locator('.ai-section-number')).toHaveText('01');
  await expect(toggles.last().locator('.ai-section-number')).toHaveText(String(count).padStart(2, '0'));
  await expect(toggles.first().locator('.ai-section-count')).toHaveText(id === 'fold15-legacy' ? '2 条' : '1 条');
  await toggles.first().click(); await toggles.nth(1).click(); await expect(contents.first()).toBeVisible(); await expect(contents.nth(1)).toBeVisible(); await expect(contents.nth(2)).toBeHidden();
  await toggles.first().click(); await expect(contents.first()).toBeHidden(); await expect(contents.nth(1)).toBeVisible();
  await page.getByRole('button', { name: '全部展开', exact: true }).click(); await expect(page.locator('.ai-section-toggle[aria-expanded="true"]')).toHaveCount(count);
  for (const content of await contents.all()) await expect(content).toBeVisible();
  if (id === 'fold15-legacy') { await expect(page.locator('.ai-claim.fact blockquote')).toHaveText('来源摘录：合成逐字摘录'); expect(await page.locator('.ai-claim.inference').first().evaluate(e => getComputedStyle(e).borderLeftColor)).not.toBe(await page.locator('.ai-claim.hypothesis').first().evaluate(e => getComputedStyle(e).borderLeftColor)); }
  await page.getByRole('button', { name: '全部折叠', exact: true }).click(); await expect(page.locator('.ai-section-toggle[aria-expanded="true"]')).toHaveCount(0);
  if (id === 'fold06-current') await page.locator('.ai-report').screenshot({ path: info.outputPath('six-sections-collapsed.png') });
});

test('0.2.9切换历史版本和关闭重开重置折叠；纯Markdown保持原显示', async () => {
  await open('fold15-current'); await page.getByRole('button', { name: '全部展开', exact: true }).click();
  const history = page.locator('.ai-history'); await history.getByRole('button', { name: /fold06-c/ }).click();
  await expect(page.locator('.ai-section-toggle')).toHaveCount(6); await expect(page.locator('.ai-section-toggle[aria-expanded="true"]')).toHaveCount(0);
  await page.locator('.ai-section-toggle').first().click(); await history.getByRole('button', { name: /fold15-c/ }).click();
  await expect(page.locator('.ai-section-toggle')).toHaveCount(15); await expect(page.locator('.ai-section-toggle[aria-expanded="true"]')).toHaveCount(0);
  await history.getByRole('button', { name: /foldmd-l/ }).click(); await expect(page.locator('.ai-report > pre')).toHaveText(reports[4].content); await expect(page.locator('.ai-report-controls')).toHaveCount(0);
  await open('fold06-current'); await page.getByRole('button', { name: '全部展开', exact: true }).click();
  const profile = h.profile; await h.context.close(); h = await collectionHarness(profile); await blockNetwork(); page = await h.context.newPage(); await open('fold06-current');
  await expect(page.locator('.ai-section-toggle')).toHaveCount(6); await expect(page.locator('.ai-section-toggle[aria-expanded="true"]')).toHaveCount(0); await expect(page.locator('.ai-history button')).toHaveCount(5);
});

test('0.2.9折叠不改变复制/导出全文，键盘焦点与窄屏正常，不请求AI', async ({}, info) => {
  await open('fold15-legacy'); const first = page.locator('.ai-section-toggle').first();
  await first.focus(); await first.press('Enter'); await expect(first).toHaveAttribute('aria-expanded', 'true');
  await first.press('Space'); await expect(first).toHaveAttribute('aria-expanded', 'false'); await expect(first).toBeFocused();
  expect(await first.evaluate(e => getComputedStyle(e).outlineStyle)).toBe('solid');
  await page.getByRole('button', { name: '复制报告', exact: true }).click(); await expect(page.getByRole('status')).toHaveText('已复制报告。');
  expect(await page.evaluate(() => (window as any).collapseClipboard)).toBe(reports[3].content);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
  const file = await download, path = info.outputPath(file.suggestedFilename()); await file.saveAs(path); expect(await readFile(path, 'utf8')).toBe(reports[3].content);
  await page.getByRole('button', { name: '全部展开', exact: true }).click(); await page.getByRole('button', { name: '复制报告', exact: true }).click(); expect(await page.evaluate(() => (window as any).collapseClipboard)).toBe(reports[3].content);
  await open('fold03-custom'); await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.ai-report').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.ai-section-toggle').first().click(); await page.locator('.ai-report').screenshot({ path: info.outputPath('custom-narrow-expanded.png') });
});
