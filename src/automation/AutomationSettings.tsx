import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage';
import { getCredential, hasPermission } from '../ai/config';
import { DEFAULT_POLICY, MODES, parseHosts, sourceOrigins, type AnalysisMode, type AutoPolicy } from './model';
import { savePolicy } from './policy';
import { sessionId } from './signals';
import './automation.css';

export function AutomationSettings() {
  const stored = useLiveQuery(async () => (await db.autoPolicy.get('general')) ?? null);
  const config = useLiveQuery(() => db.aiConfig.get('manual')); const ai = useLiveQuery(() => db.settings.get('general'));
  const [mode, setMode] = useState<AnalysisMode>('manual'); const [enabled, setEnabled] = useState(false); const [hosts, setHosts] = useState(''); const [denied, setDenied] = useState(''); const [manual, setManual] = useState(false); const [cap, setCap] = useState('0'); const [ack, setAck] = useState(false); const [webAck, setWebAck] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => { if (stored) { setMode(stored.mode); setEnabled(stored.autoEnabled); setHosts(stored.allowHosts.join('\n')); setDenied(stored.denyHosts.join('\n')); setManual(stored.allowManual); setCap(String(stored.perTaskMicros / 1000000)); } }, [stored?.consentId, stored?.mode, stored?.autoEnabled]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setError(''); setMessage('');
    let allowHosts: string[]; let denyHosts: string[];
    try { allowHosts = parseHosts(hosts); denyHosts = parseHosts(denied); if (mode !== 'manual' && !allowHosts.length && !(mode === 'after-save' && manual)) throw new Error('请至少填写一个白名单域名，或明确允许无来源灵感。'); if (enabled && mode !== 'manual' && !ack) throw new Error('请确认自动发送范围与预算。'); if (mode === 'assist' && !webAck) throw new Error('请确认仅在这些网站使用本地规则提示。'); } catch (error) { setError(error instanceof Error ? error.message : '域名设置无效'); return; }
    setBusy(true);
    try {
      if (mode === 'assist' && !await chrome.permissions.request({ origins: sourceOrigins(allowHosts) })) throw new Error('网页域名授权被拒绝，未启用浏览辅助。');
      const session = await sessionId(); const automatic = mode !== 'manual' && enabled;
      const current = await db.aiConfig.get('manual'); const credential = current ? await getCredential(current.endpoint) : null;
      const perTask = Math.ceil(Number(cap) * 1000000);
      if (automatic && (!(await db.settings.get('general'))?.aiEnabled || !current || !(await hasPermission(current.endpoint)) || (current.auth === 'bearer' && !credential) || !Number.isSafeInteger(perTask) || perTask < 1 || perTask > Math.floor(current.dailyBudgetUsd * 1000000))) throw new Error('请先开启并授权 AI，填写有效单次自动费用上限（不得超过当前每日预算）。');
      const next: AutoPolicy = { ...DEFAULT_POLICY, mode, autoEnabled: automatic, allowHosts, denyHosts, allowManual: manual && mode === 'after-save', consentId: crypto.randomUUID(), configVersion: automatic ? current!.version : '', credentialVersion: automatic ? credential?.version ?? null : null, sessionId: session, perTaskMicros: automatic ? perTask : 0, dailyBudgetMicros: automatic ? Math.floor(current!.dailyBudgetUsd * 1000000) : 0, acceptedAt: Date.now() };
      await savePolicy(next, db, ack); const response = await chrome.runtime.sendMessage({ type: 'IC_AUTO_POLICY_CHANGED' });
      setAck(false); setWebAck(false); setMessage(response?.ok ? '分析模式已保存。只处理之后主动保存的版本；原等待任务需到任务中心人工恢复。' : '模式已保存，但网页脚本注册未完成；请检查网站权限后重新保存。');
    } catch (error) { setError(error instanceof Error ? error.message : '模式保存失败，未绕过授权。'); } finally { setBusy(false); }
  }
  return <section className="panel automation-settings"><h2>自动分析与浏览辅助</h2><p>默认手动模式。自动模式是持续发送授权，仅适用于你之后主动保存的灵感；草稿自动保留、浏览页面、批量分类或收藏操作不触发模型。</p><form onSubmit={event => { void save(event); }}><fieldset disabled={busy || stored === undefined}><label>分析模式<select aria-label="分析模式" value={mode} onChange={event => { setMode(event.target.value as AnalysisMode); setEnabled(false); setAck(false); setWebAck(false); }}>{Object.entries(MODES).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>
    {mode !== 'manual' && <><label className="check-line"><input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setAck(false); }} />开启自动分析（默认关闭）</label><div className="automation-domains"><label>域名白名单（精确主机，每行一个）<textarea aria-label="自动分析白名单" rows={4} value={hosts} onChange={event => { setHosts(event.target.value); setAck(false); setWebAck(false); }} placeholder="example.com&#10;github.com" /></label><label>域名黑名单（包含其子域，优先于白名单）<textarea aria-label="自动分析黑名单" rows={4} value={denied} onChange={event => { setDenied(event.target.value); setAck(false); setWebAck(false); }} /></label></div>{mode === 'after-save' && <label className="check-line"><input type="checkbox" checked={manual} onChange={event => { setManual(event.target.checked); setAck(false); }} />允许没有来源 URL 的手动灵感（敏感字段仍阻止）</label>}
    <p className="notice">密码、银行、私人邮箱、账户/支付/管理页面默认阻止，白名单不能覆盖内置敏感规则；规则可能误判或漏判，请用黑名单排除私人网站。自动分析绝不发送截图。子域需单独列出，Chrome 网站权限不区分端口。</p>{mode === 'assist' && <><p>浏览辅助仅在已授权白名单的 HTTPS 页面（本机可 HTTP）运行本地规则，识别工具、SaaS、GitHub、创业文章和 X 商业创意帖子。不采集浏览历史，不扫描其他标签页，不自动保存或上传。点击提示进入编辑页后，还需勾选本条入队并主动保存。</p><label className="check-line"><input type="checkbox" checked={webAck} onChange={event => setWebAck(event.target.checked)} />我授权在上方白名单网站显示本地规则建议，页面内容不自动上传</label></>}
    {enabled && <><label>单次自动分析费用预留上限（USD）<input aria-label="单次自动费用上限" type="number" min={0.000001} step="any" value={cap} onChange={event => { setCap(event.target.value); setAck(false); }} /></label><p>当前接收端点：{config?.endpoint || '尚未配置'}；模型：{config?.model || '未配置'}；每日共享预算 USD {config?.dailyBudgetUsd ?? 0}，输入/输出估算单价 {config?.inputUsdPerMillion ?? 0}/{config?.outputUsdPerMillion ?? 0} USD / 百万 Token。AI 总开关：{ai?.aiEnabled ? '已开启' : '已关闭'}。</p><label className="check-line"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />我明确授权自动发送白名单内主动保存版本的标题、采集正文、个人感悟和脱敏 URL（不含图片），接受上方端点、模型、单次上限和每日共享预算估算，理解失败/取消也可能计费</label><p className="muted">自动队列通过后台打开的任务中心标签页执行，请保持执行页打开。暂停或关闭可能取消正在请求的客户端；未知费用不自动重试。浏览器重启后需人工恢复，默认会话密钥可能需要重填；重新配置服务商后需重新确认本授权。</p></>}
    </>}
    <div className="ai-actions"><button className="primary" type="submit">保存分析模式与授权</button><a href="tasks.html">打开 AI 任务中心</a></div></fieldset></form>{message && <p role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}</section>;
}
