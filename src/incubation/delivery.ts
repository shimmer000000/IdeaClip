import {db,type IdeaClipDB} from '../storage';
import {normalizeGitHub} from './github';
import {jsonBounded,parseRemote,referenceKey,REMOTE_ERRORS} from './github-sync';
import type {GitHubReference,Task,Workspace} from './model';

export const DELIVERY_ERRORS={...REMOTE_ERRORS,LIMIT:'已达到本次读取上限，资料不完整',CHANGED:'PR资料或任务绑定已变化，请重新核对后手动检查'};
export type DeliveryError=keyof typeof DELIVERY_ERRORS;
export interface ChangedFile {path:string;previousPath?:string;status:string;additions:number;deletions:number}
export interface Check {name:string;state:'passed'|'failed'|'pending'|'other'}
export interface CI {checks:Check[];complete:boolean;error?:DeliveryError}
export interface DeliveryTarget {kind:'commit'|'pr';sha:string;number?:number;message:string;updatedAt:string;files:ChangedFile[];filesComplete:boolean;additions:number;deletions:number;ci:CI}
export interface DeliverySnapshot {version:1;key:string;source:'https://api.github.com';attemptAt:number;checkedAt?:number;historical:boolean;blockedUntil:number;error?:DeliveryError;targets:DeliveryTarget[]}
const integer=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<0)throw Error('INVALID');return Number(v);};
const timestamp=(v:unknown)=>{const n=integer(v);if(!Number.isFinite(new Date(n).getTime()))throw Error('INVALID');return n;};
const str=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('INVALID');return v;};
const sha=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f0-9]{40}$/.test(v))throw Error('INVALID');return v;};
const date=(v:unknown)=>{const s=str(v,100);if(!Number.isFinite(Date.parse(s)))throw Error('INVALID');return s;};
const error=(v:unknown):DeliveryError|undefined=>{if(v===undefined)return;if(typeof v!=='string'||!Object.hasOwn(DELIVERY_ERRORS,v))throw Error('INVALID');return v as DeliveryError;};
function path(v:unknown){const s=str(v,500);if(!s||s.startsWith('/')||s.includes('\\')||s.includes(':')||/[\r\n]/.test(s)||s.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('INVALID');return s;}
function file(raw:any):ChangedFile {
 if(!raw||!['added','removed','modified','renamed','copied','changed','unchanged'].includes(raw.status))throw Error('INVALID');
 return {path:path(raw.filename??raw.path),status:raw.status,additions:integer(raw.additions),deletions:integer(raw.deletions),...(raw.previous_filename!==undefined||raw.previousPath!==undefined?{previousPath:path(raw.previous_filename??raw.previousPath)}:{})};
}
// Portable allowlist: no patches, response bodies, headers, URLs from checks or execution permissions.
export function deliverySnapshot(raw:unknown,historical=false):DeliverySnapshot {
 const v=raw as DeliverySnapshot;if(!v||v.version!==1||v.source!=='https://api.github.com'||typeof v.historical!=='boolean'||!Array.isArray(v.targets)||v.targets.length>2)throw Error('INVALID');
 const targets=v.targets.map(t=>{if(!['commit','pr'].includes(t.kind)||!Array.isArray(t.files)||t.files.length>300||typeof t.filesComplete!=='boolean'||!Array.isArray(t.ci?.checks)||t.ci.checks.length>300||typeof t.ci.complete!=='boolean')throw Error('INVALID');
  const files=t.files.map(file);if(new Set(files.map(f=>f.path)).size!==files.length)throw Error('INVALID');
  return {kind:t.kind,sha:sha(t.sha),...(t.kind==='pr'?{number:integer(t.number)||(()=>{throw Error('INVALID');})()}:{}),message:str(t.message,500),updatedAt:date(t.updatedAt),files,filesComplete:t.filesComplete,additions:integer(t.additions),deletions:integer(t.deletions),ci:{complete:t.ci.complete,error:error(t.ci.error),checks:t.ci.checks.map(c=>{if(!['passed','failed','pending','other'].includes(c.state))throw Error('INVALID');return {name:str(c.name,200),state:c.state};})}};
 });
 return {version:1,key:str(v.key,500),source:v.source,attemptAt:timestamp(v.attemptAt),...(v.checkedAt!==undefined?{checkedAt:timestamp(v.checkedAt)}:{}),historical:historical||v.historical,blockedUntil:historical?0:timestamp(v.blockedUntil),error:error(v.error),targets};
}
export function ciState(ci:CI){if(ci.error)return '无法读取';if(ci.checks.some(c=>c.state==='failed'))return '存在失败检查';if(ci.checks.some(c=>c.state==='pending'))return '检查进行中';if(!ci.complete)return '检查不完整';if(!ci.checks.length)return '未配置 CI（未发现检查）';if(ci.checks.some(c=>c.state==='other'))return '有跳过或无明确结论的检查';return '已读取的 CI 全部通过';}
export function scopeState(f:ChangedFile,w:Workspace|undefined,repository:string):'范围内'|'范围外'|'无法判断'{
 if(!w||!w.directory?.trim()||!w.scope?.length)return '无法判断';
 try {if(normalizeGitHub({repository:w.repository,linkedAt:0}).repository.toLowerCase()!==repository.toLowerCase())return '无法判断';
  const scopes=w.scope.map(s=>path(s.replace(/\\/g,'/').replace(/\/$/,'')));const within=(p:string)=>scopes.some(s=>p===s||p.startsWith(s+'/'));
  if(!within(f.path)||f.previousPath&&!within(f.previousPath))return '范围外';
  return f.status==='renamed'&&!f.previousPath?'无法判断':'范围内';
 }catch{return '无法判断';}
}
export function deliveryFresh(task:Task,now=Date.now()) {const s=task.deliveryCheck;return !!s&&!!task.github&&s.key===referenceKey(task.github)&&!s.historical&&!s.error&&s.checkedAt!==undefined&&now>=s.checkedAt&&now-s.checkedAt<900000;}
function matchingSnapshot(task:Task){return task.github&&task.deliveryCheck?.key===referenceKey(task.github)?task.deliveryCheck:undefined;}
export function missingEvidence(task:Task,w?:Workspace,now=Date.now()){
 const s=matchingSnapshot(task),items=[task.localDeliveries?.some(e=>e.localCheck&&!e.localCheck.historical)?'已有本地记录文件一致性核对；尚未独立证明测试执行。':'未取得本地测试日志，不能证明本地测试已执行。','CI和提交核实不等于人工验收通过。'];
 if(!deliveryFresh(task,now))items.push('远程成果尚未取得最新完整快照；请手动检查。');
 if(s?.targets.some(t=>!t.filesComplete))items.push('文件列表不完整，不能证明全部修改都在允许范围内。');
 if(!w?.scope?.length||s?.targets.some(t=>t.files.some(f=>scopeState(f,w,task.github!.repository)==='无法判断')))items.push('未绑定有效开发工作区或文件范围无法判断。');
 if(s?.targets.some(t=>t.files.some(f=>scopeState(f,w,task.github!.repository)==='范围外')))items.push('存在允许修改范围以外的文件，需人工审查。');
 if(s?.targets.some(t=>ciState(t.ci)!=='已读取的 CI 全部通过'))items.push('CI未全部明确通过；未配置CI不等于测试失败或通过。');
 if(task.acceptanceReview?.state!=='passed')items.push('缺少人工验收通过记录。');return items;
}
export function deliverySummary(task:Task,w?:Workspace,now=Date.now()){
 const s=matchingSnapshot(task);return ['Codex 开发验收摘要',`任务：${task.title}`,`仓库：${task.github?.repository??'未关联'}`,`快照：${deliveryFresh(task,now)?'远程已核实':'历史或未核实'}；来源：https://api.github.com`,s?`最近查询：${new Date(s.attemptAt).toISOString()}；最近成功：${s.checkedAt===undefined?'无':new Date(s.checkedAt).toISOString()}${s.error?'；错误：'+s.error:''}`:'尚未检查当前关联',...(s?.targets??[]).flatMap(t=>[`${t.kind==='pr'?'PR #'+t.number:'Commit'} ${t.sha}：${t.message}`,`文件 ${t.files.length}（${t.filesComplete?'完整':'不完整'}），+${t.additions} / -${t.deletions}；${ciState(t.ci)}`,...t.files.map(f=>`${f.path}${f.previousPath?' ← '+f.previousPath:''} [${f.status}] +${f.additions}/-${f.deletions}：${scopeState(f,w,task.github!.repository)}`)]),'缺失证据与限制：',...missingEvidence(task,w,now),`人工验收：${task.acceptanceReview?.state??'未验收'}；看板：${task.status}（未自动改变）`].join('\n');
}
class QueryError extends Error {constructor(public code:DeliveryError,public until=0){super(code);}}
export async function queryDelivery(g:GitHubReference,old?:DeliverySnapshot,fetcher:typeof fetch=fetch,now=Date.now(),timeout=10000,blockedUntil=0):Promise<DeliverySnapshot>{
 g=normalizeGitHub(g);if(!g.commitSha&&!g.prNumber)throw Error('请先关联Commit或PR');
 const key=referenceKey(g),previous=old?.key===key?deliverySnapshot(old):undefined;
 const out:DeliverySnapshot={version:1,key,source:'https://api.github.com',attemptAt:now,historical:false,blockedUntil:0,targets:[]};
 const failure=(code:DeliveryError,until=0):DeliverySnapshot=>({...out,targets:previous?.targets??[],checkedAt:previous?.checkedAt,historical:true,error:code,blockedUntil:until});
 if(now<Math.max(blockedUntil,previous?.blockedUntil??0))return failure('RATE_LIMIT',Math.max(blockedUntil,previous?.blockedUntil??0));
 if(previous&&now>=previous.attemptAt&&now-previous.attemptAt<60000)return previous;
 let count=0;const base='https://api.github.com/repos/'+g.repository.split('/').slice(-2).join('/');
 async function get(route:string){
  if(++count>16)throw new QueryError('LIMIT');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try {const r=await fetcher(base+'/'+route,{method:'GET',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
   if(r.status===429||r.status===403&&(r.headers.get('x-ratelimit-remaining')==='0'||r.headers.has('retry-after'))){const retry=Number(r.headers.get('retry-after')),reset=Number(r.headers.get('x-ratelimit-reset'))*1000;throw new QueryError('RATE_LIMIT',Math.max(now+60000,Math.min(now+86400000,Number.isFinite(reset)?reset:0),now+Math.min(86400,Number.isFinite(retry)?retry:0)*1000));}
   if(!r.ok)throw new QueryError(({401:'AUTH',403:'FORBIDDEN',404:'NOT_FOUND'} as Record<number,DeliveryError>)[r.status]??'HTTP');
   let value;try{value=await jsonBounded(r);}catch{throw new QueryError(controller.signal.aborted?'TIMEOUT':'INVALID');}
   return {value,next:/rel="next"/.test(r.headers.get('link')??'')};
  }catch(e){if(e instanceof QueryError)throw e;throw new QueryError(controller.signal.aborted?'TIMEOUT':e instanceof SyntaxError||e instanceof TypeError&&e.message==='INVALID'||e instanceof Error&&e.message==='INVALID'?'INVALID':'NETWORK');}finally{clearTimeout(timer);}
 }
 async function ci(head:string):Promise<CI>{
  const result:CI={checks:[],complete:true};try{
   for(let page=1;page<=2;page++){const r=await get(`commits/${head}/check-runs?filter=latest&per_page=100&page=${page}`),v=r.value;if(!v||!Array.isArray(v.check_runs)||v.check_runs.length>100)throw Error('INVALID');const total=integer(v.total_count);
    for(const c of v.check_runs){if(c.head_sha!==head||!['queued','in_progress','completed','waiting','requested','pending'].includes(c.status)||c.status==='completed'&&!['action_required','cancelled','failure','neutral','success','skipped','stale','timed_out','startup_failure'].includes(c.conclusion))throw Error('INVALID');result.checks.push({name:str(c.name,200),state:c.status!=='completed'?'pending':c.conclusion==='success'?'passed':['neutral','skipped','stale'].includes(c.conclusion)?'other':'failed'});}
    if(!r.next&&total<=page*100)break;if(page===2)result.complete=false;
   }
   const r=await get(`commits/${head}/status?per_page=100&page=1`),v=r.value;if(v?.sha!==head||!Array.isArray(v.statuses)||v.statuses.length>100)throw Error('INVALID');if(integer(v.total_count)>v.statuses.length||r.next)result.complete=false;
   for(const c of v.statuses){if(!['success','error','failure','pending'].includes(c.state))throw Error('INVALID');result.checks.push({name:str(c.context,200),state:c.state==='success'?'passed':c.state==='pending'?'pending':'failed'});}
  }catch(e){const code=e instanceof QueryError?e.code:'INVALID';if(code==='RATE_LIMIT'||code==='FORBIDDEN')throw e;result.error=code;result.complete=false;}return result;
 }
 async function files(route:string,kind:'commit'|'pr',head:string,initial:ChangedFile[]=[]){const collected:ChangedFile[]=[...initial];let complete=true;for(let page=initial.length?2:1;page<=3;page++){const r=await get(`${route}?per_page=100&page=${page}`);if(kind==='commit'){const c=parseRemote('commit',r.value,{...g,commitSha:head,commitUrl:g.repository+'/commit/'+head},now);if(c.sha!==head)throw Error('INVALID');}const list=kind==='commit'?r.value.files:r.value;if(!Array.isArray(list)||list.length>100)throw Error('INVALID');collected.push(...list.map(file));if(!r.next)break;if(page===3)complete=false;}if(new Set(collected.map(f=>f.path)).size!==collected.length)throw Error('INVALID');return {files:collected,filesComplete:complete};}
 try {
  if(g.commitSha){const r=await get(`commits/${g.commitSha}?per_page=100&page=1`),c=parseRemote('commit',r.value,g,now),head=c.sha!;
   // Reuse the first page; every later page uses the verified full SHA, never a branch/ref.
   if(!Array.isArray(r.value.files)||r.value.files.length>100)throw Error('INVALID');let f={files:r.value.files.map(file) as ChangedFile[],filesComplete:true};
   if(r.next)f=await files(`commits/${head}`,'commit',head,f.files);
   out.targets.push({kind:'commit',sha:head,message:c.summary,updatedAt:c.updatedAt,...f,additions:integer(r.value.stats?.additions),deletions:integer(r.value.stats?.deletions),ci:await ci(head)});
  }
  if(g.prNumber){const readPR=async()=>{const r=(await get(`pulls/${g.prNumber}`)).value;const p=parseRemote('pr',r,g,now);if(r.base?.repo?.html_url?.toLowerCase()!==g.repository.toLowerCase())throw Error('INVALID');sha(r.base?.sha);return {r,p,head:sha(r.head?.sha)};};
   const first=await readPR(),f=await files(`pulls/${g.prNumber}/files`,'pr',first.head),checks=await ci(first.head),last=await readPR();
   if(first.head!==last.head||first.r.updated_at!==last.r.updated_at||first.r.base.sha!==last.r.base.sha||first.r.changed_files!==last.r.changed_files)throw new QueryError('CHANGED');
   if(integer(first.r.changed_files)!==f.files.length)f.filesComplete=false;
   out.targets.push({kind:'pr',number:g.prNumber,sha:first.head,message:first.p.summary,updatedAt:first.p.updatedAt,...f,additions:integer(first.r.additions),deletions:integer(first.r.deletions),ci:checks});
  }
  out.checkedAt=now;return deliverySnapshot(out);
 }catch(e){return failure(e instanceof QueryError?e.code:'INVALID',e instanceof QueryError?e.until:0);}
}
export async function refreshDelivery(projectId:string,taskId:string,database:IdeaClipDB=db,fetcher:typeof fetch=fetch,permission=()=>chrome.permissions.contains({origins:['https://api.github.com/*']})){
 const action=async()=>{const project=await database.projects.get(projectId),task=project?.tasks?.find(t=>t.id===taskId);if(!task?.github)throw Error('请先保存GitHub关联');
  const key=referenceKey(task.github),boundary=JSON.stringify(project?.workspace??null);let blocked=0;
  if(globalThis.chrome?.storage?.local){const s=await chrome.storage.local.get('ideaclip-github-rate-until');if(typeof s['ideaclip-github-rate-until']==='number')blocked=Math.min(Date.now()+86400000,s['ideaclip-github-rate-until']);}
  const snapshot=await permission()?await queryDelivery(task.github,task.deliveryCheck,fetcher,Date.now(),10000,blocked):{version:1 as const,key,source:'https://api.github.com' as const,attemptAt:Date.now(),historical:true,blockedUntil:0,error:'PERMISSION' as const,targets:task.deliveryCheck?.key===key?task.deliveryCheck.targets:[],checkedAt:task.deliveryCheck?.key===key?task.deliveryCheck.checkedAt:undefined};
  if(snapshot.blockedUntil&&globalThis.chrome?.storage?.local)await chrome.storage.local.set({'ideaclip-github-rate-until':snapshot.blockedUntil});
  await database.transaction('rw',database.projects,async()=>{const latest=await database.projects.get(projectId),t=latest?.tasks?.find(t=>t.id===taskId);if(!latest||!t?.github||referenceKey(t.github)!==key||JSON.stringify(latest.workspace??null)!==boundary)throw Error('任务关联或工作区已变化，未保存过期检查');t.deliveryCheck=snapshot;latest.revision=(latest.revision??0)+1;await database.projects.put(latest);});
 };
 if(globalThis.navigator?.locks)return navigator.locks.request('ideaclip-github-read',action);return action();
}
