const MESSAGES = {
  search_not_configured: '缺少搜索服务配置：请在本地服务窗口填写 Brave Key；不会自动测试或搜索。',
  search_auth: '搜索服务拒绝凭据，请核对服务端配置；未自动重试。',
  search_quota: '搜索额度不足或请求频率受限，请核对服务商账户；未自动重试。',
  search_unavailable: '搜索服务暂时不可用；已发请求可能计费，未自动重试。',
  search_invalid: '搜索服务拒绝请求参数；未自动重试。',
  search_budget: '本地代理今日搜索次数已达上限；未发送上游请求。',
  authorization_denied: '代理访问密钥或端点不匹配，请重新配置。',
  request_rejected: '代理安全检查或请求失败，未自动重试。',
  timeout: '研究请求超时或取消，费用可能已产生；未自动重试。',
} as const;
export type ResearchErrorCode = keyof typeof MESSAGES;
export class ResearchFailure extends Error {
  constructor(readonly code:ResearchErrorCode) { super(MESSAGES[code]); }
}
export function proxyFailure(code:unknown):ResearchFailure {
  const normalized=String(code).replaceAll('-','_');
  return new ResearchFailure(Object.hasOwn(MESSAGES,normalized)?normalized as ResearchErrorCode:normalized==='cancelled_or_timeout'?'timeout':'request_rejected');
}
