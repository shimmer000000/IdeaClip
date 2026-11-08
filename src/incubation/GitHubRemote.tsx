import {useEffect,useState} from 'react';
import type {Project} from '../storage';
import type {Task} from './model';
import {API_ORIGIN,refreshGitHub,REMOTE_ERRORS} from './github-sync';
import {githubStatus,nextGitHubExpiry,GITHUB_KIND_LABELS,GITHUB_STATE_LABELS} from './github-status';
export function RemoteStatus({task}:{task:Task}){
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const update=()=>{clearTimeout(timer);const time=Date.now();setNow(time);const next=nextGitHubExpiry(task,time);if(next!==undefined)timer=setTimeout(update,Math.min(next-time,2147483647));};
  update();window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return()=>{clearTimeout(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[task.githubRemote]);
 const view=githubStatus(task,now);
 return <div aria-label="GitHub远程状态"><p>最近查询时间：{view.attemptAt===undefined?'尚未查询':new Date(view.attemptAt).toLocaleString('zh-CN')}{view.attemptAt!==undefined&&' · 来源 api.github.com'}</p>{view.historical&&<p>历史结果已过期（超过15分钟、恢复快照或关联已变化），需手动刷新；不会自动联网。</p>}{!view.items.length&&<p>尚未查询：未关联Issue、PR或Commit。</p>}{view.queryError&&<p role="status">查询失败：{view.queryError} · {REMOTE_ERRORS[view.queryError]}</p>}{view.items.map(({kind,item,error,status})=><div key={kind} data-github-kind={kind}><p>{GITHUB_KIND_LABELS[kind]}：{status}{item&&` · ${status==='远程已核实'?'':'上次成功快照：'}${GITHUB_STATE_LABELS[item.state]}`}</p>{error&&<p role="status">{GITHUB_KIND_LABELS[kind]}安全错误：{error} · {REMOTE_ERRORS[error]}</p>}<p>最近成功时间：{item?new Date(item.checkedAt).toLocaleString('zh-CN'):'暂无'}</p>{item&&<><p>远程更新时间：{item.updatedAt}</p><p>{item.sha} {item.summary}</p></>}</div>)}<p>远程状态不等于人工验收，不改变看板状态。</p></div>;
}
export function GitHubRemote({projectId,task,reload,disabled=false}:{disabled?:boolean;projectId:string;task:Task;reload:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');if(!task.github)return null;
 return <section><button disabled={busy||disabled} onClick={()=>{if(busy)return;setBusy(true);setError('');const permission=chrome.permissions.request({origins:[API_ORIGIN]});void permission.then(async approved=>{await refreshGitHub(projectId,task.id,undefined,undefined,async()=>approved&&await chrome.permissions.contains({origins:[API_ORIGIN]}));await reload();}).catch(()=>setError('查询或本地保存失败；未改变人工验收。')).finally(()=>setBusy(false));}}>刷新 GitHub 状态</button><p>仅手动GET当前关联，免Token；最多3次请求，60秒内重复刷新使用缓存。只申请api.github.com权限。</p>{error&&<p role="alert">{error}</p>}<RemoteStatus task={task}/></section>;
}
export function GitHubOverview({projects}:{projects:Project[]}){
 const [selected,setSelected]=useState('');return <section className="panel"><h2>GitHub 开发状态总览</h2><label>按项目查看<select aria-label="GitHub总览项目" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">全部已加载项目</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label><p>仅显示已加载项目的本地查询快照，不后台刷新；较早项目可在项目列表点击“更多项目”。</p>{projects.filter(p=>!selected||p.id===selected).map(p=><div key={p.id}>{p.tasks?.filter(t=>t.github).map(t=><details key={t.id}><summary>{p.title} / {t.title}</summary><RemoteStatus task={t}/></details>)}</div>)}</section>;
}
