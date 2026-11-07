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
  PROXY_UNREACHABLE:'本地代理不可达或连接中断，请核对服务和端口。',
  PROXY_AUTH_FAILED:'本地代理 Origin 或 Bearer 认证失败，请核对扩展ID和代理密钥。',
  DNS_LOOKUP_FAILED:'Brave DNS 解析失败，请检查本机DNS和网络。',
  DNS_ADDRESS_BLOCKED:'DNS 公共IP安全校验拒绝，未放宽SSRF规则。',
  TCP_CONNECT_FAILED:'TCP连接失败，请检查DNS结果与Node直连网络。',
  TLS_HANDSHAKE_FAILED:'TLS握手失败，请检查网络路径。',
  TLS_CERTIFICATE_FAILED:'TLS证书验证失败，已停止连接；禁止关闭证书校验。',
  UPSTREAM_TIMEOUT:'上游连接或响应超时，未自动重试。',
  CLIENT_TIMEOUT:'浏览器研究请求超时，结果未知，未自动重试。',
  REQUEST_CANCELLED:'研究已停止：用户取消、权限撤销或配置变化，未自动重试。',
  SEARCH_AUTH_FAILED:'搜索服务拒绝凭据，请核对服务端配置；未自动重试。',
  SEARCH_QUOTA_EXCEEDED:'搜索额度不足或请求频率受限，请核对服务商账户；未自动重试。',
  SEARCH_HTTP_ERROR:'搜索服务HTTP状态异常，未自动重试。',
  SEARCH_RESPONSE_INVALID:'代理响应解析失败或搜索响应格式无效，未自动重试。',
  SEARCH_RESULT_EMPTY:'Brave返回0条搜索结果。',
  SEARCH_RESULT_FILTERED:'Brave返回结果，但来源白名单或URL安全过滤后为0条。',
  UNKNOWN:'研究请求中断阶段无法确认，未自动重试。',
} as const;
export type ResearchErrorCode = keyof typeof MESSAGES;
const stages=['proxy','auth','search','dns','safety','tcp','tls','http','parse','client','environment'] as const;
export type FailureStage=typeof stages[number];
const stageOf:Partial<Record<ResearchErrorCode,FailureStage>>={PROXY_UNREACHABLE:'proxy',PROXY_AUTH_FAILED:'auth',DNS_LOOKUP_FAILED:'dns',DNS_ADDRESS_BLOCKED:'safety',TCP_CONNECT_FAILED:'tcp',TLS_HANDSHAKE_FAILED:'tls',TLS_CERTIFICATE_FAILED:'tls',UPSTREAM_TIMEOUT:'http',CLIENT_TIMEOUT:'client',REQUEST_CANCELLED:'client',SEARCH_AUTH_FAILED:'http',SEARCH_QUOTA_EXCEEDED:'http',SEARCH_HTTP_ERROR:'http',SEARCH_RESPONSE_INVALID:'parse'};
export class ResearchFailure extends Error {
  readonly stage:FailureStage;readonly mayHaveSent:boolean;readonly outcomeUnknown:boolean;
  constructor(readonly code:ResearchErrorCode,stage:FailureStage=stageOf[code]??'proxy') {
    const preSend=['auth','dns','safety','tcp','tls'].includes(stage);const unknown=['proxy','client'].includes(stage);
    super(`${MESSAGES[code]} 安全错误代码：${code}；失败阶段：${stage}；是否可能已发送到Brave：${preSend?'否（按已知阶段）':unknown?'未知':'可能'}；是否可能消耗额度：${preSend?'此阶段未发送搜索':unknown?'未知':'可能'}；允许免费重测：仅DNS/TCP/TLS诊断；下一步：先检查免费网络诊断，付费搜索须重新预览确认。本地预留不是实际扣费。`);
    this.stage=stage;this.mayHaveSent=!preSend;this.outcomeUnknown=['UPSTREAM_TIMEOUT','CLIENT_TIMEOUT','REQUEST_CANCELLED','PROXY_UNREACHABLE','UNKNOWN','SEARCH_RESPONSE_INVALID'].includes(code)&&!preSend;
  }
}
export function proxyFailure(code:unknown,diagnostic?:unknown):ResearchFailure {
  const normalized=String(code).replaceAll('-','_');
  const stage=diagnostic&&typeof diagnostic==='object'?(diagnostic as {stage?:unknown}).stage:undefined;
  return new ResearchFailure(Object.hasOwn(MESSAGES,normalized)?normalized as ResearchErrorCode:normalized==='cancelled_or_timeout'?'timeout':'UNKNOWN',stages.includes(stage as FailureStage)?stage as FailureStage:undefined);
}
