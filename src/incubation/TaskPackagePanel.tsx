import {useRef,useState} from 'react';
import type {Project} from '../storage';
import type {Task} from './model';
import {previewTaskPackage,confirmPackageExport,markPackageHandedOff,checkTaskPackage,packageStage,PACKAGE_BYTES} from './task-package';
import type {TaskPackage} from './task-package-model';
import {REVIEW_STATES} from './github';

export function TaskPackagePanel({project,task,disabled,reload}:{project:Project;task:Task;disabled:boolean;reload:()=>Promise<void>}){
 const [pack,setPack]=useState<TaskPackage|null>(null),[confirmed,setConfirmed]=useState(false),[handoff,setHandoff]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const locked=useRef(false),fileInput=useRef<HTMLInputElement>(null);
 async function run(fn:()=>Promise<void>){if(locked.current||disabled)return;locked.current=true;setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e instanceof Error?e.message:'任务包操作失败，旧记录保留。');}finally{locked.current=false;setBusy(false);}}
 async function download(){if(!pack)return;const result=await confirmPackageExport(project.id,task.id,pack,confirmed);const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));try{const a=document.createElement('a');a.href=url;a.download=`IdeaClip-CodexTask-${result.packageId}.json`;a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}await reload();setPack(null);setConfirmed(false);setMessage('任务包导出记录已保存，请核对本地下载文件。未启动Codex，执行仍须另行明确批准。');}
 return <section className="delivery-check" data-task-package>
  <h4>Codex 本地任务交接</h4>
  <p>只导出当前已审核的软件开发任务。人工研究、功能测试和未绑定范围不转换为开发任务；文件仅数据，不启动Codex、后台服务或付费API。</p>
  <p>交接状态：{!task.taskPackages?.length?'待执行（尚未导出）':'见下方独立历史'}；人工验收：{REVIEW_STATES[task.acceptanceReview?.state??'pending']}（独立，交接或导入不会改变）。</p>
  <button disabled={disabled||busy} onClick={()=>void run(async()=>{setPack(await previewTaskPackage(project.id,task.id));setConfirmed(false);})}>导出 Codex 任务包</button>
  <button disabled={disabled||busy} onClick={()=>fileInput.current?.click()}>校验任务包（只读）</button>
  <input hidden data-package-file ref={fileInput} type="file" accept=".json,application/json" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void run(async()=>{if(file.size>PACKAGE_BYTES)throw Error('任务包超过128KiB，未读取。');let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{throw Error('任务包不是UTF-8 JSON。');}setMessage(await checkTaskPackage(project.id,task.id,text));});}}/>
  {disabled&&<p>请先保存任务与项目，退出编辑后交接。</p>}
  {pack&&<div role="dialog" aria-label="Codex任务包预览与确认" data-package-preview>
   <h4>任务包预览与安全检查</h4><p>仓库：{pack.task.repository}<br/>工作目录（仅此显式任务包包含）：{pack.task.workingDirectory}<br/>允许范围：{pack.task.allowedPaths.join('；')}</p>
   <p>任务包ID：{pack.packageId}<br/>生成时间：{pack.generatedAt}<br/>SHA-256：{pack.contentSha256}</p>
   <p>仅本任务，已审核类型与执行边界；任务内容变化会拒绝旧预览。SHA-256是完整性校验，不是可信签名或执行许可。</p>
   <details><summary>完整 JSON 预览（纯文本）</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:400,overflow:'auto'}}>{JSON.stringify(pack,null,2)}</pre></details>
   <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对当前任务、仓库、目录、范围和脱敏内容，同意导出本地数据包；不授权自动执行或付费调用</label>
   <button disabled={!confirmed||busy||disabled} onClick={()=>void run(download)}>确认导出 JSON 任务包</button><button disabled={busy} onClick={()=>{setPack(null);setConfirmed(false);}}>取消导出预览</button>
  </div>}
  {(task.taskPackages??[]).map(h=><details key={h.packageId} data-package-history><summary>{h.packageId} · {packageStage(task,h)}</summary>
   <p>生成：{h.generatedAt}；导出记录：{new Date(h.exportedAt).toLocaleString('zh-CN')}<br/>SHA-256：{h.contentSha256}<br/>已交接时间：{h.handedOffAt?new Date(h.handedOffAt).toLocaleString('zh-CN'):'尚未人工记录'}</p>
   {task.localDeliveries?.filter(e=>e.report.taskPackage?.packageId===h.packageId&&e.report.taskPackage.contentSha256===h.contentSha256).map(e=><p key={e.report.reportId}>结果报告v{e.version}：{e.report.reportId}（Codex声明，未自动验收）</p>)}
   <p>修改任务/仓库/目录/范围或撤销审核后需重新导出；历史记录不证明当前授权。执行必须由用户另行向Codex批准，文件自身不能授权。</p>
   {!h.historical&&!h.handedOffAt&&<><label><input type="checkbox" checked={handoff===h.packageId} onChange={e=>setHandoff(e.target.checked?h.packageId:'')}/>我确认已通过本地文件交接；仅记录交接，不启动执行</label><button disabled={busy||disabled||handoff!==h.packageId} onClick={()=>void run(async()=>{await markPackageHandedOff(project.id,task.id,h.packageId,handoff===h.packageId);await reload();setHandoff('');setMessage('已记录人工交接；未启动Codex，未通过验收或完成任务。');})}>记录已交接</button></>}
  </details>)}
  <p>最多10版；普通ZIP仅备份交接元数据与结果关联，不含完整任务包、工作目录或执行授权。0.1.7报告v1继续可用；关联本包须交付v2的taskPackage ID及SHA-256。</p>
  {message&&<p role="status">{message}</p>}
 </section>;
}
