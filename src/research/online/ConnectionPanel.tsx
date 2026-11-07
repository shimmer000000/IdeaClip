import { useEffect, useRef, useState } from 'react';
import { checkResearchConnection, CONNECTION_LABELS, type ConnectionResult } from './connection';
import type { ResearchConfig, ResearchUsage } from './model';
import { DiagnosticsPanel } from './DiagnosticsPanel';
export function ConnectionPanel({config,usage,busy}:{config:ResearchConfig;usage:ResearchUsage[];busy:boolean}){
  const [result,setResult]=useState<ConnectionResult|null>(null);const [checking,setChecking]=useState(false);const active=useRef<AbortController|null>(null);
  useEffect(()=>{setResult(null);active.current?.abort();const revoke=()=>{active.current?.abort();setResult({state:'permission',message:'网站权限已改变，请重新确认。'});};chrome.permissions.onRemoved.addListener(revoke);return()=>{active.current?.abort();chrome.permissions.onRemoved.removeListener(revoke);};},[config.version]);
  const spent=usage.reduce((s,u)=>s+u.reservedMicros,0),insufficient=!!config.endpoint&&spent+Math.ceil(config.priceUsd*1e6)>Math.floor(config.dailyBudgetUsd*1e6);
  const state=!config.endpoint?'unconfigured':insufficient?'budget':result?.state;
  return <section aria-label="研究代理连接"><h3>连接状态</h3><p role="status" aria-label="研究连接状态">{state?CONNECTION_LABELS[state]:'尚未检查连接'}</p><p>{result?.message??'仅主动检查已保存的代理端点；不会检查搜索账户、产生搜索费用或开启研究。'}</p>{insufficient&&<p>当前预算不足以预留下一次研究请求；免费健康检查仍可使用。</p>}
  <button disabled={busy||checking} onClick={async()=>{const controller=new AbortController();active.current=controller;setChecking(true);try{const value=await checkResearchConnection(config,controller.signal);if(!controller.signal.aborted)setResult(value);}catch{if(!controller.signal.aborted)setResult({state:'failed',message:'连接状态读取失败；未发起付费请求。'});}finally{setChecking(false);}}}>检查连接（免费）</button>{checking&&<button onClick={()=>active.current?.abort()}>取消连接检查</button>}
  {result?.health&&<p>代理允许来源：{result.health.hosts.join('、')}。服务端今日搜索尝试 {result.health.searchRequests}/{result.health.searchLimit} 次（进程内计数，包含连接失败，不等于Brave收到请求）；上游未验证。{result.checkedAt&&` 检查时间：${new Date(result.checkedAt).toLocaleString('zh-CN')}`}</p>}
  <p>今日研究请求 {usage.length} 次；成功 {usage.filter(u=>u.state==='succeeded').length}，失败 {usage.filter(u=>u.state==='failed').length}，发送中或结果未知 {usage.filter(u=>u.state==='sent'||u.state==='unknown').length}；本机已预留 USD {(spent/1e6).toFixed(6)}。免费健康检查不计入研究次数或费用。本地预留不是Brave实际扣费，实际额度以Brave控制台为准。</p><DiagnosticsPanel config={config} busy={busy}/></section>;
}
