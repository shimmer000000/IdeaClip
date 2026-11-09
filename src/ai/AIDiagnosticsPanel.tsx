import {useEffect,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {db} from '../storage';
import {advice,diagnosticExport,diagnosticSummary,errorExplanation,legacyDiagnostic,repairInstructions,sanitizeDiagnostic,type AIDiagnostic} from './diagnostics';
const labels={responseReceived:'完整响应读取',modelOutputComplete:'模型输出完整（finish_reason）',jsonParsed:'JSON解析',schemaValid:'Schema校验',evidenceValid:'来源证据校验',reportSaved:'本地报告保存',inMemoryReport:'有效报告保留在当前内存'};
const state=(v:boolean|null)=>v===null?'未知':v?'是':'否';const value=(v:unknown)=>v===null||v===undefined?'未知':String(v);
const stageNames={authorization:'授权与快照复查',reservation:'本地预算预留',transport:'模型响应接收',json:'JSON解析',schema:'Schema结构校验',evidence:'来源证据校验',validator:'本地校验器',format:'报告格式化',storage:'本地保存',unknown:'未知'};
export function AIDiagnosticsPanel({noteId,transient}:{noteId:string;transient?:AIDiagnostic|null}){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState(''),[legacy,setLegacy]=useState(false),[confirmDelete,setConfirmDelete]=useState(false),[message,setMessage]=useState('');
 const [hiddenTransient,setHiddenTransient]=useState('');
 useEffect(()=>{if(transient)setSelected(transient.id);},[transient?.id]);
 const rows=useLiveQuery(()=>open?db.aiDiagnostics.where('noteId').equals(noteId).toArray().then(r=>r.sort((a,b)=>b.createdAt-a.createdAt).slice(0,20)):[],[open,noteId]);
 const old=useLiveQuery(()=>open&&legacy?db.aiUsage.orderBy('createdAt').reverse().filter(r=>r.noteId===noteId&&r.status!=='succeeded'&&r.status!=='reserved').limit(20).toArray():[],[open,legacy,noteId]);
 const available=(rows??[]).map(sanitizeDiagnostic);if(transient&&transient.id!==hiddenTransient&&!available.some(r=>r.id===transient.id))available.unshift(sanitizeDiagnostic(transient));
 if(legacy)for(const u of old??[])if(!available.some(r=>r.attemptId===u.id))available.push(sanitizeDiagnostic(legacyDiagnostic(u)));
 const report=available.find(r=>r.id===selected)??available[0];
 async function copy(text:string,ok:string){try{await navigator.clipboard.writeText(text);setMessage(ok);}catch{setMessage('剪贴板不可用，请使用JSON导出。');}}
 function download(){if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(diagnosticExport(report),null,2)],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`IdeaClip-AI-Diagnostic-${report.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setMessage('已导出脱敏诊断JSON；未上传、未调用AI。');}
 async function clear(){try{await db.aiDiagnostics.where('noteId').equals(noteId).delete();setHiddenTransient(transient?.id??'');setSelected('');setConfirmDelete(false);setMessage('已删除本笔记诊断历史；费用账本和正常报告保留。旧费用记录中的通用错误摘要仍可只读查看。');}catch{setMessage('删除诊断失败；原记录保留。');}}
 return <section className="panel" data-ai-diagnostics><h2>AI分析诊断</h2><p>仅本机安全元数据，最多保留全机最近20条。查看、复制和导出不发送API请求；不含笔记正文、来源摘录、截图或模型原始响应。</p><button onClick={()=>setOpen(v=>!v)}>{open?'收起诊断报告':'查看诊断报告'}</button>
 {open&&<><button onClick={()=>setLegacy(true)}>查看旧版错误摘要（只读）</button>{!available.length&&<p>暂无详细诊断。旧版未记录的字段原因无法恢复，可查看旧版费用记录摘要；不要反复重试付费请求。</p>}
 {available.length>0&&<label>诊断历史<select aria-label="诊断历史" value={report?.id??''} onChange={e=>setSelected(e.target.value)}>{available.map((r,i)=><option key={r.id+'-'+i} value={r.id}>{new Date(r.createdAt).toLocaleString('zh-CN')} · {r.code} · {r.legacy?'旧版摘要':'本机诊断'}</option>)}</select></label>}
 {report&&<article data-ai-diagnostic-report><h3>错误概要</h3><p>诊断ID：{report.id} · {new Date(report.createdAt).toLocaleString('zh-CN')} · IdeaClip {report.appVersion}</p><p>分析类型：{report.analysisType==='note'?'单篇灵感笔记':report.analysisType} · 阶段：{stageNames[report.stage]} · 安全错误码：{report.code}</p><p>{errorExplanation(report.code)}</p>{transient?.id===report.id&&!rows?.some(r=>r.id===report.id)&&<p className="notice">本条诊断尚未确认已写入历史，当前只保证本页可查看和导出；关闭后可能无法恢复。</p>}{report.legacy&&<p className="notice">历史信息不足，无法定位具体字段。旧响应未保存，不能恢复或猜测真实失败原因。</p>}
 <h3>具体失败原因</h3><dl><dt>失败字段</dt><dd>{report.detail?.field??'未知'}</dd><dt>校验规则</dt><dd>{report.detail?.rule??'未知'}</dd><dt>期望类型/约束</dt><dd>{report.detail?.expected??'未知'}</dd><dt>实际数据类型</dt><dd>{report.detail?.actual??'未知'}</dd><dt>实际数组项目数</dt><dd>{value(report.detail?.arrayItems)}</dd><dt>字符数</dt><dd>{value(report.detail?.characters)}</dd><dt>栏目 / 条目序号</dt><dd>{report.detail?.sectionIndex===null||report.detail?.sectionIndex===undefined?'未知':report.detail.sectionIndex+1} / {report.detail?.itemIndex===null||report.detail?.itemIndex===undefined?'未知':report.detail.itemIndex+1}</dd></dl>
 <h3>模型和模板</h3><p>{report.model} · {report.templateName} · 模板版本 {report.templateVersion}</p><h3>请求、响应与保存状态</h3><p>finish_reason：{report.finishReason??'未知'}</p><dl>{Object.entries(labels).map(([k,label])=><div key={k}><dt>{label}</dt><dd>{state(report.checks[k as keyof typeof labels])}</dd></div>)}</dl><p>内存状态仅表示当时保留；关闭页面后未保存的有效报告不保证可恢复。</p>
 <h3>Token与费用</h3><p>实际输入Token：{value(report.inputTokens)}；实际输出Token：{value(report.outputTokens)}。输入估算上限：{value(report.estimatedInput)}；输出上限：{value(report.maxOutput)}。</p><p>本地预留：{report.reservedMicros===null?'未知':'USD '+(report.reservedMicros/1e6).toFixed(6)}；服务商实际扣费：未知。预留与实际Token不能当作服务商账单，失败不自动退款或重试。</p>
 <h3>来源证据检查</h3><p>{report.analysisType==='note'?'单笔记仅使用evidence逐字摘录，不使用研究sourceId/quote/original字段。':'研究来源ID与quote规则独立校验。'} 不显示正文或引用，不做Unicode/空白归一化，不放宽证据规则。</p><h3>修复建议</h3><p>{advice(report)}</p>
 <div className="ai-actions"><button onClick={()=>void copy(diagnosticSummary(report),'已复制脱敏诊断摘要。')}>复制脱敏诊断摘要</button><button onClick={download}>导出诊断报告JSON</button><button onClick={()=>void copy(repairInstructions(report),'已复制给Codex的修复指令；未自动执行或上传。')}>复制给Codex的修复指令</button></div></article>}
 <button onClick={()=>setConfirmDelete(true)}>删除本笔记诊断历史</button>{confirmDelete&&<div role="dialog" aria-label="删除诊断历史确认"><p>仅删除本笔记诊断，不删除笔记、分析报告或费用账本。确认删除？</p><button onClick={()=>void clear()}>确认删除诊断历史</button><button onClick={()=>setConfirmDelete(false)}>取消删除诊断</button></div>}</>}
 {message&&<p role="status">{message}</p>}</section>;
}
