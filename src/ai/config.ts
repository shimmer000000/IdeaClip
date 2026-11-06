import { db } from '../storage';
import { announceAIChange } from './events';
export type Provider = 'openai' | 'deepseek' | 'custom';
export interface AIConfig {
  id: 'manual'; version: string; provider: Provider; endpoint: string; model: string;
  timeoutMs: number; maxOutput: number; dailyBudgetUsd: number; inputUsdPerMillion: number; outputUsdPerMillion: number;
  vision: boolean; imageTokenAllowance: number; auth: 'bearer' | 'none'; outputParameter: 'max_tokens' | 'max_completion_tokens';
}
export const PROVIDERS = { openai: 'https://api.openai.com/v1/chat/completions', deepseek: 'https://api.deepseek.com/chat/completions', custom: '' };
export const DEFAULT_CONFIG: AIConfig = { id: 'manual', version: '', provider: 'openai', endpoint: PROVIDERS.openai, model: '', timeoutMs: 60000, maxOutput: 4096, dailyBudgetUsd: 0, inputUsdPerMillion: 0, outputUsdPerMillion: 0, vision: false, imageTokenAllowance: 10000, auth: 'bearer', outputParameter: 'max_completion_tokens' };
export function endpointOf(value: string) {
  let url: URL; try { url = new URL(value); } catch { throw new Error('请填写完整 API 端点 URL。'); }
  const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.href.length > 2000) throw new Error('API 端点仅允许 HTTPS 或本机 HTTP，禁止凭据、查询参数和片段。');
  return url;
}
export function permissionOrigin(endpoint: string) { const url = endpointOf(endpoint); return `${url.protocol}//${url.hostname}/*`; }
export function validateConfig(config: AIConfig): AIConfig {
  if (!['openai', 'deepseek', 'custom'].includes(config.provider) || !['bearer', 'none'].includes(config.auth) || !['max_tokens', 'max_completion_tokens'].includes(config.outputParameter)) throw new Error('服务商配置无效。');
  const endpoint = endpointOf(config.endpoint).href;
  if (config.provider !== 'custom' && (endpoint !== PROVIDERS[config.provider] || config.auth !== 'bearer')) throw new Error('官方服务商必须使用其固定官方端点和 Bearer 认证。代理请选自定义兼容 API。');
  if (!config.model.trim() || config.model.length > 150 || /[\u0000-\u001f]/.test(config.model)) throw new Error('请填写有效模型名称。');
  for (const [value, min, max] of [[config.timeoutMs, 1000, 120000], [config.maxOutput, 256, 16384], [config.imageTokenAllowance, 1, 1000000]]) if (!Number.isInteger(value) || value < min || value > max) throw new Error('超时、输出上限或图像 Token 预算超出范围。');
  for (const value of [config.dailyBudgetUsd, config.inputUsdPerMillion, config.outputUsdPerMillion]) if (!Number.isFinite(value) || value <= 0 || value > 10000) throw new Error('请填写正数每日预算与输入/输出估算单价（统一 USD）。');
  if (typeof config.vision !== 'boolean') throw new Error('模型图像能力配置无效。');
  return { id: 'manual', version: config.version, provider: config.provider, endpoint, model: config.model.trim(), timeoutMs: config.timeoutMs, maxOutput: config.maxOutput, dailyBudgetUsd: config.dailyBudgetUsd, inputUsdPerMillion: config.inputUsdPerMillion, outputUsdPerMillion: config.outputUsdPerMillion, vision: config.vision, imageTokenAllowance: config.imageTokenAllowance, auth: config.auth, outputParameter: config.outputParameter };
}
export async function saveConfig(config: AIConfig, database = db) { const clean = validateConfig(config); await database.aiConfig.put({ ...clean, version: crypto.randomUUID() }); announceAIChange(); }
export async function hasPermission(endpoint: string) { return !!globalThis.chrome?.runtime?.id && chrome.permissions.contains({ origins: [permissionOrigin(endpoint)] }); }

// Credentials never enter Dexie, sync storage, reports, logs, or backups.
const SECRET = 'ideaclip-ai-credential';
export interface Credential { version: string; endpoint: string; value: string; persistent: boolean }
export async function saveCredential(endpoint: string, value: string, persistent: boolean) {
  if (!globalThis.chrome?.storage) throw new Error('密钥仅可在真实扩展环境中保存。');
  if ((value && !/^[\x21-\x7e]+$/.test(value)) || value.length > 1000) throw new Error('API Key 格式无效。');
  endpointOf(endpoint); announceAIChange();
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.remove(SECRET); await chrome.storage.session.remove(SECRET);
  if (value) await (persistent ? chrome.storage.local : chrome.storage.session).set({ [SECRET]: { version: crypto.randomUUID(), endpoint, value, persistent } satisfies Credential });
}
export async function getCredential(endpoint: string): Promise<Credential | null> {
  if (!globalThis.chrome?.storage) return null;
  const session = (await chrome.storage.session.get(SECRET))[SECRET] as Credential | undefined;
  const local = (await chrome.storage.local.get(SECRET))[SECRET] as Credential | undefined;
  const credential = session ?? local; return credential?.endpoint === endpoint ? credential : null;
}
