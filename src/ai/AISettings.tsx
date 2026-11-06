import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage';
import { DEFAULT_CONFIG, PROVIDERS, getCredential, permissionOrigin, saveConfig, saveCredential, validateConfig, type AIConfig, type Provider } from './config';
import { announceAIChange } from './events';
import './ai.css';

export function AISettings() {
  const stored = useLiveQuery(async () => (await db.aiConfig.get('manual')) ?? null);
  const usage = useLiveQuery(() => db.aiUsage.orderBy('createdAt').reverse().limit(20).toArray());
  const day = new Date().toISOString().slice(0, 10);
  const today = useLiveQuery(() => db.aiUsage.where('day').equals(day).toArray(), [day]);
  const [config, setConfig] = useState<AIConfig>({ ...DEFAULT_CONFIG }); const [key, setKey] = useState('');
  const [persistent, setPersistent] = useState(false); const [acknowledged, setAcknowledged] = useState(false); const [risk, setRisk] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => { if (stored) { setConfig(stored); void getCredential(stored.endpoint).then(credential => { setPersistent(credential?.persistent ?? false); setMessage(credential ? `此端点已有${credential.persistent ? '长期' : '会话'}凭据，密钥不会回显。` : '尚未保存此端点凭据。'); }).catch(() => setError('凭据状态读取失败。')); } }, [stored?.version]);
  function change<K extends keyof AIConfig>(name: K, value: AIConfig[K]) { setConfig(old => ({ ...old, [name]: value })); setAcknowledged(false); }
  function provider(value: Provider) { setConfig(old => ({ ...old, provider: value, endpoint: PROVIDERS[value], auth: 'bearer', outputParameter: value === 'openai' ? 'max_completion_tokens' : 'max_tokens', vision: false })); setKey(''); setAcknowledged(false); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setError(''); setMessage('');
    if (!acknowledged || (persistent && !risk)) { setError('请确认服务商授权和所选的本地密钥保存风险。'); return; }
    let clean: AIConfig; try { clean = validateConfig(config); } catch (error) { setError(error instanceof Error ? error.message : '配置无效。'); return; }
    setBusy(true);
    try {
      if (!globalThis.chrome?.runtime?.id || !await chrome.permissions.request({ origins: [permissionOrigin(clean.endpoint)] })) { setError('服务商域名授权被拒绝，配置未启用。'); return; }
      const previous = await getCredential(clean.endpoint); const value = key || previous?.value || '';
      if (clean.auth === 'bearer' && !value) throw new Error('请填写此端点的 API Key。');
      await saveCredential(clean.endpoint, clean.auth === 'none' ? '' : value, persistent); await saveConfig(clean); setKey(''); setAcknowledged(false); setMessage('配置与域名授权已保存；未发送测试请求。手动分析仍需每次确认；自动模式需重新授权。');
    } catch { setError('保存失败：请检查模型、凭据、存储及域名授权。不会发送任何测试请求。'); }
    finally { setBusy(false); }
  }
  async function clear() {
    setBusy(true); setError('');
    try { await saveCredential(stored?.endpoint || config.endpoint, '', false); if (stored?.endpoint) await chrome.permissions.remove({ origins: [permissionOrigin(stored.endpoint)] }); announceAIChange(); setKey(''); setMessage('密钥已清除，当前服务商域名授权已撤销，未完成请求已取消。'); }
    catch { setError('清除或撤销失败，请重试并检查扩展权限。'); } finally { setBusy(false); }
  }
  return <section className="panel ai-settings"><h2>AI 服务商与预算</h2><p>供手动分析及明确授权的自动队列复用。推荐使用自己管理的安全代理，在服务端保管真正的模型密钥；本插件不提供代理服务器。兼容 Chat Completions JSON 接口，不自动测试、不联网列出模型。</p><p className="notice">API Key 默认只存浏览器会话。长期本地保存不是保险箱：同一电脑上的恶意软件、扩展调试或配置文件泄露可能读取密钥。配置、凭据与预算账本不进入普通 ZIP；报告会进入备份。</p>
    <form onSubmit={event => { void save(event); }}><fieldset disabled={busy || stored === undefined}><div className="ai-fields"><label>服务商<select aria-label="AI 服务商" value={config.provider} onChange={event => provider(event.target.value as Provider)}><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="custom">自定义兼容 API / 安全代理</option></select></label><label>模型名称<input required aria-label="AI 模型名称" value={config.model} maxLength={150} onChange={event => change('model', event.target.value)} placeholder="按服务商文档填写，不预设模型能力" /></label><label className="wide">完整接口地址<input required aria-label="AI 接口地址" type="url" value={config.endpoint} disabled={config.provider !== 'custom'} onChange={event => change('endpoint', event.target.value)} /></label><label>认证方式<select aria-label="AI 认证方式" value={config.auth} disabled={config.provider !== 'custom'} onChange={event => change('auth', event.target.value as 'bearer' | 'none')}><option value="bearer">Bearer API Key</option><option value="none">代理自行鉴权（不发送 Key）</option></select></label><label>API Key<input aria-label="AI API Key" type="password" autoComplete="off" value={key} maxLength={1000} disabled={config.auth === 'none'} onChange={event => setKey(event.target.value)} placeholder="留空保留此端点已有密钥" /></label><label>请求超时（毫秒）<input aria-label="AI 请求超时" type="number" min={1000} max={120000} step={1000} value={config.timeoutMs} onChange={event => change('timeoutMs', Number(event.target.value))} /></label><label>单次最大输出 Token<input aria-label="AI 最大输出" type="number" min={256} max={16384} value={config.maxOutput} onChange={event => change('maxOutput', Number(event.target.value))} /></label><label>输出上限参数<select aria-label="AI 输出参数" value={config.outputParameter} onChange={event => change('outputParameter', event.target.value as AIConfig['outputParameter'])}><option value="max_completion_tokens">max_completion_tokens</option><option value="max_tokens">max_tokens</option></select></label><label>每日预算（USD / UTC 日）<input required aria-label="AI 每日预算" type="number" min={0.000001} max={10000} step="any" value={config.dailyBudgetUsd} onChange={event => change('dailyBudgetUsd', Number(event.target.value))} /></label><label>输入估算单价（USD / 百万 Token）<input required aria-label="AI 输入单价" type="number" min={0.000001} max={10000} step="any" value={config.inputUsdPerMillion} onChange={event => change('inputUsdPerMillion', Number(event.target.value))} /></label><label>输出估算单价（USD / 百万 Token）<input required aria-label="AI 输出单价" type="number" min={0.000001} max={10000} step="any" value={config.outputUsdPerMillion} onChange={event => change('outputUsdPerMillion', Number(event.target.value))} /></label><label>每张图像预留输入 Token<input aria-label="AI 图像 Token 预留" type="number" min={1} max={1000000} value={config.imageTokenAllowance} onChange={event => change('imageTokenAllowance', Number(event.target.value))} /></label></div>
      <label className="check-line"><input type="checkbox" checked={config.vision} onChange={event => change('vision', event.target.checked)} />我已按服务商文档确认当前模型支持图像输入（否则禁止发送截图）</label><label className="check-line"><input type="checkbox" checked={persistent} onChange={event => { setPersistent(event.target.checked); setRisk(false); }} />长期本地保存密钥（默认关闭）</label>{persistent && <label className="check-line"><input type="checkbox" checked={risk} onChange={event => setRisk(event.target.checked)} />我理解长期本地保存密钥的安全风险</label>}
      <p className="muted">请按服务商当前价格自行填写，统一折算 USD。图像、缓存、推理及服务商计费规则可能不同，估算不是实际账单保证。本地按完整上限保守预留，失败和取消也不自动退回；建议同时设置服务商账户硬限额。HTTP 仅允许本机地址，仅适合可信本机代理。</p><label className="check-line"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />我授权向上方指定端点发送本次明确确认的资料；Bearer 密钥会发送给该端点，不允许重定向</label><div className="ai-actions"><button className="primary" type="submit" disabled={!acknowledged || (persistent && !risk)}>保存配置并授权域名</button><button type="button" onClick={() => { void clear(); }}>清除密钥并撤销授权</button></div></fieldset></form>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}<h3>使用量与请求记录</h3><p>UTC {day} 已预留 USD {((today ?? []).reduce((sum, row) => sum + row.reservedMicros, 0) / 1000000).toFixed(6)}。这是本浏览器的估算限制，非服务商实时账单。</p><ul className="ai-usage">{usage?.map(row => <li key={row.id}>{new Date(row.createdAt).toLocaleString('zh-CN')} · {row.model} · {({ reserved: '进行中或结果未知', succeeded: '成功', failed: '失败', cancelled: '已取消' })[row.status]} · 预留 USD {(row.reservedMicros / 1000000).toFixed(6)} · 输入/输出 {row.inputTokens ?? '未知'}/{row.outputTokens ?? '未知'} Token{row.errorCode ? ` · ${row.errorCode}` : ''}</li>)}</ul><p className="muted">显示最近 20 条记录；进程中断的结果未知任务仍保留预算。不会保存密钥、原始请求或服务商错误正文到日志。</p>
  </section>;
}
