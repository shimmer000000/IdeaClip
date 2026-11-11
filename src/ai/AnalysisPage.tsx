import { MVPReview } from '../github/MVPReview';
import { QUALITY_LABELS, type QualityState } from '../collection/quality';
import { httpUrl } from '../collection/model';
import { listSkills, preferences } from '../skills/repository';
import { BUSINESS_ID, codexInstructions } from '../skills/model';
import { useEffect, useId, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, type Analysis } from '../storage';
import { AIEngine, type Preview, type AnalysisResult } from './engine';
import { LABELS, SECTIONS } from './report';
import { LocalPicture } from '../library/media';
import './ai.css';
import {AIDiagnosticsPanel} from './AIDiagnosticsPanel';
import {RequestFailure} from './transport';
import type {AIDiagnostic} from './diagnostics';
import {businessOutputPlan} from './business-output';

function BusinessBudget({configured,templateLimit}:{configured:number;templateLimit:number}){
 const b=businessOutputPlan(configured,templateLimit);
 return <div className="notice" data-business-budget><p>15栏输出预算：设置 {b.configured}；模板上限 {b.templateLimit}；本次使用 {b.effective} Token。取两者较小值，不自动提高上限。</p><p>优先每栏1条简洁内容，保留全部15栏。{b.low?'当前低于建议的2048 Token，存在截断风险，可取消并到设置调整后重新预览。':'建议至少2048 Token仅为经验指引，不能保证所有模型输出完整。'} JSON模式不能代替Schema及逐字证据校验。</p></div>;
}

export function Confirmation({ preview, close, confirm, retryWarning }: { preview: Preview; close: () => void; confirm: () => void; retryWarning?: string }) {
  const ref = useRef<HTMLDialogElement>(null); const [ack, setAck] = useState(false); const [images, setImages] = useState(false);
  const day=new Date().toISOString().slice(0,10);const reserved=useLiveQuery(async()=>{try{return (await db.aiUsage.where('day').equals(day).toArray()).reduce((sum,u)=>sum+u.reservedMicros,0);}catch{return null;}},[day]);
  const [retryAck, setRetryAck] = useState(false);
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal(); }, []);
  return <dialog ref={ref} className="ai-confirm" aria-label="本次 AI 分析确认" onCancel={event => { event.preventDefault(); close(); }}><h2>确认本次发送与预计费用</h2>{retryWarning && <><p className="notice">{retryWarning}</p><label className="check-line"><input type="checkbox" checked={retryAck} onChange={event => setRetryAck(event.target.checked)} />我理解可能重复计费，确认手动重试</label></>}<p>接收方：{preview.config.provider} · <strong>{preview.config.endpoint}</strong></p><p>分析模板：{preview.researchId ? preview.workflowId ? "商业机会研究 v2" : "公开资料综合研究 v1" : preview.projectId ? "项目孵化待审核方案 v1" : preview.sources ? "多灵感横向对比 v1" : preview.template.name + " · " + preview.template.id + " · 版本 " + preview.template.version}</p>{!preview.researchId&&!preview.projectId&&!preview.sources&&preview.template.id===BUSINESS_ID&&<BusinessBudget configured={preview.configuredMaxOutput??preview.config.maxOutput} templateLimit={preview.template.maxOutput}/>}{preview.noteEvidenceCount!==undefined&&<p className="notice" data-note-evidence>逐字证据选择：已从本次脱敏资料生成 {preview.noteEvidenceCount} 段临时证据。模型可选择编号，程序取回原文后仍严格校验；目录与原文一同发送并计入下方Token及费用估算，不增加其他笔记或截图。</p>}<details><summary>最终请求文本（系统约束与模板偏好）</summary><h3>系统约束</h3><pre>{preview.systemPrompt}</pre><h3>用户资料与模板偏好</h3><pre>{preview.requestText}</pre></details><p>模型：{preview.config.model} · 认证：{preview.config.auth === 'bearer' ? '密钥随请求发送至该端点' : '代理自行鉴权，不发送 Key'}</p><p>发送范围：{preview.researchId ? "当前研究问题、目标和主动选择的已采集来源文本、URL、ID、时间及哈希；不自动联网、不含截图或其他笔记。" : preview.projectId ? "项目名称、描述、目标用户、需求、商业假设、MVP、成本、验证目标，以及下方选中灵感的标题、正文、感悟和 URL。不发送阶段历史、任务、旧方案或截图。" : <>标题、采集正文、个人感悟、来源 URL，及主动选择的 {preview.imageIds.length} 张截图。不会发送其他笔记、历史报告、问题、标签或未提交编辑。</>}</p><details open><summary>文本发送预览（已移除常见凭据）</summary><h3>{preview.title}</h3>{preview.sources?.map(s=><section key={s.id}><h4>{s.title} · 版本 {s.revision} · {QUALITY_LABELS[s.quality as QualityState] ?? s.quality}</h4><p>{s.url}</p><pre>{s.content}</pre><pre>{s.body}</pre></section>)}<p className="preserve-text">{preview.url}</p><h4>采集正文</h4><pre>{preview.content || '空'}</pre><h4>我的感悟</h4><pre>{preview.body || '空'}</pre></details>{preview.imageIds.length > 0 && <div className="ai-image-choice">{preview.imageIds.map((id, index) => <LocalPicture key={id} id={id} alt={`本次将发送截图 ${index + 1}`} />)}</div>}<p>输入 Token 保守估算上界：{preview.inputTokensUpper}；最大输出：{preview.config.maxOutput} Token；本次预留费用估算：<strong>USD {(preview.costMicros / 1000000).toFixed(6)}</strong>。</p><p>UTC 今日每日预算：USD {preview.config.dailyBudgetUsd.toFixed(6)}；当前剩余预算（本次预留前）：{reserved===undefined||reserved===null?'读取中或不可用，不代表免费':'USD '+(Math.max(0,Math.floor(preview.config.dailyBudgetUsd*1e6)-reserved)/1e6).toFixed(6)}。发送前仍会事务复查。</p><p className="notice">估算基于你填写的单价和图像 Token 预留，并非服务商账单保证。网络失败或取消后服务端也可能计费，已预留预算不会自动退回；不自动重试。网页指令仅作为不可信资料，AI 仍可能出错。</p><label className="check-line"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />我确认发送上述资料，并同意本次可能产生的服务商费用</label>{preview.imageIds.length > 0 && <label className="check-line"><input type="checkbox" checked={images} onChange={event => setImages(event.target.checked)} />我明确同意上传上方主动选择的截图，已确认没有不应发送的秘密</label>}<div className="ai-actions"><button onClick={close}>取消，不发送</button><button className="primary" disabled={!ack || (preview.imageIds.length > 0 && !images) || (!!retryWarning && !retryAck)} onClick={confirm}>确认并发起本次分析</button></div></dialog>;
}
function ReportSections({ sections }: { sections: { key: string; title: string; claims: import('./report').Claim[] }[] }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const groupId = useId();
  return <>
    <div className="ai-report-controls" role="group" aria-label="报告栏目显示">
      <button type="button" onClick={() => setExpanded(sections.map(section => section.key))}>全部展开</button>
      <button type="button" onClick={() => setExpanded([])}>全部折叠</button>
      <span className="muted">{sections.length} 个栏目 · 点击标题查看内容</span>
    </div>
    {sections.map((section, index) => {
      const open = expanded.includes(section.key), contentId = `${groupId}-content-${index}`;
      return <section key={section.key} className="ai-report-section">
        <h3><button type="button" className="ai-section-toggle" aria-expanded={open} aria-controls={contentId} onClick={() => setExpanded(old => old.includes(section.key) ? old.filter(key => key !== section.key) : [...old, section.key])}>
          <span className="ai-section-number">{String(index + 1).padStart(2, '0')}</span>
          <span className="ai-section-title">{section.title}</span>
          <span className="ai-section-count">{section.claims.length} 条</span>
          <span className="ai-section-arrow" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button></h3>
        <div id={contentId} hidden={!open} className="ai-section-content">
          {section.claims.map((claim, claimIndex) => <div key={claimIndex} className={`ai-claim ${claim.kind}`}><span className="badge">{LABELS[claim.kind]}</span><p className="preserve-text">{claim.text}</p>{claim.evidence && <blockquote>来源摘录：{claim.evidence}</blockquote>}</div>)}
        </div>
      </section>;
    })}
  </>;
}
export function ReportView({ analysis }: { analysis: Analysis }) {
  const sections = analysis.skillReport && analysis.template
    ? analysis.template.sections.map(section => ({ key: section.key, title: section.label, claims: analysis.skillReport!.sections[section.key] }))
    : analysis.report ? Object.entries(SECTIONS).map(([key, title]) => ({ key, title, claims: analysis.report!.sections[key as keyof typeof SECTIONS] })) : null;
  return <section className="panel ai-report"><h2>{!analysis.template || analysis.template.id === BUSINESS_ID ? "商业分析" : analysis.template.name}报告</h2>{analysis.template && <p>模板 {analysis.template.name} · {analysis.template.id} · 版本 {analysis.template.version}</p>}<p>{analysis.model || '早期报告（模型未记录）'} · {new Date(analysis.createdAt).toLocaleString('zh-CN')} · 发送截图 {analysis.imageCount ?? 0} 张</p>{httpUrl(analysis.sourceUrl) && <p><a href={httpUrl(analysis.sourceUrl)!} target="_blank" rel="noreferrer">查看本次分析原网页 ↗</a> · 来源 URL 为分析时的快照，页面内容可能改变。</p>}<p className="notice">来源陈述仅代表原始资料说法，未独立核验；推测和待验证假设均需调查验证。AI 不保证收入、用户规模或利润。</p>{sections ? <ReportSections key={analysis.id} sections={sections} /> : <pre>{analysis.content}</pre>}</section>;
}
export function AnalysisPage() {
  const noteId = new URLSearchParams(location.search).get('noteId') ?? '';
  const reportId = new URLSearchParams(location.search).get('report') ?? '';
  const requested = useLiveQuery(() => reportId ? db.analyses.get(reportId) : undefined, [reportId]);
  const note = useLiveQuery(async () => (await db.notes.get(noteId)) ?? null, [noteId]);
  const settings = useLiveQuery(() => getSettings()); const config = useLiveQuery(() => db.aiConfig.get('manual'));
  const skills = useLiveQuery(() => listSkills()); const pref = useLiveQuery(() => preferences());
  const [templateId, setTemplateId] = useState(['builtin-github','builtin-personal'].includes(new URLSearchParams(location.search).get('template')??'') ? new URLSearchParams(location.search).get('template')! : '');
  const chosenTemplate = templateId || pref?.defaultId || BUSINESS_ID;
  const [limit, setLimit] = useState(20);
  const history = useLiveQuery(() => db.analyses.where('[noteId+createdAt]').between([noteId, 0], [noteId, Number.MAX_SAFE_INTEGER], true, true).reverse().limit(limit + 1).toArray(), [noteId, limit]);
  const engine = useRef<AIEngine | null>(null); const alive = useRef(true); const locked = useRef(false);
  const [selected, setSelected] = useState<string[]>([]); const [preview, setPreview] = useState<Preview | null>(null); const [result, setResult] = useState<AnalysisResult | null>(null); const [viewing, setViewing] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [diagnostic,setDiagnostic]=useState<AIDiagnostic|null>(null);
  useEffect(() => { alive.current = true; engine.current = new AIEngine(); return () => { alive.current = false; engine.current?.close(); engine.current = null; }; }, []);
  useEffect(() => { setSelected([]); setPreview(null); }, [config?.version]);
  useEffect(() => { if (!settings?.aiEnabled) setPreview(null); }, [settings?.aiEnabled]);
  async function run(action: () => Promise<void>) { if (locked.current) return; locked.current = true; setBusy(true); setError(''); setMessage('');try{await action();}catch(error){if(alive.current){setMessage('');setError(error instanceof Error?error.message:'本地分析操作失败。');if(error instanceof RequestFailure&&error.diagnostic?.report)setDiagnostic(error.diagnostic.report);}}finally{locked.current=false;if(alive.current)setBusy(false);} }
  function prepare() { void run(async () => { const next = await engine.current!.preview(noteId, selected, chosenTemplate); if (alive.current) setPreview(next); }); }
  function submit() { const id = preview?.id; if (!id) return; setPreview(null); void run(async () => { setMessage('等待本地队列或正在分析，可随时取消。'); const next = await engine.current!.run(id); if (alive.current) { setResult(next); setViewing(next.analysis); setMessage(next.saved ? '分析报告已自动保存为新历史版本。' : '已获得报告，但本地保存失败；结果仍在本页，可重试保存、复制或导出，无需重新调用 AI。'); } }); }
  const displayed = viewing ?? (requested?.noteId === noteId ? requested : null) ?? history?.[0] ?? null;
  function exportReport() { if (!displayed) return; const url = URL.createObjectURL(new Blob([displayed.content], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `IdeaClip-Analysis-${displayed.id}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  return <div className="shell"><header><a className="brand" href="notes.html"><span className="mark">i</span>IdeaClip</a><nav><a href="notes.html">灵感库</a><a href="settings.html">AI 设置</a></nav></header><main className="analysis-main"><h1>AI 商业模式分析</h1><p className="muted">仅手动触发 · 每次发送前确认 · 不联网研究 · 不自动执行网页指令</p>{note === undefined ? <p>正在读取笔记…</p> : !note ? <p role="alert">笔记不存在，请返回灵感库。</p> : <><section className="panel"><h2>{note.title}</h2><p>只分析已保存版本；有未提交编辑时请先保存。AI 总开关：{settings?.aiEnabled ? '已开启' : '已关闭'}。</p>{!settings?.aiEnabled && <p>请在设置页手动开启并配置服务商；当前不会创建 AI 请求。</p>}<label>选择分析模板<select aria-label="选择分析模板" disabled={busy} value={chosenTemplate} onChange={e => { setTemplateId(e.target.value); setPreview(null); engine.current?.cancelAll(); }}>{skills?.filter(s => s.enabled).map(s => <option key={s.id} value={s.id}>{s.name} · {s.version}</option>)}{skills && !skills.some(s => s.id === chosenTemplate && s.enabled) && <option value={chosenTemplate}>模板已停用或删除，请重新选择</option>}</select></label><p>{skills?.find(s => s.id === chosenTemplate)?.description}</p>{chosenTemplate===BUSINESS_ID&&config&&<BusinessBudget configured={config.maxOutput} templateLimit={skills?.find(s=>s.id===BUSINESS_ID)?.maxOutput??4096}/>}<p>输入要求：{skills?.find(s => s.id === chosenTemplate)?.inputRequirements}</p><fieldset disabled={busy || !settings?.aiEnabled || !config?.vision}><legend>主动选择发送的截图（默认全部不发送，最多 3 张）</legend>{note.screenshotIds.length ? <div className="ai-image-choice">{note.screenshotIds.map((id, index) => <label key={id}><input type="checkbox" aria-label={`发送截图 ${index + 1}`} checked={selected.includes(id)} disabled={!selected.includes(id) && selected.length >= 3} onChange={event => { setPreview(null); setSelected(old => event.target.checked ? [...old, id] : old.filter(value => value !== id)); }} /><LocalPicture id={id} alt={`可选择截图 ${index + 1}`} />截图 {index + 1}</label>)}</div> : <p>此笔记没有截图。</p>}</fieldset>{!config?.vision && <p className="muted">当前模型未确认支持图像，只允许文本分析。</p>}<div className="ai-actions"><button className="primary" disabled={busy || !settings?.aiEnabled || note.saveState !== 'saved'} onClick={prepare}>{error ? '重试：重新预览并确认' : history?.length ? '重新分析：预览发送内容' : 'AI 分析：预览发送内容'}</button>{busy && <button onClick={() => engine.current?.cancelAll()}>取消当前分析与排队任务</button>}<a href={`note.html?id=${encodeURIComponent(noteId)}`} target="_blank" rel="noreferrer">编辑笔记</a></div></section></>}{message && <p role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}{result && !result.saved && <button onClick={() => { void run(async () => { await engine.current!.save(result.analysis); setResult({ ...result, saved: true }); setMessage('分析结果已保存，未产生新的 AI 请求。'); }); }}>重试保存分析结果</button>}
    {note?.tags.includes('github-analysis') && <section className="panel"><h2>公开资料证据与采集时间</h2><a href="notes.html?github">返回GitHub项目分析</a><details><summary>查看本次公开资料、来源与采集时间</summary><pre style={{whiteSpace:'pre-wrap'}}>{note.content}</pre></details><p>{note.body}</p>{note.body.match(/原笔记：([a-zA-Z0-9-]+)/)?.[1] && note.body.match(/原笔记：([a-zA-Z0-9-]+)/)?.[1]!=='未保存' && <p><a href={`note.html?id=${encodeURIComponent(note.body.match(/原笔记：([a-zA-Z0-9-]+)/)![1])}`}>返回原笔记</a> · <a href={`analysis.html?noteId=${encodeURIComponent(note.body.match(/原笔记：([a-zA-Z0-9-]+)/)![1])}`}>查看原有商业报告</a></p>}<p>许可证未知时不得默认允许商业二次开发。收入、月活、客单价、转化率没有独立证据；README仅为第三方披露。</p></section>}
    <AIDiagnosticsPanel noteId={noteId} transient={diagnostic??(!result?.saved?result?.diagnostic:null)}/>
    <section className="panel"><h2>分析历史版本</h2>{!history?.length ? <p>暂无分析报告。</p> : <div className="ai-history">{history.slice(0, limit).map(analysis => <button key={analysis.id} onClick={() => setViewing(analysis)}>{new Date(analysis.createdAt).toLocaleString('zh-CN')} · {analysis.template?.name ?? '商业模式拆解（旧报告）'} · {analysis.template?.version ?? '旧版'} · {analysis.model || '早期报告'} · {analysis.id.slice(0, 8)}</button>)}{history.length > limit && <button onClick={() => setLimit(value => value + 20)}>加载更多历史版本</button>}</div>}</section>{displayed && <><div className="ai-actions"><button onClick={() => { void run(async () => { await navigator.clipboard.writeText(displayed.content); setMessage('已复制报告。'); }); }}>复制报告</button><button onClick={exportReport}>导出 Markdown</button>{displayed.template?.display === "codex" && displayed.skillReport && <button onClick={() => { void run(async () => { await navigator.clipboard.writeText(codexInstructions(displayed.skillReport!, displayed.template!)); setMessage("已复制完整中文开发指令，请核对后交给 Codex。"); }); }}>复制完整中文开发指令</button>}</div><a href={`notes.html?projects&from=analysis&id=${encodeURIComponent(displayed.id)}`}>从报告创建项目</a><a href={`notes.html?research&from=analysis&id=${encodeURIComponent(displayed.id)}`}>深度研究</a><a href={`notes.html?research&wizard&from=analysis&id=${encodeURIComponent(displayed.id)}`}>启动深度研究</a><ReportView analysis={displayed} />{displayed.template?.id==='builtin-personal'&&<MVPReview key={displayed.id} analysis={displayed}/>}</>}{preview && <Confirmation preview={preview} close={() => { setPreview(null); engine.current?.cancelAll(); }} confirm={submit} />}</main><footer><a href="notes.html?projects">项目孵化中心</a> · 联网深度研究：即将推出。</footer></div>;
}
