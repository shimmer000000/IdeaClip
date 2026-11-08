import {useState} from 'react';
import type {Project} from '../storage';
import type {Task} from './model';
import {API_ORIGIN,refreshGitHub,referenceKey,REMOTE_ERRORS} from './github-sync';
const labels={open:'开启',closed:'关闭',draft:'草稿',merged:'已合并',exists:'提交真实存在',issue_is_pr:'该编号实际是PR，不能作为普通Issue'};
export function RemoteStatus({task}:{task:Task}){
 const r=task.githubRemote;if(!r)return <p>未核实：尚未查询远程状态。</p>;
 let match=false;try{match=!!task.github&&r.key===referenceKey(task.github);}catch{/* Invalid association never becomes verified. */}
 const expired=!match||r.historical||Date.now()-r.attemptAt>15*60000;
 return <div><p>{expired?'历史结果已过期（或关联已变化）':'GitHub最近查询'} · {new Date(r.attemptAt).toLocaleString('zh-CN')} · 来源 api.github.com</p>{Object.entries(r.errors).map(([k,e])=><p key={k} role="status">查询失败 {k}：{e} · {REMOTE_ERRORS[e!]}</p>)}{(['issue','pr','commit'] as const).map(k=>{const i=r.items[k];return i&&<div key={k}><p>{k}：{!expired&&!r.errors[k]&&!r.errors.query&&Date.now()-i.checkedAt<15*60000?'远程已核实':'历史快照，当前未核实'} · {labels[i.state]}</p><p>最近成功查询：{new Date(i.checkedAt).toLocaleString('zh-CN')} · 远程更新时间：{i.updatedAt}</p><p>{i.sha} {i.summary}</p></div>;})}<p>远程状态不等于人工验收，不改变看板状态。</p></div>;
}
export function GitHubRemote({projectId,task,reload,disabled=false}:{disabled?:boolean;projectId:string;task:Task;reload:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');if(!task.github)return null;
 return <section><button disabled={busy||disabled} onClick={()=>{if(busy)return;setBusy(true);setError('');const permission=chrome.permissions.request({origins:[API_ORIGIN]});void permission.then(async approved=>{await refreshGitHub(projectId,task.id,undefined,undefined,async()=>approved&&await chrome.permissions.contains({origins:[API_ORIGIN]}));await reload();}).catch(()=>setError('查询或本地保存失败；未改变人工验收。')).finally(()=>setBusy(false));}}>刷新 GitHub 状态</button><p>仅手动GET当前关联，免Token；最多3次请求，60秒内重复刷新使用缓存。只申请api.github.com权限。</p>{error&&<p role="alert">{error}</p>}<RemoteStatus task={task}/></section>;
}
export function GitHubOverview({projects}:{projects:Project[]}){
 const [selected,setSelected]=useState('');return <section className="panel"><h2>GitHub 开发状态总览</h2><label>按项目查看<select aria-label="GitHub总览项目" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">全部已加载项目</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label><p>仅显示已加载项目的本地查询快照，不后台刷新；较早项目可在项目列表点击“更多项目”。</p>{projects.filter(p=>!selected||p.id===selected).map(p=><div key={p.id}>{p.tasks?.filter(t=>t.github).map(t=><details key={t.id}><summary>{p.title} / {t.title}</summary><RemoteStatus task={t}/></details>)}</div>)}</section>;
}
