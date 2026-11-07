import { hasPermission } from '../../ai/config';
import { researchCredential } from './config';
import { proxyJSON } from './adapter';
import { ResearchFailure, type FailureStage } from './errors';
import type { ResearchConfig } from './model';
export interface DiagnosticRow {stage:FailureStage;code:string;elapsedMs:number}
export interface NetworkReport {version:1;free:true;searchAuthentication:'untested';searchQuota:'unverified';stages:DiagnosticRow[];environment:{node:string;httpProxyPresent:boolean;httpsProxyPresent:boolean;nodeEnvProxy:boolean;transport:'direct-pinned-https'|'http-connect-pinned-ip'}}
const codes=['OK','DNS_LOOKUP_FAILED','DNS_ADDRESS_BLOCKED','TCP_CONNECT_FAILED','TLS_HANDSHAKE_FAILED','TLS_CERTIFICATE_FAILED','UPSTREAM_TIMEOUT','UNKNOWN','OUTBOUND_PROXY_UNREACHABLE','CONNECT_REJECTED','CONNECT_PROTOCOL_INVALID'];
// Construct a strict allowlisted report. Never export raw server fields or headers.
export function parseDiagnosticReport(raw:Record<string,unknown>):NetworkReport {
  if(raw.version!==1||raw.free!==true||raw.searchAuthentication!=='untested'||raw.searchQuota!=='unverified'||!Array.isArray(raw.stages)||raw.stages.length>10||!raw.environment||typeof raw.environment!=='object')throw new ResearchFailure('SEARCH_RESPONSE_INVALID');
  const stages=raw.stages.map((r:unknown)=>{if(!r||typeof r!=='object')throw new ResearchFailure('SEARCH_RESPONSE_INVALID');const v=r as Record<string,unknown>;if(!['dns','safety','tcp','tls','environment','outbound','connect'].includes(String(v.stage))||!codes.includes(String(v.code))||!Number.isSafeInteger(v.elapsedMs)||Number(v.elapsedMs)<0||Number(v.elapsedMs)>120000)throw new ResearchFailure('SEARCH_RESPONSE_INVALID');return {stage:v.stage as FailureStage,code:String(v.code),elapsedMs:Number(v.elapsedMs)};});
  const env=raw.environment as Record<string,unknown>;if(typeof env.node!=='string'||!/^\d+\.\d+\.\d+$/.test(env.node)||['httpProxyPresent','httpsProxyPresent','nodeEnvProxy'].some(k=>typeof env[k]!=='boolean')||!['direct-pinned-https','http-connect-pinned-ip'].includes(String(env.transport)))throw new ResearchFailure('SEARCH_RESPONSE_INVALID');
  return {version:1,free:true,searchAuthentication:'untested',searchQuota:'unverified',stages,environment:{node:env.node,httpProxyPresent:env.httpProxyPresent as boolean,httpsProxyPresent:env.httpsProxyPresent as boolean,nodeEnvProxy:env.nodeEnvProxy as boolean,transport:env.transport as NetworkReport['environment']['transport']}};
}
export async function checkNetwork(config:ResearchConfig,signal:AbortSignal,overrides:{permission?:typeof hasPermission;credential?:typeof researchCredential;fetcher?:typeof fetch}={}):Promise<NetworkReport>{
  const d={permission:hasPermission,credential:researchCredential,fetcher:fetch,...overrides};
  if(!config.endpoint||!await d.permission(config.endpoint))throw new ResearchFailure('PROXY_AUTH_FAILED');
  const key=await d.credential(config.endpoint);if(!key)throw new ResearchFailure('PROXY_AUTH_FAILED');
  const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();let timeout=false;const timer=setTimeout(()=>{timeout=true;abort();},25000);
  try{
    const raw=await proxyJSON(d.fetcher,config,key.value,{version:1,operation:{kind:'diagnose',mode:'tls'}},controller.signal,16384);
    if(signal.aborted)throw new ResearchFailure('REQUEST_CANCELLED');
    if(!await d.permission(config.endpoint)||(await d.credential(config.endpoint))?.version!==key.version)throw new ResearchFailure('PROXY_AUTH_FAILED');
    return parseDiagnosticReport(raw);
  }catch(e){if(timeout)throw new ResearchFailure('CLIENT_TIMEOUT');if(signal.aborted)throw new ResearchFailure('REQUEST_CANCELLED');throw e;}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export const STAGE_LABELS:Record<FailureStage,string>={proxy:'浏览器到本地代理',auth:'本地代理认证',search:'搜索分支',dns:'Brave DNS',safety:'公共IP安全检查',tcp:'TCP连接',tls:'TLS证书验证',http:'上游HTTP',parse:'响应解析',client:'客户端',environment:'网络代理环境',outbound:'出站代理连接',connect:'数字IP CONNECT隧道'};
