import {useEffect,useRef,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {db} from '../storage';
import {REVIEW_STATES} from './github';
import {TASK_KINDS} from './instructions';
import {TaskPackagePanel} from './TaskPackagePanel';
import {LocalEvidence} from './LocalEvidence';
import {MockAuthorization} from './MockAuthorization';
import {RemoteStatus} from './GitHubRemote';
import {HANDOFF_STATES,handoffRows,filterHandoffs,handoffEvidence,directoryFiles,scanInbox,confirmInbox,type HandoffRow,type InboxFile,type InboxDirectory,type InboxCandidate} from './handoff';
import './projects.css';
import {ControlledExecutionPreview} from './ControlledExecutionPreview';

export function HandoffCenter(){
 const [projectLimit,setProjectLimit]=useState(30),[viewLimit,setViewLimit]=useState(20),[rows,setRows]=useState<HandoffRow[]>([]),[loading,setLoading]=useState(true);
 const projects=useLiveQuery(()=>db.projects.orderBy('updatedAt').reverse().limit(projectLimit+1).toArray(),[projectLimit]);
 const [projectFilter,setProjectFilter]=useState(''),[state,setState]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [detail,setDetail]=useState<{projectId:string;taskId:string}|null>(null),[now,setNow]=useState(Date.now()),[error,setError]=useState('');
 const selectedProject=useLiveQuery(()=>detail?db.projects.get(detail.projectId):undefined,[detail?.projectId]);
 const selectedTask=selectedProject?.tasks?.find(t=>t.id===detail?.taskId);
 useEffect(()=>{let active=true;setLoading(true);if(projects)void handoffRows(projects.slice(0,projectLimit)).then(rows=>{if(active){setRows(rows);setLoading(false);}},()=>{if(active){setError('交接历史读取失败，旧记录未修改。');setLoading(false);}});return()=>{active=false;};},[projects,projectLimit]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(timer);},[]);
 useEffect(()=>setViewLimit(20),[projectFilter,state,from,to]);
 let visible:HandoffRow[]=[],filterError='';try{visible=filterHandoffs(rows,projectFilter,state,from,to);}catch(e){filterError=(e as Error).message;}
 const evidence=selectedTask&&selectedProject?handoffEvidence(selectedProject,selectedTask,now):null;

 const directory=useRef<InboxDirectory|null>(null),files=useRef<InboxFile[]>([]),input=useRef<HTMLInputElement>(null),lock=useRef(false);
 const [source,setSource]=useState('未选择本地目录或文件'),[candidates,setCandidates]=useState<InboxCandidate[]>([]),[checked,setChecked]=useState<number[]>([]),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 function clearPreview(){setCandidates([]);setChecked([]);setConfirmed(false);setMessage('');}
 async function chooseDirectory(){
  if(lock.current)return;
  const picker=(window as unknown as {showDirectoryPicker?:(options:{mode:'read'})=>Promise<InboxDirectory>}).showDirectoryPicker;
  if(!picker){setMessage('当前扩展不支持目录选择，请使用“选择候选JSON文件”的受限方案。');return;}
  lock.current=true;setBusy(true);
  try{const handle=await picker.call(window,{mode:'read'});directory.current=handle;files.current=[];clearPreview();setSource('已选择目录：'+handle.name+'（仅第一层，尚未读取内容）');}
  catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setMessage('目录访问不可用或未获授权，请使用受限手动文件选择。');}
  finally{lock.current=false;setBusy(false);}
 }
 async function scan(){if(lock.current)return;lock.current=true;setBusy(true);clearPreview();try{const selected=directory.current?await directoryFiles(directory.current):files.current;setCandidates(await scanInbox(selected));setSource(s=>s.replace('尚未读取内容','本次扫描已完成'));setMessage('扫描完成，未写入报告；请逐项选择并确认。');}catch(e){setMessage(e instanceof Error?e.message:'扫描失败，旧数据未修改。');}finally{lock.current=false;setBusy(false);}}
 async function commit(){if(lock.current)return;lock.current=true;setBusy(true);try{const result=await confirmInbox(candidates,checked,confirmed);setMessage(`导入结果：成功 ${result.filter(x=>x.state==='imported').length}，跳过 ${result.filter(x=>x.state==='skipped').length}，失败 ${result.filter(x=>x.state==='failed').length}。`+result.map(x=>`${x.name}：${x.message}`).join('；'));setCandidates([]);setChecked([]);setConfirmed(false);}catch(e){setMessage(e instanceof Error?e.message:'导入失败，旧记录保留。');}finally{lock.current=false;setBusy(false);}}
 return <div className="shell"><header><a href="notes.html?projects">项目孵化中心</a><a href="notes.html">灵感管理中心</a><a href="settings.html">设置</a></header><main className="projects-main handoff-main">
  <h1>Codex任务交接中心</h1><p>只管理本地文件交接和证据，不启动Codex、Agent Autoloop或任何后台执行器；不联网、不自动验收。</p>
  <section className="panel" data-local-assistant><h2>本地交接助手 · 0.2.3</h2><p>导出任务包 → 本机Git与范围预检 → 单次明确授权 → 可信本地工作区执行 → 核对Git变更并回收交付v2 → 本页人工确认关联。本轮仅通过Mock验收，尚未批准真实开发任务。</p><p>独立本地CLI使用固定普通权限参数；没有OS级隔离，不自动执行任务包里的命令。浏览器仍只提供Mock预演，不能启动Codex或签发本机执行权。</p><p>交付文件在下方收件箱主动选择和确认，不改变人工验收。新本地模式说明：项目内 docs/CODEX-LOCAL-TASK.md；旧Mock门禁说明保留在 docs/CODEX-EXECUTION-SAFETY.md。</p></section>
  <ControlledExecutionPreview/>
  <section className="panel"><h2>已导出任务包</h2>
   <div className="handoff-filters"><label>按项目筛选<select aria-label="交接项目筛选" value={projectFilter} onChange={e=>setProjectFilter(e.target.value)}><option value="">全部已加载项目</option>{projects?.slice(0,projectLimit).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
   <label>按状态筛选<select aria-label="交接状态筛选" value={state} onChange={e=>setState(e.target.value)}><option value="">全部状态</option>{Object.entries(HANDOFF_STATES).map(([k,v])=><option key={k} value={k}>{v}</option>)}<option value="review">待人工验收</option><option value="expired">已失效或历史</option></select></label>
   <label>更新时间从<input type="date" aria-label="交接更新时间从" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>更新时间至<input type="date" aria-label="交接更新时间至" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
   <p>按交接/导入/项目最近更新时间排序，每页20条。仅加载最近{projectLimit}个项目；旧项目可继续加载。时间筛选使用本地日历。</p>
   {projects&&projects.length>projectLimit&&<button onClick={()=>setProjectLimit(n=>n+30)}>加载更多项目</button>}
   {loading&&<p role="status">正在读取本地交接历史…</p>}{(error||filterError)&&<p role="alert">{error||filterError}</p>}
   {!loading&&!filterError&&<p>找到 {visible.length} 个任务包</p>}
   {visible.slice(0,viewLimit).map(r=><article key={r.project.id+':'+r.task.id+':'+r.history.packageId} data-handoff-package={r.history.packageId}>
    <h3>{r.project.title} / {r.task.title}</h3><p>类型：{TASK_KINDS[r.task.kind??'validation']} · 交接状态：{HANDOFF_STATES[r.state]} · {r.awaitingReview?'待人工验收':'人工验收：'+REVIEW_STATES[r.task.acceptanceReview?.state??'pending']}</p>
    <p>仓库：{r.history.repository??r.project.workspace?.repository??r.task.github?.repository??'未绑定'}{!r.history.repository&&'（旧包未保存仓库快照，当前绑定仅供参考）'}</p>
    <p>任务包ID：{r.history.packageId}<br/>生成：{r.history.generatedAt} · 导出记录：{new Date(r.history.exportedAt).toLocaleString('zh-CN')}<br/>交接时间：{r.history.handedOffAt?new Date(r.history.handedOffAt).toLocaleString('zh-CN'):'尚未人工记录'}<br/>最近更新：{new Date(r.updatedAt).toLocaleString('zh-CN')}</p>
    {r.warning&&<p role="status">{r.warning}；历史仍保留，不是执行授权。</p>}
    <button onClick={()=>setDetail({projectId:r.project.id,taskId:r.task.id})}>查看任务包与交付历史</button><a href={`notes.html?projects&open=${encodeURIComponent(r.project.id)}`}>打开项目与人工验收</a>
   </article>)}
   {visible.length>viewLimit&&<button onClick={()=>setViewLimit(n=>n+20)}>更多任务包</button>}
  </section>
  <section className="panel" data-inbox><h2>本地交付收件箱</h2>
   <p>仅用户主动选择并点击扫描才读取。目录只枚举第一层≤100项，不进入子目录；1～20个.json，单份≤128KiB，总计≤2MiB。仅接受0.1.8交付v2；不读取JSON指定的路径或链接，不执行命令。</p>
   <button disabled={busy} onClick={()=>void chooseDirectory()}>选择本地交接目录</button><button disabled={busy} onClick={()=>input.current?.click()}>选择候选JSON文件</button>
   <input hidden multiple type="file" accept=".json,application/json" ref={input} data-inbox-files onChange={e=>{const chosen=Array.from(e.currentTarget.files??[]);e.currentTarget.value='';if(chosen.length){directory.current=null;files.current=chosen;clearPreview();setSource(`已选择 ${chosen.length} 个本地文件，尚未读取内容`);}}}/>
   <p>{source}。选择与授权仅留在当前页面内存，关闭后失效，不进入ZIP。</p><button disabled={busy||source.startsWith('未选择')} onClick={()=>void scan()}>扫描候选报告（只读）</button>
   {candidates.map((c,i)=><article key={i} data-inbox-candidate><label><input type="checkbox" aria-label={`选择候选 ${i+1}`} disabled={busy||c.state!=='valid'} checked={checked.includes(i)} onChange={e=>{setChecked(e.target.checked?[...checked,i]:checked.filter(n=>n!==i));setConfirmed(false);}}/>{c.name} · {c.state==='valid'?'检查通过，待确认':c.state==='duplicate'?'重复，跳过':'拒绝'}</label><p>{c.reason}</p>{c.report&&<p>项目ID：{c.report.projectId}<br/>任务ID：{c.report.taskId}<br/>仓库：{c.report.repository}<br/>任务包：{c.report.taskPackage?.packageId}<br/>报告ID：{c.report.reportId}<br/>Codex声明：{c.report.summary}（未独立核验）</p>}</article>)}
   {!!candidates.length&&<><label><input type="checkbox" aria-label="确认批量关联交付报告" checked={confirmed} disabled={busy||!checked.length} onChange={e=>setConfirmed(e.target.checked)}/>我已逐项核对所选项目、任务、仓库和报告，只确认关联证据，不授权执行或人工验收通过</label><button disabled={busy||!confirmed||!checked.length} onClick={()=>void commit()}>确认关联所选报告</button></>}
   {message&&<p role="status">{message}</p>}
  </section>
  {selectedProject&&selectedTask&&evidence&&<section className="panel" data-handoff-detail><h2>交付证据：{selectedTask.title}</h2><p>项目：{selectedProject.title} · 人工验收：{REVIEW_STATES[selectedTask.acceptanceReview?.state??'pending']} · 看板：{selectedTask.status}（仅原项目中明确操作可改变）</p>
   <dl><dt>Codex声明</dt><dd>{evidence.codex}</dd><dt>本地测试</dt><dd>{evidence.local}</dd><dt>GitHub Commit/PR对照</dt><dd>{evidence.remote}</dd><dt>CI</dt><dd>{evidence.ci}</dd><dt>允许修改范围</dt><dd>{evidence.scope}</dd></dl><h3>缺失证据及限制</h3><ul>{evidence.missing.map((s,i)=><li key={i}>{s}</li>)}</ul>
   <RemoteStatus task={selectedTask}/><TaskPackagePanel project={selectedProject} task={selectedTask} disabled={busy} reload={async()=>{}}/><MockAuthorization key={selectedProject.id+':'+selectedTask.id} project={selectedProject} task={selectedTask} disabled={busy}/><LocalEvidence project={selectedProject} task={selectedTask} disabled={busy} reload={async()=>{}}/>
   <a href={`notes.html?projects&open=${encodeURIComponent(selectedProject.id)}`}>返回项目进行人工验收</a>
  </section>}
 </main></div>;
}
