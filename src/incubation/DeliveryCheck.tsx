import {useEffect,useRef,useState} from 'react';
import type {Task,Workspace} from './model';
import {API_ORIGIN} from './github-sync';
import {ciState,deliveryFresh,deliverySummary,DELIVERY_ERRORS,missingEvidence,refreshDelivery,scopeState} from './delivery';
import {referenceKey} from './github-sync';

export function DeliveryCheck({projectId,task,workspace,disabled,reload,onReview}:{projectId:string;task:Task;workspace?:Workspace;disabled:boolean;reload:()=>Promise<void>;onReview:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false),[now,setNow]=useState(Date.now()),lock=useRef(false);
 useEffect(()=>{const tick=()=>setNow(Date.now());const timer=setInterval(tick,10000);window.addEventListener('focus',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick);};},[]);
 if(!task.github?.commitSha&&!task.github?.prNumber)return null;
 const snapshot=task.deliveryCheck,matching=!!snapshot&&snapshot.key===referenceKey(task.github),fresh=deliveryFresh(task,now),s=matching?snapshot:undefined;
 const date=(n:number|undefined)=>n===undefined?'无':new Date(n).toLocaleString('zh-CN');
 const check=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setOpen(true);try{const approved=await chrome.permissions.request({origins:[API_ORIGIN]});await refreshDelivery(projectId,task.id,undefined,undefined,async()=>approved&&await chrome.permissions.contains({origins:[API_ORIGIN]}));await reload();setNow(Date.now());}catch{setError('检查或本地保存失败；原快照保留，请核对关联与工作区，未改变任务验收。');}finally{lock.current=false;setBusy(false);}};
 return <section className="delivery-check" data-delivery-check>
  <button disabled={disabled||busy} onClick={()=>void check()}>{busy?'正在只读检查…':'检查开发成果'}</button>
  {disabled&&<small>请先保存或退出任务编辑后检查。</small>}
  <details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Codex 开发交付检查 · {s?(s.error?'查询失败（旧快照已过期）':fresh?'远程已核实':'历史结果已过期'):'尚未检查'}</summary>
   <p>仓库：{task.github.repository} · 只读来源：https://api.github.com</p>
   <p>最近查询时间：{date(s?.attemptAt)}；最近成功时间：{date(s?.checkedAt)}</p>
   {s?.error&&<p role="alert">[{s.error}] {DELIVERY_ERRORS[s.error]}；旧快照仅供历史参考，不自动重试。</p>}
   {!matching&&snapshot&&<p>关联已变化，旧快照不适用于当前任务。</p>}
   {s?.targets.map(t=><section key={t.kind}>
    <strong>{t.kind==='pr'?'PR #'+t.number:'Commit'} · {t.sha}</strong><p>{t.message} · 提交/更新时间：{t.updatedAt}</p>
    <p>文件 {t.files.length}：新增 {t.files.filter(f=>f.status==='added').length}，删除 {t.files.filter(f=>f.status==='removed').length}，其余修改 {t.files.filter(f=>!['added','removed'].includes(f.status)).length}；行数 +{t.additions} / -{t.deletions}。{t.filesComplete?'文件列表完整':'文件列表不完整（分页上限或来源变化）'}</p>
    <p>CI：{ciState(t.ci)}{t.ci.error?` [${t.ci.error}] ${DELIVERY_ERRORS[t.ci.error]}`:''}。检查 {t.ci.checks.length}，失败 {t.ci.checks.filter(c=>c.state==='failed').length}，进行中 {t.ci.checks.filter(c=>c.state==='pending').length}。</p>
    <details><summary>修改文件与范围检查</summary><ul>{t.files.map(f=><li key={f.path}>{f.path}{f.previousPath?' ← '+f.previousPath:''} [{f.status}] +{f.additions}/-{f.deletions} · {scopeState(f,workspace,task.github!.repository)}</li>)}</ul></details>
    {!!t.ci.checks.length&&<details><summary>GitHub CI / Check Runs 明细</summary><ul>{t.ci.checks.map((c,i)=><li key={i}>{c.name}：{{passed:'通过',failed:'失败',pending:'进行中',other:'跳过或无明确结论'}[c.state]}</li>)}</ul></details>}
   </section>)}
   <p>缺失证据与限制：</p><ul>{missingEvidence(task,workspace,now).map(s=><li key={s}>{s}</li>)}</ul>
   <button onClick={()=>void navigator.clipboard.writeText(deliverySummary(task,workspace,now)).then(()=>setError('验收摘要已复制；未执行命令。'),()=>setError('复制失败，请检查剪贴板权限。'))}>复制开发验收摘要</button>
   <button disabled={disabled||busy} onClick={onReview}>人工验收（编辑任务）</button>
  </details>{error&&<p role="status">{error}</p>}
 </section>;
}
