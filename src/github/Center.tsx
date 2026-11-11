import { appendGitHubRepository } from '../collection/storage';
import { localReport } from './local';
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Note } from '../storage';
import { noteDefaults } from '../inspiration/model';
import { writeNoteIndex } from '../library/projections';
import { githubProjects } from '../collection/model';
import { collectPublicProject, publicText, sourceAppendix } from './public';
import { GITHUB_SKILL } from './skill';
import { skillMarkdown } from '../skills/model';
export function GitHubCenter(){
 const [input,setInput]=useState(''),[captureId,setCaptureId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[latest,setLatest]=useState('');const lock=useRef(false);
 const captures=useLiveQuery(()=>db.contentCaptures.orderBy('collectedAt').reverse().limit(100).toArray());
 const history=useLiveQuery(()=>db.notes.where('tags').equals('github-analysis').reverse().toArray());
 const repository=githubProjects([input])[0];const selected=captures?.find(c=>c.id===captureId);
 async function collect(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
  if(!repository)throw Error('请输入完整GitHub仓库地址，短链接和截断地址须人工核实。');
  if(typeof chrome!=='undefined'&&chrome.permissions){const origins=['https://api.github.com/*'];if(!await chrome.permissions.contains({origins})&&!await chrome.permissions.request({origins}))throw Error('未授权GitHub只读域名，本次未请求。');}
  const p=await collectPublicProject(repository), now=Date.now(),id=crypto.randomUUID();
  const body=selected?`原始帖子：${selected.originalUrl}\n原笔记：${selected.noteId??'未保存'}\n采集记录：${selected.id}`:'';
  const note:Note={...noteDefaults(repository),id,title:repository.slice(19),url:repository,body,content:publicText(p),tags:['github-analysis'],status:'inbox',revision:1,createdAt:now,updatedAt:now};
  const report=localReport(p);
  await db.transaction('rw',[db.notes,db.noteCatalog,db.noteSearch,db.libraryState,db.analyses],async()=>{await db.notes.add(note);await writeNoteIndex(note,db);await db.analyses.add({id:crypto.randomUUID(),noteId:id,createdAt:now,template:GITHUB_SKILL,skillReport:report,model:'免费本地整理（无AI调用）',sourceUrl:repository,content:skillMarkdown(report,GITHUB_SKILL,'免费本地整理（无AI调用）',now)+sourceAppendix(note.content)});});setLatest(id);
 }catch(e){setError(e instanceof Error?e.message:'获取失败，未知。');}finally{setBusy(false);lock.current=false;}}
 return <div className="shell"><header><a href="notes.html">返回灵感管理中心</a><a href="notes.html?projects">项目孵化中心</a></header><main className="analysis-main"><h1>GitHub项目分析</h1><p>免费本地整理 · 主动获取官方公开资料 · 不克隆、不安装、不执行项目 · 不自动访问官网</p><section className="panel"><h2>选择公开仓库</h2><label>已有采集记录<select aria-label="已有采集记录" value={captureId} disabled={busy} onChange={e=>{setCaptureId(e.target.value);setInput('');}}><option value="">手动输入</option>{captures?.map(c=><option key={c.id} value={c.id}>{c.title} · {c.githubLinks.length?'有仓库链接':'待核实，可手动补充'}</option>)}</select></label>{selected&&<><p>原始URL：{selected.originalUrl}</p>{selected.githubLinks.map(u=><button disabled={busy} key={u} onClick={()=>setInput(u)}>{u}</button>)}{selected.noteId&&<p><a href={`note.html?id=${encodeURIComponent(selected.noteId)}`}>返回原笔记</a> · <a href={`analysis.html?noteId=${encodeURIComponent(selected.noteId)}`}>查看已有商业报告（不重新生成）</a></p>}</>}<label>完整GitHub仓库地址<input aria-label="完整GitHub仓库地址" value={input} disabled={busy} onChange={e=>{setInput(e.target.value);setLatest('');}} placeholder="https://github.com/owner/repo" /></label>{selected&&repository&&<button disabled={busy} onClick={()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');void appendGitHubRepository(selected.id,repository).catch(e=>setError(e instanceof Error?e.message:'补充失败')).finally(()=>{lock.current=false;setBusy(false);});}}>保存手动补充到采集记录</button>}<p>仓库：{repository?.slice(19)??'尚未识别完整仓库'} · 公开资料状态：{latest?'已获取并保存独立快照':'尚未联网核实'}</p><button className="primary" disabled={busy||!repository} onClick={()=>void collect()}>{busy?'正在获取…':'获取公开项目资料'}</button><p>最多3次GET、每项10秒、响应2MiB、README最多100000字符、无分页、60秒冷却。失败不自动重试；404不等于证明仓库不存在。</p></section>{error&&<p role="alert">{error}</p>}{latest&&<p role="status">公开资料和免费整理已保存。<a href={`analysis.html?noteId=${latest}&template=builtin-github`}>查看报告、证据与AI费用预览</a></p>}<section className="panel"><h2>历史项目资料与报告</h2>{history?.map(n=><p key={n.id}><a href={`analysis.html?noteId=${n.id}&template=builtin-github`}>{n.title} · {new Date(n.createdAt).toLocaleString('zh-CN')}</a></p>)}<p>每次采集创建独立快照笔记；报告页可查看来源、复制、导出、历史版本和创建孵化项目。AI单独预览并单次确认，失败不自动重试。</p></section></main></div>;
}
