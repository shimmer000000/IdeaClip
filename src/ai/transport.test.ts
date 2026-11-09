import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, PROVIDERS } from './config';
import { chatTransport } from './transport';

// DeepSeek documents non-streaming keep-alive blank lines. No network calls.
it('IC-016：DeepSeek 保活空行和跨 UTF-8 分块的中文 JSON，保留实际 usage', async () => {
  const content = JSON.stringify({ conclusion: '来源作者主张，仍待验证。' });
  const bytes = new TextEncoder().encode('\n\r\n' + JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 37, completion_tokens: 19 },
  }) + '\r\n');
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
    start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); },
  }), { headers: { 'Content-Type': 'application/json' } }));
  const config = { ...DEFAULT_CONFIG, provider: 'deepseek' as const, endpoint: PROVIDERS.deepseek, model: 'deepseek-flash', outputParameter: 'max_tokens' as const };
  const result = await chatTransport(fetcher).complete(config, 'synthetic-ic016-ai-token', [{ role: 'user', content: '合成资料' }], new AbortController().signal);
  expect(result).toEqual({ text: content, inputTokens: 37, outputTokens: 19, finishReason: 'stop' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(PROVIDERS.deepseek);
  expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
  expect(JSON.parse(String(init!.body))).toMatchObject({ thinking: { type: 'disabled' }, stream: false, response_format: { type: 'json_object' }, max_tokens: 4096 });
});

it('IC-016：DeepSeek 429 不读取服务商错误正文、不自动重复请求', async () => {
  const response = new Response('provider-private-error-body', { status: 429 });
  const read = vi.spyOn(response, 'text');
  const fetcher = vi.fn<typeof fetch>(async () => response);
  await expect(chatTransport(fetcher).complete({ ...DEFAULT_CONFIG, provider: 'deepseek', endpoint: PROVIDERS.deepseek }, 'synthetic-ic016-ai-token', [], new AbortController().signal)).rejects.toMatchObject({ code: 'http', message: expect.stringContaining('HTTP 429') });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
});
