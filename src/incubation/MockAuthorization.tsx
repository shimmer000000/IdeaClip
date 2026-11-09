import {useEffect,useRef,useState} from 'react';
import {db,type Project} from '../storage';
import type {Task} from './model';
import {checkTaskPackage,currentPackageBinding} from './task-package';
import {decodeTaskPackage,PACKAGE_BYTES} from './task-package-model';
import {digest} from './local-evidence-model';
import {GateError,SingleUseMockGate,type ExecutionSnapshot,type GatePreview,type MockPermit} from './execution-gate';

/** Browser-only simulator: no filesystem/Git/CLI access and no real execution permission. */
export function MockAuthorization({project,task,disabled}:{project:Project;task:Task;disabled:boolean}){
 const [text,setText]=useState(''),[preview,setPreview]=useState<GatePreview|null>(null),[permit,setPermit]=useState<MockPermit|null>(null),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [dirty,setDirty]=useState(false),[changed,setChanged]=useState(false),[outcome,setOutcome]=useState<'success'|'failure'|'timeout'>('success');
 const [consumed,setConsumed]=useState(false),[now,setNow]=useState(Date.now());
 const values=useRef({text,dirty,changed,projectId:project.id,taskId:task.id});values.current={text,dirty,changed,projectId:project.id,taskId:task.id};
 const input=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null),lock=useRef(false),gate=useRef<SingleUseMockGate|null>(null);
 if(!gate.current)gate.current=new SingleUseMockGate(async()=>{
  const v=values.current;if(!v.text)throw new GateError('PREVIEW_UNKNOWN');await checkTaskPackage(v.projectId,v.taskId,v.text);
  const pack=await decodeTaskPackage(v.text),p=await db.projects.get(v.projectId),t=p?.tasks?.find(t=>t.id===v.taskId);if(!p||!t)throw new GateError('SNAPSHOT_CHANGED');
  const snapshot:ExecutionSnapshot={source:'browser-mock',projectId:p.id,taskId:t.id,packageId:pack.packageId,packageHash:pack.contentSha256,repository:pack.task.repository,workspace:pack.task.workingDirectory,allowedPaths:pack.task.allowedPaths,goal:pack.task.goal,binding:await digest(currentPackageBinding(p,t)),git:{head:(v.changed?'b':'a').repeat(40),branch:'mock-only',dirty:v.dirty,conflicts:false,fingerprint:'browser-mock-'+v.changed+'-'+v.dirty},codex:{version:'Mock（未探测本机CLI）',supported:true,fingerprint:'browser-simulator-only'},blockers:v.dirty?['GIT_DIRTY']:[]};return snapshot;
 });
 useEffect(()=>()=>abort.current?.abort(),[]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 async function action(fn:()=>Promise<void>){if(lock.current||disabled)return;lock.current=true;setBusy(true);try{await fn();}catch(e){setMessage(e instanceof GateError?`[${e.code}] ${e.message}`:'[PREFLIGHT_FAILED] 包与当前审核/仓库/目录/范围不匹配或已变化，未执行。');}finally{lock.current=false;setBusy(false);}}
 function reset(){abort.current?.abort();setText('');setPreview(null);setPermit(null);setConfirmed(false);setMessage('会话已清除，旧授权不再可用。');gate.current=null;}
 return <section className="delivery-check" data-mock-authorization><h3>单次授权与安全预检（仅Mock）</h3>
  <p>核对当前任务：{task.title}。浏览器无法验证本机Git、CLI及worktree，下方Git状态是显式Mock，不是真实预检；真实信息须用本地助手。仅内存授权，不进入ZIP，不授权真实执行或付费操作。</p>
  <p>预计方式：固定计时器Mock，不构造Codex命令；未来真实执行可能写文件、联网、Git推送，仍需单独设计边界并批准。当前真实执行阻塞：REAL_EXECUTOR_DISABLED / BROWSER_GIT_NOT_VERIFIED。</p>
  <button disabled={disabled||busy} onClick={()=>input.current?.click()}>选择任务包（Mock预检）</button><input hidden ref={input} type="file" accept=".json,application/json" data-auth-package onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void action(async()=>{if(file.size>PACKAGE_BYTES)throw new GateError('PREVIEW_UNKNOWN');const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());await checkTaskPackage(project.id,task.id,text);setText(text);setPreview(null);setPermit(null);setConfirmed(false);setMessage('任务包与当前已审核导出历史一致；仍未授权，Git/CLI仅Mock。');});}}/>
  <label><input type="checkbox" aria-label="模拟Git存在未提交修改" checked={dirty} disabled={busy} onChange={e=>{setDirty(e.target.checked);setConfirmed(false);}}/>模拟Git存在未提交修改</label>
  <label><input type="checkbox" aria-label="模拟Git HEAD变化" checked={changed} disabled={busy} onChange={e=>{setChanged(e.target.checked);setConfirmed(false);}}/>模拟Git HEAD变化（使旧授权失效）</label>
  <button disabled={disabled||busy||!text} onClick={()=>void action(async()=>{setPreview(await gate.current!.preview());setPermit(null);setConfirmed(false);setMessage('预览仅供本次Mock，尚未取得授权。');})}>预览单次Mock执行</button>
  {preview&&<div data-auth-preview><p>项目ID：{preview.snapshot.projectId}<br/>任务ID：{preview.snapshot.taskId}<br/>当前任务：{preview.snapshot.goal}<br/>仓库：{preview.snapshot.repository}<br/>工作目录：{preview.snapshot.workspace}<br/>允许修改：{preview.snapshot.allowedPaths.join('；')}<br/>包哈希：{preview.snapshot.packageHash}</p>
   <p>Git：{preview.snapshot.git.branch} / {preview.snapshot.git.dirty?'有未提交修改':'模拟干净'}（仅Mock）；CLI：{preview.snapshot.codex.version}。阻塞：{preview.snapshot.blockers.join('；')||'本次Mock无阻塞'}。当前真实执行授权：未获得。</p>
   <label><input type="checkbox" aria-label="确认仅授权本次Mock" disabled={busy||disabled} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我确认仅授权该项目/任务/仓库/包哈希的本次Mock，有效期2分钟、只可消费一次；不授权真实Codex或人工验收通过</label>
   <button disabled={busy||disabled||!confirmed} onClick={()=>void action(async()=>{setPermit(await gate.current!.authorize(preview,confirmed));setConsumed(false);setConfirmed(false);setMessage('已取得单次Mock授权，有效期2分钟；真实执行授权仍为false。');})}>授予单次Mock授权</button></div>}
  <p>当前会话Mock授权：{!permit?'未取得':consumed?'已消费，不可复用':now<permit.issuedAt||now>=permit.expiresAt?'已过期，不可使用':'可消费一次，截止 '+new Date(permit.expiresAt).toLocaleString('zh-CN')}；真实Codex任务进程启动：否。</p>
  <label>模拟结果<select aria-label="模拟执行结果" disabled={busy} value={outcome} onChange={e=>setOutcome(e.target.value as typeof outcome)}><option value="success">成功</option><option value="failure">失败</option><option value="timeout">超时</option></select></label>
  <button disabled={busy||disabled} onClick={()=>void action(async()=>{abort.current=new AbortController();try{await gate.current!.runMock(permit,{outcome,signal:abort.current.signal,timeoutMs:600});setMessage('Mock完成；授权已消费。实际Codex启动：否；实际命令执行：否；人工验收和任务状态未改变。');}finally{if(permit)setConsumed(true);}})}>运行一次Mock</button>
  <button disabled={!busy} onClick={()=>abort.current?.abort()}>取消Mock</button><button disabled={busy} onClick={reset}>清除本次Mock会话</button>
  {message&&<p role="status">{message}</p>}
 </section>;
}
