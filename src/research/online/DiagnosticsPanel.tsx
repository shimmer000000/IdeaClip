import { useEffect, useRef, useState } from 'react';
import type { ResearchConfig } from './model';
import { checkNetwork, STAGE_LABELS, type NetworkReport } from './diagnostics';
import { ResearchFailure } from './errors';
export function DiagnosticsPanel({config,busy}:{config:ResearchConfig;busy:boolean}) {
 const [report,setReport]=useState<NetworkReport|null>(null),[error,setError]=useState(''),[checking,setChecking]=useState(false);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>{setReport(null);setError('');const revoke=()=>{active.current?.abort();setReport(null);};chrome.permissions.onRemoved.addListener(revoke);return()=>{active.current?.abort();chrome.permissions.onRemoved.removeListener(revoke);};},[config.version]);
 function download(){if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='IdeaClip-Network-Diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section aria-label="免费网络诊断"><h3>网络诊断</h3><p>仅主动检查Brave DNS、公共IP和TCP/TLS；无HTTP搜索请求、不携带Brave Key、不增加付费请求或预留预算。出站路径由Windows服务窗口明确配置，默认直连，不自动采用系统代理。</p>
 <button disabled={busy||checking||!config.endpoint} onClick={async()=>{const c=new AbortController();active.current=c;setChecking(true);setReport(null);setError('');try{const r=await checkNetwork(config,c.signal);if(!c.signal.aborted)setReport(r);}catch(e){if(!c.signal.aborted)setError(e instanceof ResearchFailure?e.message:'诊断失败：UNKNOWN；未调用搜索或AI。');}finally{setChecking(false);}}}>网络诊断（免费）</button>
 {checking&&<button onClick={()=>{active.current?.abort();setError('REQUEST_CANCELLED：免费诊断已取消；没有搜索请求。');}}>取消网络诊断</button>}
 {error&&<p role="alert">{error}</p>}{report&&<><p>浏览器到本地代理：成功；本地代理认证：成功。</p><ul>{['dns','safety',...(report.environment.transport==='http-connect-pinned-ip'?['outbound','connect']:[]),'tcp','tls'].map(stage=>{const row=report.stages.find(r=>r.stage===stage);return <li key={stage}>{STAGE_LABELS[stage as keyof typeof STAGE_LABELS]}：{row?row.code==='OK'?'成功':'失败':'未完成'} {row&&`${row.code} · ${row.elapsedMs}ms`}</li>;})}</ul><p>Brave API真实认证：未测试；Brave搜索额度：未验证。</p><p>DNS解析来源：{report.environment.dnsResolver==='ssh-gateway'?'自有SSH出口（不改系统DNS）':'系统DNS'}；Node {report.environment.node}；HTTP(S)代理环境变量{report.environment.httpProxyPresent||report.environment.httpsProxyPresent?'存在':'未设置'}；生产传输：{report.environment.transport==='http-connect-pinned-ip'?'用户批准的HTTP CONNECT数字IP隧道':'直连并固定校验IP'}。不自动修改DNS、VPN或系统代理。</p><p>CONNECT模式必须信任已审查代理按数字IP转发、不通过SNI覆盖目标；隧道成功不独立证明代理内部路由。免费诊断可以人工重测；成功不证明API Key或额度有效，付费搜索仍须逐次确认。</p><button onClick={download}>生成脱敏诊断报告</button></>}
 </section>;
}
