import type { Note } from '../storage';
export type AnalysisMode = 'manual' | 'after-save' | 'assist';
export type TaskState = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled' | 'paused';
export const MODES = { manual: '手动模式', 'after-save': '保存后自动分析', assist: '浏览辅助模式' };
export const STATES: Record<TaskState, string> = { waiting: '等待', running: '运行', done: '完成', failed: '失败', cancelled: '已取消', paused: '已暂停' };
export interface AutoPolicy {
  id: 'general'; mode: AnalysisMode; autoEnabled: boolean; paused: boolean; reason: string;
  allowHosts: string[]; denyHosts: string[]; allowManual: boolean;
  consentId: string; configVersion: string; credentialVersion: string | null; sessionId: string;
  perTaskMicros: number; dailyBudgetMicros: number; acceptedAt: number;
}
export const DEFAULT_POLICY: AutoPolicy = { id: 'general', mode: 'manual', autoEnabled: false, paused: false, reason: '', allowHosts: [], denyHosts: [], allowManual: false, consentId: '', configVersion: '', credentialVersion: null, sessionId: '', perTaskMicros: 0, dailyBudgetMicros: 0, acceptedAt: 0 };
export interface AITask {
  id: string; dedupeKey: string; noteId: string; revision: number; snapshotHash: string;
  state: TaskState; reason: string; errorCode: string; source: 'save' | 'assist';
  consentId: string; sessionId: string; createdAt: number; updatedAt: number;
  attemptId: string | null; lastAttemptId: string | null; resultId: string | null; feeUnknown: boolean; execution: 'auto' | 'manual';
}
export interface AutomaticAuthority { taskId: string; consentId: string; sessionId: string; credentialVersion: string | null; manualRetry?: boolean }
export class QueueFailure extends Error { constructor(readonly code: string, message: string) { super(message); } }
export function parseHosts(text: string): string[] {
  const hosts = text.split(/[\n,，;；]/).map(value => value.trim()).filter(Boolean).map(value => {
    let url: URL; try { url = new URL(value.includes('://') ? value : `https://${value}`); } catch { throw new Error('请填写有效的精确域名，每行一个。'); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9.-]+$/.test(url.hostname) || url.hostname.includes('..')) throw new Error('域名不允许路径、端口、通配符或凭据。子域请单独填写。');
    return url.hostname;
  });
  if (hosts.length > 50) throw new Error('白名单或黑名单最多 50 个域名。');
  return [...new Set(hosts)];
}
export function sensitivePage(url: string, title = '', excerpt = ''): boolean {
  let parsed: URL; try { parsed = new URL(url); } catch { return !!url; }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return true;
  if (/(bank|banking|icbc|ccb\.com|boc\.cn|cmbchina|chase\.com|hsbc|wellsfargo|paypal|alipay|(^|\.)(mail|gmail|outlook|webmail|protonmail|accounts|login|wallet|vault)(\.|$))/i.test(parsed.hostname)) return true;
  if (/(^|\/)(login|signin|sign-in|password|passwords|account|accounts|bank|banking|inbox|mail|webmail|checkout|payment|payments|transfer|wallet|settings|tokens|oauth|auth|dashboard|admin|console|billing|profile|app)(\/|$)/i.test(parsed.pathname)) return true;
  if ([...parsed.searchParams.keys()].some(key => /token|secret|password|credential|session|auth|api.?key|signature|code/i.test(key))) return true;
  return /密码|验证码|收件箱|私人邮箱|银行账户|账户余额|登录|信用卡|sign\s?in|log\s?in|inbox|account balance|credit card|password/i.test(title) || /(?:密码|验证码|卡号|余额)\s*[:：]|authorization\s*:\s*bearer|one.?time.?password/i.test(excerpt);
}
export function sourceProblem(note: Pick<Note, 'url' | 'title' | 'body' | 'content'>, policy: Pick<AutoPolicy, 'allowHosts' | 'denyHosts' | 'allowManual'>): string {
  if (!note.url) return policy.allowManual && !/密码|验证码|卡号|账户余额|私人邮箱/i.test(note.title + note.body + note.content) ? '' : '无来源灵感未获自动发送授权，或包含敏感字段。';
  if (sensitivePage(note.url, note.title, note.body + '\n' + note.content)) return '敏感页面或敏感字段，自动分析已阻止。';
  const host = new URL(note.url).hostname;
  if (policy.denyHosts.some(denied => host === denied || host.endsWith('.' + denied))) return '来源命中黑名单，未发送。';
  return policy.allowHosts.includes(host) ? '' : '来源不在精确域名白名单，未发送。';
}
export function candidateKind(url: string, title: string, excerpt: string): string | null {
  if (sensitivePage(url, title, excerpt)) return null;
  const parsed = new URL(url); const text = (title + '\n' + excerpt).slice(0, 12000);
  if (parsed.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/?$/.test(parsed.pathname)) return 'GitHub 项目';
  if (/(^|\.)(x|twitter)\.com$/.test(parsed.hostname)) return /\/status\/\d+/.test(parsed.pathname) && /创业|商业|产品|盈利|用户需求|获客|saas|startup|business|revenue|customer/i.test(text) ? 'X 商业创意帖子' : null;
  if (/创业|商业模式|盈利模式|验证需求|startup|entrepreneur|business model/i.test(text)) return '创业文章';
  if (/\bsaas\b|software as a service|subscription|按月订阅|订阅服务|云端产品/i.test(text)) return 'SaaS 产品';
  return /工具|生成器|插件|tool\b|generator|productivity/i.test(text) ? '工具网站' : null;
}
export function sourceOrigins(hosts: string[]) { return hosts.map(host => `${['localhost', '127.0.0.1'].includes(host) ? 'http' : 'https'}://${host}/*`); }
