import {useEffect,useRef,useState} from 'react';
import type {Project} from '../storage';
import type {Task} from './model';
import {checkLocalEvidence,evidenceReview,importCodexReport,localEvidenceSummary} from './local-evidence';
import {REPORT_BYTES,RECORD_BYTES} from './local-evidence-model';

export function LocalEvidence({project,task,disabled,reload}:{project:Project;task:Task;disabled:boolean;reload:()=>Promise<void>}){
 const [selected,setSelected]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now());
 const reportInput=useRef<HTMLInputElement>(null),recordInput=useRef<HTMLInputElement>(null),lock=useRef(false);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(timer);},[]);
 const entries=task.localDeliveries??[],entry=entries.find(e=>e.report.reportId===selected)??entries.at(-1),review=entry?evidenceReview(project,task,entry,now):null;
 async function read(file:File,max:number){if(file.size>max)throw Error('文件超过大小上限，未读取或保存。');try{return new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{throw Error('文件不是有效UTF-8 JSON，未保存。');}}
 async function choose(file:File,record:boolean){if(lock.current||disabled)return;lock.current=true;setBusy(true);setMessage('');try{const text=await read(file,record?RECORD_BYTES:REPORT_BYTES);const message=record&&entry?await checkLocalEvidence(project.id,task.id,entry.report.reportId,text,file.name):await importCodexReport(project.id,task.id,text,file.name);await reload();if(!record)setSelected('');setNow(Date.now());setMessage(message);}catch(e){setMessage(e instanceof Error?e.message:'导入或保存失败，原记录保留。');}finally{lock.current=false;setBusy(false);}}
 return <section className="delivery-check" data-local-evidence>
  <h4>本地交付证据</h4>
  <p>项目ID：<span data-evidence-project>{project.id}</span><br/>任务ID：<span data-evidence-task>{task.id}</span></p>
  <p>Codex报告，尚未独立核验。文件仅本地处理，不执行其中命令或链接，不自动联网，不改变人工验收或任务状态。</p>
  <button disabled={disabled||busy} onClick={()=>reportInput.current?.click()}>导入Codex交付报告</button>
  <input hidden data-report-file type="file" accept=".json,application/json" ref={reportInput} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void choose(file,false);}}/>
  {disabled&&<p>请先保存项目或退出任务编辑后导入。</p>}
  <p>报告≤128KiB，每任务最多10版；新报告只追加，重复ID不同内容拒绝。日志摘录与常见凭据、路径和环境配置脱敏。</p>
  {entry&&<>
   <label>交付报告历史<select value={entry.report.reportId} onChange={e=>setSelected(e.target.value)}>{entries.map(e=><option key={e.report.reportId} value={e.report.reportId}>v{e.version} · {e.report.generatedAt}{e.historical?' · 恢复的历史报告':''}</option>)}</select></label>
   <p>报告ID：{entry.report.reportId}<br/>来源：{entry.sourceName} · 导入时间：{new Date(entry.importedAt).toLocaleString('zh-CN')}<br/>文件SHA256（导入时，非执行签名）：{entry.fileDigest}</p>
   <p>交付摘要：{entry.report.summary}</p>
   <p>Codex声明Commit：{entry.report.commitSha}<br/>GitHub提交核验：{review!.remote}。与Codex声明、CI及人工结论分别记录。</p>
   {!!review!.conflicts.length&&<div role="alert">资料冲突：<ul>{review!.conflicts.map(s=><li key={s}>{s}</li>)}</ul></div>}
   <details><summary>报告修改文件（{entry.report.files.length}）</summary><ul>{entry.report.files.map(s=><li key={s}>{s}</li>)}</ul></details>
   <p>{entry.localCheck&&!entry.localCheck.historical?'本地证据已核对（文件一致性）':entry.localCheck?'历史核对记录，需重新核对本机文件':'本地记录尚未核对'}。仅比对本机记录的结果/时间/日志哈希，不是第三方执行证明。</p>
   {entry.localCheck&&<p>记录ID：{entry.localCheck.recordId} · 核对：{new Date(entry.localCheck.checkedAt).toLocaleString('zh-CN')}<br/>记录文件SHA256：{entry.localCheck.recordDigest}</p>}
   {entry.report.tests.map(t=><article key={t.id}><strong>{t.status==='failed'?'失败':entry.localCheck&&!entry.localCheck.historical?'本地证据已核对（文件一致性）':'Codex报告成功，尚未独立核验'}</strong><p>测试命令（纯文本）：{t.command}<br/>退出码：{t.exitCode??'未取得'} · 执行：{t.startedAt} ～ {t.finishedAt} · 耗时：{t.durationMs}ms</p><details><summary>有限日志摘录及哈希</summary><pre>{t.logExcerpt||'无输出摘录'}</pre><p>SHA256：{t.logSha256}</p></details></article>)}
   {!entry.report.tests.length&&<p>未测试：没有已执行测试记录。</p>}
   {entry.report.notRun.map((t,i)=><p key={i}>未测试：{t.command} · 原因：{t.reason}</p>)}
   {!!entry.report.risks.length&&<p>遗留问题与风险：{entry.report.risks.join('；')}</p>}
   <button disabled={disabled||busy||!entry.report.localRecordId} onClick={()=>recordInput.current?.click()}>核对本地测试记录</button>
   <input hidden data-record-file type="file" accept=".json,application/json" ref={recordInput} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void choose(file,true);}}/>
   <p>记录文件≤512KiB，逐项日志有界；该文件仍可由作者伪造，一致性不等于真实执行认证。普通ZIP不保存完整日志，恢复后需重新核对。</p>
   <p>验收阻塞项与限制：</p><ul>{review!.blockers.map(s=><li key={s}>{s}</li>)}</ul>
   <button onClick={()=>void navigator.clipboard.writeText(localEvidenceSummary(project,task,entry,now)).then(()=>setMessage('完整验收摘要已复制；未执行命令。'),()=>setMessage('复制失败，请检查剪贴板权限。'))}>复制完整验收摘要</button>
  </>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
