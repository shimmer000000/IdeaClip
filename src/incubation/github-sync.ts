import {db,type IdeaClipDB} from '../storage';
import {normalizeGitHub} from './github';
import type {GitHubReference} from './model';
export const API_ORIGIN='https://api.github.com/*';
export const REMOTE_ERRORS={PERMISSION:'GitHub API域名权限未批准',AUTH:'需要单独配置只读授权（本轮不支持Token）',FORBIDDEN:'访问受限或限流',NOT_FOUND:'不可访问或不存在；私有仓库未授权也可能返回404',RATE_LIMIT:'GitHub限流；等待后手动刷新',TIMEOUT:'查询超时',NETWORK:'断网、重定向或网络失败',INVALID:'响应格式或仓库归属不符',STALE:'关联已变化，结果未写入',HTTP:'GitHub HTTP异常'};
type Code=keyof typeof REMOTE_ERRORS;
export interface RemoteItem {state:'open'|'closed'|'draft'|'merged'|'exists'|'issue_is_pr';updatedAt:string;summary:string;sha?:string;etag?:string;checkedAt:number}
export interface RemoteSnapshot {key:string;source:'https://api.github.com';attemptAt:number;blockedUntil:number;historical:boolean;items:Partial<Record<'issue'|'pr'|'commit',RemoteItem>>;errors:Partial<Record<'issue'|'pr'|'commit'|'query',Code>>}
export const referenceKey=(g:GitHubReference)=>{const n=normalizeGitHub(g);return JSON.stringify([n.repository.toLowerCase(),n.issueNumber??null,n.prNumber??null,n.commitSha??null]);};
const date=(v:unknown)=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw Error('INVALID');return v;};
export function remoteSnapshot(value:unknown,historical=false):RemoteSnapshot {
 const v=value as RemoteSnapshot;if(!v||v.source!=='https://api.github.com'||typeof v.key!=='string'||v.key.length>500||typeof v.historical!=='boolean'||![v.attemptAt,v.blockedUntil].every(x=>Number.isSafeInteger(x)&&x>=0))throw Error('INVALID');
 const out:RemoteSnapshot={key:v.key,source:v.source,attemptAt:v.attemptAt,blockedUntil:historical?0:v.blockedUntil,historical:historical||v.historical,items:{},errors:{}};
 for(const kind of ['issue','pr','commit'] as const){const i=v.items?.[kind];if(i){if(!['open','closed','draft','merged','exists','issue_is_pr'].includes(i.state)||typeof i.summary!=='string'||i.summary.length>500||!Number.isSafeInteger(i.checkedAt)||i.checkedAt<0||i.sha!==undefined&&!/^[a-f0-9]{40}$/.test(i.sha))throw Error('INVALID');out.items[kind]={state:i.state,summary:i.summary,updatedAt:date(i.updatedAt),checkedAt:i.checkedAt,...(i.sha?{sha:i.sha}:{}),...(!historical&&typeof i.etag==='string'&&i.etag.length<=200&&!/[\r\n]/.test(i.etag)?{etag:i.etag}:{})};}}
 for(const kind of ['issue','pr','commit','query'] as const){const e=v.errors?.[kind];if(e){if(!Object.hasOwn(REMOTE_ERRORS,e))throw Error('INVALID');out.errors[kind]=e;}}
 return out;
}
export function parseRemote(kind:'issue'|'pr'|'commit',raw:unknown,g:GitHubReference,now:number):RemoteItem {
 const r=raw as Record<string,any>;if(!r||typeof r!=='object')throw Error('INVALID');
 const summary=(s:unknown)=>{if(typeof s!=='string')throw Error('INVALID');return s.slice(0,500);};
 const repository=normalizeGitHub(g).repository.toLowerCase();
 if(kind==='commit'){if(typeof r.sha!=='string'||!/^[a-f0-9]{40}$/.test(r.sha)||!r.sha.startsWith(g.commitSha!.toLowerCase())||r.html_url?.toLowerCase()!==repository+'/commit/'+r.sha)throw Error('INVALID');return {state:'exists',sha:r.sha,summary:summary(r.commit?.message),updatedAt:date(r.commit?.committer?.date),checkedAt:now};}
 if(kind==='pr'&&r.merged_at!=null){date(r.merged_at);if(r.state!=='closed')throw Error('INVALID');}
 const number=kind==='issue'?g.issueNumber:g.prNumber,path=kind==='issue'?'issues':'pull';
 if(r.number!==number||r.html_url?.toLowerCase()!==repository+'/'+(kind==='issue'&&r.pull_request?'pull':path)+'/'+number||!['open','closed'].includes(r.state))throw Error('INVALID');
 return {state:kind==='issue'&&r.pull_request?'issue_is_pr':kind==='pr'&&r.merged_at?'merged':kind==='pr'&&r.state==='open'&&r.draft?'draft':r.state,summary:summary(r.title),updatedAt:date(r.updated_at),checkedAt:now};
}
export async function jsonBounded(response:Response){const reader=response.body?.getReader();if(!reader)throw Error('INVALID');let size=0;const decoder=new TextDecoder('utf-8',{fatal:true});let text='';try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw Error('INVALID');text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{await reader.cancel().catch(()=>{});}}
let rateUntil=0;
export async function queryGitHub(g:GitHubReference,old?:RemoteSnapshot,fetcher:typeof fetch=fetch,now=Date.now(),timeout=10000):Promise<RemoteSnapshot>{
 g=normalizeGitHub(g);const key=referenceKey(g),previous=old?.key===key?remoteSnapshot(old):undefined;
 if(now<Math.max(previous?.blockedUntil??0,rateUntil))return {...(previous??{key,source:'https://api.github.com' as const,attemptAt:now,historical:false,items:{}}),blockedUntil:Math.max(previous?.blockedUntil??0,rateUntil),errors:{...previous?.errors,query:'RATE_LIMIT'}};
 if(previous&&!previous.historical&&now>=previous.attemptAt&&now-previous.attemptAt<60000)return previous;
 const out:RemoteSnapshot={key,source:'https://api.github.com',attemptAt:now,blockedUntil:0,historical:false,items:{...previous?.items},errors:{}};
 const base='https://api.github.com/repos/'+g.repository.split('/').slice(-2).join('/');
 for(const [kind,path] of [['issue',g.issueNumber?'issues/'+g.issueNumber:null],['pr',g.prNumber?'pulls/'+g.prNumber:null],['commit',g.commitSha?'commits/'+g.commitSha:null]] as const){if(!path)continue;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{
   const item=previous?.historical?undefined:previous?.items[kind];const headers:Record<string,string>={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(item?.etag)headers['If-None-Match']=item.etag;
   const response=await fetcher(base+'/'+path,{method:'GET',headers,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
   if(response.status===304){if(!item)throw Error('INVALID');out.items[kind]={...item,checkedAt:now};continue;}
   if(response.status===429||response.status===403&&(response.headers.get('x-ratelimit-remaining')==='0'||response.headers.has('retry-after'))){const delay=Number(response.headers.get('retry-after')),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;rateUntil=Math.max(now+60000,Math.min(now+86400000,Number.isFinite(reset)?reset:0),now+Math.min(86400,Number.isFinite(delay)?delay:0)*1000);out.blockedUntil=rateUntil;throw Error('RATE_LIMIT');}
   if(!response.ok)throw Error(({401:'AUTH',403:'FORBIDDEN',404:'NOT_FOUND'} as Record<number,Code>)[response.status]??'HTTP');
   const parsed=parseRemote(kind,await jsonBounded(response),g,now);const etag=response.headers.get('etag');out.items[kind]={...parsed,...(etag&&etag.length<=200&&!/[\r\n]/.test(etag)?{etag}:{})};
  }catch(e){const code=controller.signal.aborted?'TIMEOUT':e instanceof Error&&Object.hasOwn(REMOTE_ERRORS,e.message)?e.message as Code:e instanceof SyntaxError?'INVALID':'NETWORK';out.errors[kind]=code;if(code==='RATE_LIMIT'||code==='FORBIDDEN')break;}finally{clearTimeout(timer);}
 }
 return out;
}
export async function refreshGitHub(projectId:string,taskId:string,database:IdeaClipDB=db,fetcher:typeof fetch=fetch,permission=()=>chrome.permissions.contains({origins:[API_ORIGIN]})){
 const action=async()=>{if(globalThis.chrome?.storage?.local){const stored=await chrome.storage.local.get('ideaclip-github-rate-until');const n=stored['ideaclip-github-rate-until'];if(typeof n==='number'&&Number.isSafeInteger(n))rateUntil=Math.max(rateUntil,Math.min(Date.now()+86400000,n));}const p=await database.projects.get(projectId),task=p?.tasks?.find(t=>t.id===taskId);if(!p||!task?.github)throw Error('请先保存GitHub关联');const key=referenceKey(task.github);
 const snapshot=await permission()?await queryGitHub(task.github,task.githubRemote,fetcher):{key,source:'https://api.github.com' as const,attemptAt:Date.now(),blockedUntil:0,historical:false,items:task.githubRemote?.key===key?{...task.githubRemote.items}:{},errors:{query:'PERMISSION' as const}};
 if(snapshot.blockedUntil&&globalThis.chrome?.storage?.local)await chrome.storage.local.set({'ideaclip-github-rate-until':snapshot.blockedUntil});
 await database.transaction('rw',database.projects,async()=>{const latest=await database.projects.get(projectId),t=latest?.tasks?.find(t=>t.id===taskId);if(!latest||!t?.github||referenceKey(t.github)!==key)throw Error('关联已变化，未保存过期查询');t.githubRemote=snapshot;latest.revision=(latest.revision??0)+1;await database.projects.put(latest);});};
 if(globalThis.navigator?.locks)return navigator.locks.request('ideaclip-github-read',action);return action();
}
