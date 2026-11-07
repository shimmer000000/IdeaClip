import type { AIConfig } from './config';
export interface Completion { text: string; inputTokens?: number; outputTokens?: number }
export type TokenUsage=Pick<Completion,'inputTokens'|'outputTokens'>;
export function safeTokenUsage(value:TokenUsage|undefined):TokenUsage {const token=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<100000000?v:undefined;const inputTokens=token(value?.inputTokens),outputTokens=token(value?.outputTokens);return {...(inputTokens===undefined?{}:{inputTokens}),...(outputTokens===undefined?{}:{outputTokens})};}
export interface AITransport { complete(config: AIConfig, key: string, messages: unknown[], signal: AbortSignal): Promise<Completion> }
export class RequestFailure extends Error { constructor(readonly code: string, message: string,readonly diagnostic?:{usage?:TokenUsage;responseReceived?:boolean}) { super(message); } }
export function chatTransport(fetcher: typeof fetch = fetch): AITransport {
  return { async complete(config, key, messages, signal) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }; if (config.auth === 'bearer') headers.Authorization = `Bearer ${key}`;
    let response: Response;
    try {
      response = await fetcher(config.endpoint, { method: 'POST', headers, body: JSON.stringify({ model: config.model, messages, response_format: { type: 'json_object' }, [config.outputParameter]: config.maxOutput, stream: false, ...(config.provider === 'openai' ? { store: false } : {}), ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}) }), signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    } catch { throw new RequestFailure('network', '网络请求失败、被取消或遇到重定向；客户端不会自动重试。'); }
    if (!response.ok || response.redirected || response.type === 'opaqueredirect') { await response.body?.cancel().catch(() => {}); throw new RequestFailure('http', `服务商请求失败（HTTP ${response.status}），未读取错误正文，也未跟随重定向。`); }
    const reader = response.body?.getReader(); if (!reader) throw new RequestFailure('response', '服务商返回空响应。');
    const chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > 1024 * 1024) throw new RequestFailure('response', '服务商响应超过 1 MiB 安全上限。'); chunks.push(next.value); } }
    catch(error){if(error instanceof RequestFailure)throw error;throw new RequestFailure('response_read','服务商响应流读取失败，未取得完整响应；不自动重试。');}
    finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let raw:string;try{raw=new TextDecoder('utf-8', { fatal: true }).decode(bytes);}catch{throw new RequestFailure('response_encoding','服务商响应不是有效 UTF-8，未处理报告。',{responseReceived:true});}
    if (key && raw.includes(key)) throw new RequestFailure('credential', '响应包含凭据，已丢弃，未保存或显示。');
    let data; try { data = JSON.parse(raw); } catch { throw new RequestFailure('response_json', '服务商外层响应不是有效 JSON，未处理报告。',{responseReceived:true}); }
    const usage=safeTokenUsage({inputTokens:data?.usage?.prompt_tokens,outputTokens:data?.usage?.completion_tokens});const diagnostic={usage,responseReceived:true};
    const choice = data?.choices?.[0];
    if (key && typeof choice?.message?.content === 'string' && choice.message.content.includes(key)) throw new RequestFailure('credential', '响应包含凭据，已丢弃，未保存或显示。');
    if(choice?.finish_reason==='length')throw new RequestFailure('response_truncated','模型输出达到上限而被截断；未生成有效报告，不自动重试。',diagnostic);
    if (choice?.finish_reason !== 'stop' || choice?.message?.refusal || choice?.message?.tool_calls || typeof choice?.message?.content !== 'string') throw new RequestFailure('response_content', '模型拒绝或返回不支持的内容/工具调用；未生成有效报告。',diagnostic);
    return { text: choice.message.content,...usage };
  } };
}
