import {canonical} from './task-package-model.ts';

export interface ExecutionSnapshot {
 source:'local-preflight'|'browser-mock';projectId:string;taskId:string;packageId:string;packageHash:string;
 repository:string;workspace:string;allowedPaths:string[];goal:string;binding:string;
 git:{head:string;branch:string;dirty:boolean;conflicts:boolean;fingerprint:string};
 codex:{version:string;supported:boolean;fingerprint:string};
 blockers:string[];
}
export const GATE_MESSAGES:Record<string,string>={AUTH_REQUIRED:'缺少本次Mock授权。',AUTH_UNKNOWN:'复制、伪造或其他会话的授权无效。',AUTH_USED:'本次授权已经消费，不能重复使用。',AUTH_EXPIRED:'授权已过期或时钟回退，必须重新预检并明确批准。',PREVIEW_UNKNOWN:'预览不属于当前会话，请重新预检。',PREVIEW_EXPIRED:'预览已过期，请重新预检。',CONFIRM_REQUIRED:'请明确确认仅授权本次Mock。',PREFLIGHT_BLOCKED:'预检存在安全阻塞，未授予授权。',SNAPSHOT_CHANGED:'任务、范围、目录、Git或CLI快照已变化，旧授权失效。',CANCELLED:'本次Mock已取消；授权已消费，不自动重试。',TIMEOUT:'本次Mock超时；授权已消费，不自动重试。',MOCK_FAILED:'Mock执行器失败；授权已消费，不自动重试。',TTL_INVALID:'授权期限必须在1秒至5分钟之间。'};
export class GateError extends Error {code:string;constructor(code:string){super(GATE_MESSAGES[code]??'预检失败，未授予执行权限。');this.code=code;}}
function deny(code:string):never {throw new GateError(code);}
export interface GatePreview {readonly snapshot:ExecutionSnapshot;readonly issuedAt:number;readonly expiresAt:number;readonly mockOnly:true;readonly realExecutionAuthorized:false}
export interface MockPermit {readonly kind:'mock-only';readonly issuedAt:number;readonly expiresAt:number;readonly realExecutionAuthorized:false}
type PreviewRecord={snapshot:string;issuedAt:number;expiresAt:number;issuedTick:number;expiresTick:number};
type PermitRecord=PreviewRecord&{used:boolean};
export class SingleUseMockGate {
 #previews=new WeakMap<object,PreviewRecord>();#permits=new WeakMap<object,PermitRecord>();
 #read:()=>Promise<ExecutionSnapshot>;#now:()=>number;#steady:()=>number;
 constructor(read:()=>Promise<ExecutionSnapshot>,now=()=>Date.now(),steady=()=>performance.now()){this.#read=read;this.#now=now;this.#steady=steady;}
 #expired(r:PreviewRecord){const now=this.#now(),tick=this.#steady();return now<r.issuedAt||now>=r.expiresAt||tick<r.issuedTick||tick>=r.expiresTick;}
 async preview():Promise<GatePreview>{
  const snapshot=await this.#read(),issuedAt=this.#now();
  // Return a detached display copy; the private comparison is not derived from mutable JSON.
  const p=Object.freeze({snapshot:structuredClone(snapshot),issuedAt,expiresAt:issuedAt+300000,mockOnly:true as const,realExecutionAuthorized:false as const});
  const issuedTick=this.#steady();this.#previews.set(p,{snapshot:canonical(snapshot),issuedAt,expiresAt:p.expiresAt,issuedTick,expiresTick:issuedTick+300000});return p;
 }
 async authorize(p:GatePreview,confirmed:boolean,ttl=120000):Promise<MockPermit>{
  if(!confirmed)deny('CONFIRM_REQUIRED');if(!Number.isInteger(ttl)||ttl<1000||ttl>300000)deny('TTL_INVALID');
  const r=this.#previews.get(p);if(!r)deny('PREVIEW_UNKNOWN');this.#previews.delete(p);if(canonical(p.snapshot)!==r.snapshot)deny('PREVIEW_UNKNOWN');
  if(this.#expired(r))deny('PREVIEW_EXPIRED');
  const current=await this.#read();if(canonical(current)!==r.snapshot)deny('SNAPSHOT_CHANGED');if(current.blockers.length||current.git.dirty||current.git.conflicts||!current.codex.supported)deny('PREFLIGHT_BLOCKED');
  const issuedAt=this.#now(),issuedTick=this.#steady();if(this.#expired(r))deny('PREVIEW_EXPIRED');
  const permit=Object.freeze({kind:'mock-only' as const,issuedAt,expiresAt:issuedAt+ttl,realExecutionAuthorized:false as const});this.#permits.set(permit,{snapshot:r.snapshot,issuedAt,expiresAt:permit.expiresAt,issuedTick,expiresTick:issuedTick+ttl,used:false});return permit;
 }
 async runMock(permit:MockPermit|null,options:{outcome?:'success'|'failure'|'timeout';signal?:AbortSignal;timeoutMs?:number}={}){
  if(!permit)deny('AUTH_REQUIRED');const r=this.#permits.get(permit);if(!r)deny('AUTH_UNKNOWN');if(r.used)deny('AUTH_USED');
  r.used=true; // Atomic before any await. Failure, cancel, timeout and changed inputs all burn the grant.
  if(this.#expired(r))deny('AUTH_EXPIRED');if(options.signal?.aborted)deny('CANCELLED');
  const timeout=options.timeoutMs??5000;if(!Number.isInteger(timeout)||timeout<10||timeout>5000)deny('TIMEOUT');
  const started=performance.now();let readTimer:ReturnType<typeof setTimeout>|undefined;
  const cancelRead=()=>cancelPending?.(new GateError('CANCELLED'));let cancelPending:((e:GateError)=>void)|undefined;
  const current=await new Promise<ExecutionSnapshot>((resolve,reject)=>{cancelPending=reject;readTimer=setTimeout(()=>reject(new GateError('TIMEOUT')),timeout);options.signal?.addEventListener('abort',cancelRead,{once:true});void this.#read().then(resolve,reject);if(options.signal?.aborted)cancelRead();}).finally(()=>{clearTimeout(readTimer);options.signal?.removeEventListener('abort',cancelRead);cancelPending=undefined;});
  if(canonical(current)!==r.snapshot)deny('SNAPSHOT_CHANGED');
  if(current.blockers.length||current.git.dirty||current.git.conflicts||!current.codex.supported)deny('PREFLIGHT_BLOCKED');
  if(this.#expired(r))deny('AUTH_EXPIRED');if(options.signal?.aborted)deny('CANCELLED');
  const remaining=timeout-(performance.now()-started);if(remaining<=0)deny('TIMEOUT');
  // Fixed timer-only simulator. No command, executor callback, network or process-launch parameter exists.
  await new Promise<void>((resolve,reject)=>{
   let timer:ReturnType<typeof setTimeout>,deadline:ReturnType<typeof setTimeout>;
   const finish=(code?:string)=>{clearTimeout(timer);clearTimeout(deadline);options.signal?.removeEventListener('abort',cancel);code?reject(new GateError(code)):resolve();};
   const cancel=()=>finish('CANCELLED');options.signal?.addEventListener('abort',cancel,{once:true});
   deadline=setTimeout(()=>finish('TIMEOUT'),remaining);
   if(options.outcome!=='timeout')timer=setTimeout(()=>finish(options.outcome==='failure'?'MOCK_FAILED':undefined),30);
   if(options.signal?.aborted)finish('CANCELLED');
  });
  return {state:'mock-completed' as const,actualCodexStarted:false as const,actualCommandsExecuted:false as const,acceptanceChanged:false as const};
 }
}
