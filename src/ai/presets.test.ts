import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, validateConfig } from './config';
import { applyProviderPreset, providerPreset, PROVIDER_PRESETS } from './presets';

describe('0.2.8 服务商预设', () => {
  it.each(['openai', 'deepseek'] as const)('%s 生成可保存的完整配置且不修改原值', provider => {
    const old = { ...DEFAULT_CONFIG }, next = applyProviderPreset(old, provider);
    expect(validateConfig(next)).toEqual(next);
    expect(next.model).toBe(PROVIDER_PRESETS[provider].model);
    expect(next.auth).toBe('bearer'); expect(next.vision).toBe(false);
    expect(next.maxOutput).toBe(8192); expect(next.timeoutMs).toBe(120000);
    expect(old).toEqual(DEFAULT_CONFIG);
  });
  it.each([0, 0.003, 0.1, 3])('保留已有每日预算 %s，不提额或修改版本', dailyBudgetUsd => {
    const next = applyProviderPreset({ ...DEFAULT_CONFIG, version: 'saved-version', dailyBudgetUsd }, 'deepseek');
    expect(next.dailyBudgetUsd).toBe(dailyBudgetUsd); expect(next.version).toBe('saved-version');
  });
  it('不同服务商的模型、单价、输出参数不会混用，关闭原图像选择', () => {
    const openai = applyProviderPreset({ ...DEFAULT_CONFIG, vision: true }, 'openai');
    const deepseek = applyProviderPreset(openai, 'deepseek');
    expect(openai).toMatchObject({ model: 'gpt-6-luna', inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5, outputParameter: 'max_completion_tokens' });
    expect(deepseek).toMatchObject({ model: 'deepseek-flash', inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2, outputParameter: 'max_tokens', vision: false });
  });
  it('自定义不能沿用官方模型、端点或单价；没有假设的通用预设', () => {
    const custom = applyProviderPreset(applyProviderPreset(DEFAULT_CONFIG, 'openai'), 'custom');
    expect(custom).toMatchObject({ endpoint: '', model: '', inputUsdPerMillion: 0, outputUsdPerMillion: 0, vision: false });
    expect(providerPreset('custom')).toBeNull(); expect(() => validateConfig(custom)).toThrow();
  });
  it('预设及生成配置没有凭据、图像授权或执行同意字段', () => {
    for (const provider of ['openai', 'deepseek'] as const) {
      const json = JSON.stringify(applyProviderPreset(DEFAULT_CONFIG, provider));
      for (const key of ['apiKey', 'credential', 'persistent', 'acknowledged', 'authorized']) expect(json).not.toContain(key);
    }
  });
});
