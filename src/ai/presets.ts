import { DEFAULT_CONFIG, PROVIDERS, type AIConfig, type Provider } from './config';

// Application-owned, dated reference values. Never contain credentials or consent.
export const PROVIDER_PRESETS = {
  openai: {
    id: 'openai-luna', name: 'OpenAI · GPT-6 Luna（经济型）',
    model: 'gpt-6-luna', inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5,
    outputParameter: 'max_completion_tokens',
    source: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
    priceNote: '标准文本价格；推理 Token 可能占用输出预算，实际输出仍受所选分析模板上限限制。',
  },
  deepseek: {
    id: 'deepseek-flash', name: 'DeepSeek · Flash（非思考）',
    model: 'deepseek-flash', inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2,
    outputParameter: 'max_tokens',
    source: 'https://api-docs.deepseek.com/quick_start/pricing/',
    priceNote: '按高峰、未命中缓存价格保守估算，不自动套用低峰或缓存折扣。',
  },
} as const;
export const PRESET_CHECKED_AT = '2026-11-09';

export function providerPreset(provider: Provider) {
  return provider === 'custom' ? null : PROVIDER_PRESETS[provider];
}

export function applyProviderPreset(current: AIConfig, provider: Provider): AIConfig {
  const preset = providerPreset(provider);
  // Preserve an existing spending limit, including zero. No ledger or storage writes.
  const dailyBudgetUsd = !current.version && current.dailyBudgetUsd === 0 ? 0.1 : current.dailyBudgetUsd;
  return {
    ...DEFAULT_CONFIG, version: current.version, provider, endpoint: PROVIDERS[provider],
    model: preset?.model ?? '', timeoutMs: 120000, maxOutput: 8192, dailyBudgetUsd,
    inputUsdPerMillion: preset?.inputUsdPerMillion ?? 0,
    outputUsdPerMillion: preset?.outputUsdPerMillion ?? 0,
    outputParameter: preset?.outputParameter ?? 'max_tokens',
    // Image support is a separate user decision, even when the model supports it.
    vision: false,
  };
}
