import { test, expect, type Page } from '@playwright/test';
import { collectionHarness } from './collection-harness';

let h: Awaited<ReturnType<typeof collectionHarness>>, page: Page;
let requests: string[];
test.beforeEach(async () => {
  requests = []; h = await collectionHarness();
  await h.context.route(/^https?:\/\//, r => { requests.push(r.request().url()); return r.abort(); });
  await h.context.addInitScript(() => {
    if (!globalThis.chrome?.runtime?.id) return;
    chrome.permissions.request = async () => true;
    chrome.permissions.contains = async () => true;
  });
  page = await h.context.newPage(); await page.goto(`chrome-extension://${h.extensionId}/settings.html`);
  await expect(page.getByLabel('AI 服务商', { exact: true })).toBeEnabled();
});
test.afterEach(async () => { expect(requests).toEqual([]); await h.context.close(); });
const field = (name: string) => page.getByLabel(`AI ${name}`, { exact: true });
const consent = () => page.getByRole('checkbox', { name: /我授权向上方指定端点/ });
const persist = () => page.getByRole('checkbox', { name: /长期本地保存密钥（默认关闭）/ });

test('0.2.8切换预设自动填模型价格，清空密钥/风险/图像/同意且零外发', async ({}, info) => {
  await field('服务商').selectOption('deepseek');
  await expect(field('模型名称')).toHaveValue('deepseek-flash'); await expect(field('输入单价')).toHaveValue('0.3'); await expect(field('输出单价')).toHaveValue('1.2'); await expect(field('输出参数')).toHaveValue('max_tokens');
  await field('每日预算').fill('0.037'); await field('API Key').fill('synthetic-only-key');
  await persist().check(); await page.getByRole('checkbox', { name: '我理解长期本地保存密钥的安全风险' }).check();
  await page.getByRole('checkbox', { name: /我已按服务商文档确认/ }).check(); await consent().check();
  await field('服务商').selectOption('openai');
  for (const [name, value] of [['模型名称', 'gpt-6-luna'], ['接口地址', 'https://api.openai.com/v1/chat/completions'], ['输入单价', '0.1'], ['输出单价', '0.5'], ['请求超时', '120000'], ['最大输出', '8192'], ['输出参数', 'max_completion_tokens'], ['每日预算', '0.037'], ['API Key', '']]) await expect(field(name)).toHaveValue(value);
  await expect(consent()).not.toBeChecked(); await expect(persist()).not.toBeChecked(); await expect(page.getByRole('checkbox', { name: /我已按服务商文档确认/ })).not.toBeChecked();
  await expect(page.getByRole('button', { name: '保存配置并授权域名' })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'AI 分析总开关' })).toHaveAttribute('aria-checked', 'false');
  await page.locator('.ai-preset-box').screenshot({ path: info.outputPath('provider-presets.png') });
  await field('输入单价').fill('0.2'); await expect(field('配置预设')).toHaveValue('');
  await field('配置预设').selectOption('openai-luna'); await expect(field('输入单价')).toHaveValue('0.1');
  await field('服务商').selectOption('custom'); await expect(field('模型名称')).toHaveValue(''); await expect(field('接口地址')).toHaveValue(''); await expect(field('输入单价')).toHaveValue('0'); await expect(field('输出单价')).toHaveValue('0');
});

test('0.2.8预设仅保存后生效；重开保留配置与预算，切换不写入或移交端点凭据', async () => {
  await field('服务商').selectOption('deepseek'); await field('每日预算').fill('0.025'); await field('API Key').fill('synthetic-endpoint-key'); await consent().check(); await page.getByRole('button', { name: '保存配置并授权域名' }).click();
  await expect(page.getByText(/保存成功：配置与域名授权已保存/)).toBeVisible();
  await field('服务商').selectOption('openai'); await expect(field('每日预算')).toHaveValue('0.025');
  await page.reload(); await expect(field('服务商')).toHaveValue('deepseek'); await expect(field('模型名称')).toHaveValue('deepseek-flash');
  await expect(field('每日预算')).toHaveValue('0.025'); await expect(field('API Key')).toHaveValue('');
  await field('服务商').selectOption('openai'); await consent().check(); await page.getByRole('button', { name: '保存配置并授权域名' }).click();
  await expect(page.getByRole('alert')).toContainText('保存失败'); // DeepSeek key must not be reused for OpenAI.
  await page.reload(); await expect(field('服务商')).toHaveValue('deepseek');
});

test('0.2.8旧自定义配置不自动套预设，重新填入仍须确认，窄屏可读', async ({}, info) => {
  await field('服务商').selectOption('custom'); await field('接口地址').fill('http://127.0.0.1:45678/chat/completions'); await field('模型名称').fill('synthetic-model'); await field('输入单价').fill('2'); await field('输出单价').fill('3'); await field('API Key').fill('synthetic-private-key'); await consent().check(); await page.getByRole('button', { name: '保存配置并授权域名' }).click();
  await expect(page.getByText(/保存成功：配置与域名授权已保存/)).toBeVisible(); await page.reload(); await expect(field('模型名称')).toHaveValue('synthetic-model'); await expect(field('输入单价')).toHaveValue('2');
  await field('服务商').selectOption('openai'); await consent().check(); await page.getByRole('button', { name: '重新填入预设' }).click(); await expect(consent()).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.ai-preset-box').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.ai-preset-box').screenshot({ path: info.outputPath('provider-presets-mobile.png') });
});
