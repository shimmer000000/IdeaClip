import { hasPermission } from '../../ai/config';
import { researchCredential } from './config';
import { validateResearchConfig, type ResearchConfig } from './model';
import { proxyJSON } from './adapter';
export type ConnectionState='unconfigured'|'stopped'|'connected'|'searchMissing'|'permission'|'failed'|'budget';
export const CONNECTION_LABELS:Record<ConnectionState,string>={unconfigured:'代理未配置',stopped:'代理未启动或本地连接不可达',connected:'代理连接正常',searchMissing:'缺少搜索服务配置',permission:'域名权限未批准',failed:'请求失败',budget:'预算不足'};
export interface ConnectionResult {state:ConnectionState;message:string;checkedAt?:number;health?:{searchConfigured:boolean;hosts:string[];searchRequests:number;searchLimit:number}}
interface Dependencies {permission:typeof hasPermission;credential:typeof researchCredential;fetcher:typeof fetch}
// Explicit, free capability check only. It never enables research or probes an upstream.
export async function checkResearchConnection(config:ResearchConfig,signal:AbortSignal,overrides:Partial<Dependencies>={}):Promise<ConnectionResult>{
  if(!config.endpoint)return {state:'unconfigured',message:'先保存可信代理配置；此处不会替你申请权限。'};
  const d={permission:hasPermission,credential:researchCredential,fetcher:fetch,...overrides};let c:ResearchConfig;
  try{c=validateResearchConfig(config);}catch{return {state:'unconfigured',message:'代理配置不完整，请核对端点、来源白名单和预算。'};}
  if(!await d.permission(c.endpoint))return {state:'permission',message:'请主动保存配置并批准该代理域名；未发送请求。'};
  const key=await d.credential(c.endpoint);if(!key)return {state:'failed',message:'代理会话密钥缺失，请重新保存配置。'};
  if(signal.aborted)return {state:'failed',message:'连接检查已取消。'};if(!await d.permission(c.endpoint))return {state:'permission',message:'授权已撤销；未发送请求。'};
  const controller=new AbortController();const cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();const timer=setTimeout(cancel,Math.min(c.timeoutMs,5000));
  try{
    const r=await proxyJSON(d.fetcher,c,key.value,{version:1,operation:{kind:'health'}},controller.signal,16384);
    signal.throwIfAborted();if(!await d.permission(c.endpoint)||(await d.credential(c.endpoint))?.version!==key.version)return {state:'permission',message:'检查期间授权或凭据改变，请重新确认。'};
    if(r.version!==1||r.service!=='IdeaClipResearchProxy'||r.noUpstreamRequests!==true||!r.search||typeof r.search!=='object')throw new Error('protocol');
    const search=r.search as Record<string,unknown>,usage=r.usage as Record<string,unknown>;
    if(typeof search.configured!=='boolean'||search.verified!==false||!Array.isArray(r.allowedHosts)||r.allowedHosts.length>20||r.allowedHosts.some(h=>typeof h!=='string'||h.length>253)||!usage||!Number.isSafeInteger(usage.searchRequests)||!Number.isSafeInteger(usage.searchLimit)||Number(usage.searchRequests)<0||Number(usage.searchLimit)<0)throw new Error('protocol');
    const hosts=r.allowedHosts as string[];const mismatch=c.hosts.filter(h=>!hosts.includes(h));
    return {state:!search.configured?'searchMissing':'connected',checkedAt:Date.now(),health:{searchConfigured:search.configured,hosts,searchRequests:Number(usage.searchRequests),searchLimit:Number(usage.searchLimit)},message:'本地代理可达；未请求上游，Brave凭据、额度和真实可用性尚未验证。'+(mismatch.length?' 本次来源白名单包含服务端未授权域名，请在两端保持一致。':'')};
  }catch(e){if(signal.aborted)return {state:'failed',message:'连接检查已取消。'};const local=['127.0.0.1','localhost'].includes(new URL(c.endpoint).hostname);return {state:e instanceof TypeError&&local?'stopped':'failed',message:'连接检查未通过：请核对服务是否启动、端点和会话密钥；旧代理可能不支持健康协议。没有发起搜索或AI请求。'};}
  finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}
