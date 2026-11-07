import Dexie, { liveQuery } from 'dexie';
import { db, type IdeaClipDB } from '../../storage';
import { digest } from '../../backup/zip';
import { redact } from '../../backup/model';
import { hasPermission } from '../../ai/config';
import { researchConfig, researchCredential } from './config';
import { proxyAdapter, type ResearchAdapter } from './adapter';
import { operations, sourceDigest, TOPICS, validateResearchConfig, validateRun, validateSource, type ResearchConfig, type ResearchRun, type ResearchUsage, type Operation, type ResearchSource } from './model';
export interface OnlinePreview {id:string;studyId:string;revision:number;planHash:string;topic:keyof typeof TOPICS;question:string;operations:Operation[];config:ResearchConfig;credentialVersion:string;createdAt:number;costMicros:number}
type Lock=<T>(name:string,action:()=>Promise<T>,signal?:AbortSignal)=>Promise<T>;
const lock:Lock=async(name,action,signal)=>{if(!globalThis.navigator?.locks)throw new Error('浏览器不支持安全研究锁。');return navigator.locks.request(name,{signal},action);};
const active=(s:AbortSignal)=>{if(s.aborted)throw new Error('研究已停止，已发请求可能仍计费。');};
interface Dependencies {adapter:ResearchAdapter;credential:typeof researchCredential;permission:typeof hasPermission;lock:Lock;now:()=>number}
export class OnlineResearch {
 private readonly permissionsChanged=()=>this.cancelAll();private readonly d:Dependencies;private readonly previews=new Map<string,OnlinePreview>();private readonly pending=new Map<string,{controller:AbortController;state:'paused'|'cancelled'}>();private closed=false;private readonly channel:BroadcastChannel|null;private readonly subscription;
 constructor(private readonly database:IdeaClipDB=db,overrides:Partial<Dependencies>={}){globalThis.chrome?.permissions?.onRemoved?.addListener(this.permissionsChanged);this.d={adapter:proxyAdapter(),credential:researchCredential,permission:hasPermission,lock,now:Date.now,...overrides};this.channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('ideaclip-ai-change'):null;if(this.channel)this.channel.onmessage=()=>this.cancelAll();this.subscription=liveQuery(()=>researchConfig(database)).subscribe({next:c=>{for(const p of this.previews.values())if(c.version!==p.config.version||!c.enabled)this.previews.delete(p.id);if(!c.enabled)this.cancelAll();},error:()=>this.cancelAll()});}
 cancel(id:string,state:'paused'|'cancelled'='cancelled'){const p=this.pending.get(id);if(p){p.state=state;p.controller.abort();}}
 cancelAll(){for(const id of this.pending.keys())this.cancel(id);this.previews.clear();}
 close(){this.closed=true;this.cancelAll();this.channel?.close();this.subscription.unsubscribe();globalThis.chrome?.permissions?.onRemoved?.removeListener(this.permissionsChanged);}
 private async gate(p?:OnlinePreview){if(this.closed)throw new Error('研究页面已关闭。');const raw=await researchConfig(this.database);if(!raw.enabled)throw new Error('联网研究已关闭。');const c=validateResearchConfig(raw);const key=await this.d.credential(c.endpoint);if(!key||!await this.d.permission(c.endpoint))throw new Error('研究代理凭据或域名授权已失效。');if(p&&(JSON.stringify(c)!==JSON.stringify(p.config)||key.version!==p.credentialVersion||this.d.now()-p.createdAt>600000))throw new Error('研究配置、凭据或本次确认已失效。');return {c,key};}
 async preview(studyId:string,topic:keyof typeof TOPICS,question:string,queries:string[],urls:string[]):Promise<OnlinePreview>{
  this.previews.clear();const {c,key}=await this.gate();if(!Object.hasOwn(TOPICS,topic)||!question.trim()||question.length>2000)throw new Error('请填写有效研究问题。');
  const plan=await this.database.researchPlans.get(studyId);if(!plan)throw new Error('请先保存研究计划。');
  const requestOps=operations(queries,urls,c);const safeQuestion=redact(question);if(question.includes(key.value)||requestOps.some(o=>o.value.includes(key.value)))throw new Error('问题或请求中含代理凭据，拒绝发送。');
  const p:OnlinePreview={id:crypto.randomUUID(),studyId,revision:plan.revision,planHash:await digest(new Blob([JSON.stringify(plan)])),topic,question:safeQuestion,operations:requestOps.map(o=>({...o,value:o.kind==='search'?redact(o.value):o.value})),config:c,credentialVersion:key.version,createdAt:this.d.now(),costMicros:requestOps.length*Math.ceil(c.priceUsd*1000000)};
  const day=new Date(this.d.now()).toISOString().slice(0,10);const spent=(await this.database.researchUsage.where('day').equals(day).toArray()).reduce((n,u)=>n+u.reservedMicros,0);if(spent+p.costMicros>Math.floor(c.dailyBudgetUsd*1e6))throw new Error('本次计划超过研究每日剩余预算，未发送请求。');
  this.previews.set(p.id,structuredClone(p));return structuredClone(p);
 }
 async remaining(run:ResearchRun){if(run.imported)throw new Error('备份任务无执行授权，请重新填写研究请求并确认。');if(run.next>=run.operations.length)throw new Error('没有确认未发送的剩余请求；已发/失败请求不会重试。');await this.gate();const ops=run.operations.slice(run.next);return this.preview(run.studyId,run.topic,run.question,ops.filter(o=>o.kind==='search').map(o=>o.value),ops.filter(o=>o.kind!=='search').map(o=>o.value));}
 async execute(id:string){const p=this.previews.get(id);this.previews.delete(id);if(!p)throw new Error('本次确认已使用或失效，请重新预览。');const pending={controller:new AbortController(),state:'cancelled' as 'paused'|'cancelled'};this.pending.set(id,pending);const signal=pending.controller.signal;
  let run:ResearchRun|undefined;
  const checkPlan=async()=>{const plan=await this.database.researchPlans.get(p.studyId);if(!plan||await Dexie.waitFor(digest(new Blob([JSON.stringify(plan)])))!==p.planHash)throw new Error('研究计划已变化，请重新预览。');};
  try{return await this.d.lock('ideaclip-online-research',async()=>{
   active(signal);await this.gate(p);await checkPlan();const spent=(await this.database.researchUsage.where('day').equals(new Date(this.d.now()).toISOString().slice(0,10)).toArray()).reduce((n,u)=>n+u.reservedMicros,0);if(spent+p.costMicros>Math.floor(p.config.dailyBudgetUsd*1e6))throw new Error('研究每日剩余预算不足，未发送请求。');const now=this.d.now();run=validateRun({id:p.id,studyId:p.studyId,createdAt:now,updatedAt:now,question:p.question,topic:p.topic,operations:p.operations,next:0,state:'running',reason:'',revision:p.revision});await this.database.researchRuns.add(run);
   for(const [index,op]of p.operations.entries()){
    active(signal);const {c,key}=await this.gate(p);await checkPlan();const day=new Date(this.d.now()).toISOString().slice(0,10);const usage:ResearchUsage={id:`${p.id}:${index}`,runId:p.id,day,createdAt:this.d.now(),reservedMicros:Math.ceil(c.priceUsd*1000000),state:'sent'};
    await this.database.transaction('rw',[this.database.researchUsage,this.database.researchRuns,this.database.researchConfig,this.database.researchPlans],async()=>{
      active(signal);const latest=await this.database.researchConfig.get('online');if(!latest?.enabled||latest.version!==p.config.version)throw new Error('联网授权已撤销。');await checkPlan();const spent=(await this.database.researchUsage.where('day').equals(day).toArray()).reduce((sum,u)=>sum+u.reservedMicros,0);
      if(spent+usage.reservedMicros>Math.floor(c.dailyBudgetUsd*1000000))throw new Error('研究每日预算已耗尽，队列停止。');await this.database.researchUsage.add(usage);await this.database.researchRuns.update(p.id,{next:index+1,updatedAt:this.d.now()});
    });
    let timer:ReturnType<typeof setTimeout>|undefined;const request=new AbortController();const stop=()=>request.abort();signal.addEventListener('abort',stop);let timedOut=false;
    try{
      active(signal);await this.gate(p);timer=setTimeout(()=>{timedOut=true;request.abort();},c.timeoutMs);
      const results=await this.d.adapter.execute(op,c,key.value,request.signal);active(signal);await this.gate(p);await checkPlan();
      const sources:ResearchSource[]=[];for(const r of results){const safe={...r,title:redact(r.title),content:redact(r.content)};if(key.value&&JSON.stringify(safe).includes(key.value))throw new Error('来源包含凭据。');sources.push(validateSource({...safe,id:crypto.randomUUID(),studyId:p.studyId,runId:p.id,question:p.question,collectedAt:this.d.now(),hash:await sourceDigest(safe)}));}
      await this.database.transaction('rw',[this.database.researchSources,this.database.researchUsage,this.database.researchPlans,this.database.researchConfig],async()=>{active(signal);if(!(await this.database.researchConfig.get('online'))?.enabled)throw new Error('联网研究已关闭。');await checkPlan();if(await this.database.researchSources.where('studyId').equals(p.studyId).count()+sources.length>500)throw new Error('研究资料超过500条上限，请导出并新建后续研究。');await this.database.researchSources.bulkAdd(sources);await this.database.researchUsage.update(usage.id,{state:'succeeded'});});
    }catch{await this.database.researchUsage.update(usage.id,{state:request.signal.aborted?'unknown':'failed'});if(op.kind!=='search'&&!signal.aborted){const failed={id:crypto.randomUUID(),studyId:p.studyId,runId:p.id,question:p.question,type:op.kind==='github'?'github' as const:'webpage' as const,url:op.value,title:'读取失败',content:'',publishedAt:null,collectedAt:this.d.now(),status:'failed' as const,reason:'读取失败、超时或返回不符合安全规则；未自动重试。'};await this.database.researchSources.add(validateSource({...failed,hash:await sourceDigest(failed)})).catch(()=>{});}throw new Error(timedOut?'研究请求超时，费用可能已产生，未自动重试。':'研究请求失败或已停止，费用可能已产生；请核对后人工处理。');}
    finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',stop);}
   }
   active(signal);await this.database.researchRuns.update(p.id,{state:'completed',updatedAt:this.d.now(),reason:'本次已确认请求完成；结果仍需核对。'});return p.id;
  },signal);}catch(e){if(run)await this.database.researchRuns.update(p.id,{state:signal.aborted?pending.state:'failed',updatedAt:this.d.now(),reason:signal.aborted?'已停止；已发但结果未知的请求不会自动重试。':e instanceof Error&&/预算|变化|失效/.test(e.message)?e.message:'安全校验或请求失败，未自动重试。'}).catch(()=>{});throw e;}finally{this.pending.delete(id);}
 }
 async recover(){
  for(const run of await this.database.researchRuns.where('state').equals('running').toArray()){
   if(!globalThis.navigator?.locks)continue;
   await navigator.locks.request('ideaclip-online-research',{ifAvailable:true},async available=>{if(!available)return;await this.database.transaction('rw',[this.database.researchRuns,this.database.researchUsage],async()=>{const current=await this.database.researchRuns.get(run.id);if(current?.state!=='running')return;await this.database.researchRuns.update(run.id,{state:'paused',reason:'浏览器或执行页面中断，已发请求费用未知；未自动恢复。',updatedAt:this.d.now()});await this.database.researchUsage.where('runId').equals(run.id).filter(u=>u.state==='sent').modify({state:'unknown'});});});
  }
 }
}
