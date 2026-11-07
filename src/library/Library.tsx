import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage';
import { httpUrl, platformNames } from '../collection/model';
import { openEditor, PendingDrafts } from '../inspiration/Entry';
import { executeBatch, type BatchOperation, type BatchResult } from './actions';
import { dayBoundary, initialFilter, PAGE_SIZE, type LibraryFilter } from './query';
import type { NoteCard } from './projections';
import { LocalPicture } from './media';
import { useCatalog } from './useCatalog';
import './library.css';

function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal(); }, []);
  return <dialog ref={ref} className={`library-modal ${wide ? 'wide' : ''}`} aria-label={title} onCancel={event => { event.preventDefault(); close(); }}><div className="modal-heading"><h2>{title}</h2><button onClick={close} aria-label={`关闭${title}`}>关闭 ×</button></div>{children}</dialog>;
}
function NoteTile({ note, mode, selected, disabled, toggle, detail, gallery, favorite, remove, edit }: { note: NoteCard; mode: string; selected: boolean; disabled: boolean; toggle: () => void; detail: () => void; gallery: (ids: string[], index: number) => void; favorite: () => void; remove: () => void; edit: () => void }) {
  const [imageIndex, setImageIndex] = useState(0);
  const index = Math.min(imageIndex, Math.max(0, note.screenshotIds.length - 1));
  const source = httpUrl(note.url);
  return <article className={`note library-note ${mode} ${selected ? 'selected' : ''}`} onClick={event => { if (!(event.target as Element).closest('button,a,input,label')) detail(); }}>
    <div className="tile-selection"><label><input type="checkbox" aria-label={`选择笔记：${note.title}`} checked={selected} disabled={disabled} onChange={toggle} />选择</label><span className="badge">{note.saveState === 'draft' ? '草稿' : platformNames[note.platform] || '网页'}</span></div>
    <div className="tile-media">{note.screenshotIds.length ? <><button className="thumbnail-button" onClick={() => gallery(note.screenshotIds, index)} aria-label={`查看大图：${note.title}`}><LocalPicture id={note.screenshotIds[index]} alt={`截图缩略图：${note.title}`} /></button>{note.screenshotIds.length > 1 && <div className="tile-gallery"><button onClick={() => setImageIndex((index + note.screenshotIds.length - 1) % note.screenshotIds.length)} aria-label={`上一张截图：${note.title}`}>‹</button><span>{index + 1} / {note.screenshotIds.length}</span><button onClick={() => setImageIndex((index + 1) % note.screenshotIds.length)} aria-label={`下一张截图：${note.title}`}>›</button></div>}</> : <div className="no-screenshot">✳<span>文字灵感</span></div>}</div>
    <div className="tile-content"><p className="tile-site">{note.site || '手动记录'}{note.author ? ` · ${note.author}` : ''}</p><h2><button className="title-button" onClick={detail}>{note.title}</button></h2><p className="thought-summary">{note.bodySummary || '还没有填写感悟。'}</p><div className="tags">{note.category && <span className="category-chip">{note.category}</span>}{note.tags.map(tag => <span key={tag}>#{tag}</span>)}</div><div className="tile-time"><time dateTime={new Date(note.createdAt).toISOString()}>创建 {new Date(note.createdAt).toLocaleDateString('zh-CN')}</time><span>修改 {new Date(note.updatedAt).toLocaleDateString('zh-CN')}</span></div><div className="tile-actions"><button disabled={disabled} onClick={favorite} aria-label={`${note.favorite ? '取消收藏' : '收藏'}：${note.title}`} aria-pressed={note.favorite}>{note.favorite ? '★ 已收藏' : '☆ 收藏'}</button><button disabled={disabled} onClick={edit}>编辑</button><a href={`analysis.html?noteId=${encodeURIComponent(note.id)}`} target="_blank" rel="noreferrer">AI 分析</a>{source && <a href={source} target="_blank" rel="noreferrer">原网页 ↗</a>}<button className="danger" disabled={disabled} onClick={remove}>删除</button></div></div>
  </article>;
}
function Detail({ id, close, gallery, edit }: { id: string; close: () => void; gallery: (ids: string[], index: number) => void; edit: () => void }) {
  const record = useLiveQuery(async () => { try { return { note: await db.notes.get(id), draft: await db.draftCatalog.get(id), failed: false }; } catch { return { failed: true }; } }, [id]);
  const note = record?.note; const source = httpUrl(note?.url);
  return <Modal title="完整笔记" close={close} wide>{!record ? <p role="status">正在读取笔记…</p> : !note ? <p role="alert">{record.failed ? '笔记读取失败，请重试。' : '笔记已被删除。'}</p> : <div className="note-detail"><h1>{note.title}</h1><p className="muted">{note.saveState === 'draft' ? '草稿' : '已保存'} · {platformNames[note.platform]} · {note.author || '作者未识别'} · 发布时间：{note.publishedAt || '未识别'}</p>{record.draft?.pending === 1 && <p className="notice">此处显示已提交版本，另有未提交编辑，可点击“编辑笔记”继续。</p>}{source && <a href={source} target="_blank" rel="noreferrer">{note.url} ↗</a>}<div className="detail-images">{note.screenshotIds.map((imageId, index) => <button key={imageId} aria-label={`查看截图 ${index + 1}`} onClick={() => gallery(note.screenshotIds, index)}><LocalPicture id={imageId} alt={`笔记截图 ${index + 1}`} /></button>)}</div><h2>采集正文</h2><p className="preserve-text">{note.content || '暂无正文'}</p><h2>我的感悟</h2><p className="preserve-text">{note.body || '暂无感悟'}</p><h2>待研究问题</h2><p className="preserve-text">{note.researchQuestions || '暂无问题'}</p><p>分类：{note.category || '未分类'} · 标签：{note.tags.join('、') || '无'}</p><p className="muted">创建：{new Date(note.createdAt).toLocaleString('zh-CN')} · 修改：{new Date(note.updatedAt).toLocaleString('zh-CN')}</p><button className="primary" onClick={edit}>编辑笔记</button><a href={`analysis.html?noteId=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">AI 分析与历史</a><a href={`notes.html?projects&from=note&id=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">从灵感创建项目</a><a href={`notes.html?research&from=note&id=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">深度研究</a>{note.saveState==='saved'&&<a href={`notes.html?research&wizard&from=note&id=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">启动深度研究</a>}</div>}</Modal>;
}

export function Library() {
  useEffect(() => {
    const channel = new BroadcastChannel('ideaclip-restored');
    channel.onmessage = () => window.location.reload();
    return () => channel.close();
  }, []);
  const [filter, setFilter] = useState<LibraryFilter>({ ...initialFilter });
  const [query, setQuery] = useState(''); const [dates, setDates] = useState({ from: '', to: '' });
  const [dateError, setDateError] = useState('');
  const [mode, setMode] = useState<'cards' | 'list'>(() => { try { return localStorage.getItem('ideaclip-library-mode') === 'list' ? 'list' : 'cards'; } catch { return 'cards'; } });
  const [selected, setSelected] = useState(new Set<string>());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ ids: string[]; index: number } | null>(null);
  const [operation, setOperation] = useState('category'); const [value, setValue] = useState('');
  const [confirmation, setConfirmation] = useState<string[] | null>(null); const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false); const locked = useRef(false);
  const [progress, setProgress] = useState(0); const [report, setReport] = useState<BatchResult | null>(null); const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const { result, loading, error: queryError } = useCatalog(filter, refresh);
  const searchPending = query !== filter.query;
  const disabled = busy || loading || searchPending || Boolean(dateError);
  useEffect(() => { if (query === filter.query) return; const timer = setTimeout(() => { setFilter(old => ({ ...old, query, page: 0 })); setSelected(new Set()); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { try { localStorage.setItem('ideaclip-library-mode', mode); } catch { /* A private-mode preference failure does not affect notes. */ } }, [mode]);
  useEffect(() => { if (result && !loading && filter.page > 0 && filter.page * PAGE_SIZE >= result.total) setFilter(old => ({ ...old, page: Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1) })); }, [result, loading, filter.page]);
  function change(patch: Partial<LibraryFilter>) { setFilter(old => ({ ...old, ...patch, page: 0 })); setSelected(new Set()); setReport(null); }
  function dateChange(key: 'from' | 'to', value: string) {
    const next = { ...dates, [key]: value }; setDates(next); setSelected(new Set());
    try { const from = dayBoundary(next.from); const to = dayBoundary(next.to, true); if (from !== null && to !== null && from > to) throw new Error('开始日期不能晚于结束日期。'); setDateError(''); change({ from, to }); }
    catch (error) { setDateError(error instanceof Error ? error.message : '日期无效'); }
  }
  async function batch(ids: string[], action: BatchOperation, confirmed = false) {
    if (locked.current) return; locked.current = true; setBusy(true); setProgress(0); setError(''); setReport(null);
    try {
      const outcome = await executeBatch(ids, action, undefined, { confirmed, onProgress: setProgress }); setReport(outcome);
      setSelected(old => new Set([...old].filter(id => !outcome.succeeded.includes(id)))); setRefresh(old => old + 1);
    } catch (error) { setError(error instanceof Error ? error.message : '批量操作失败，请重试。'); }
    finally { locked.current = false; setBusy(false); }
  }
  function perform() {
    const ids = [...selected];
    if (!ids.length) { setError('请先选择笔记。'); return; }
    if (operation === 'delete') { setAcknowledged(false); setConfirmation(ids); return; }
    const action: BatchOperation = operation === 'favorite' || operation === 'unfavorite' ? { type: 'favorite', value: operation === 'favorite' } : { type: operation as 'category' | 'addTags' | 'removeTags', value };
    void batch(ids, action);
  }
  async function edit(id?: string) { try { await openEditor(id ? { kind: 'note', id } : { kind: 'blank' }); } catch (error) { setError(error instanceof Error ? error.message : '编辑页打开失败'); } }
  const rows = result?.rows ?? []; const allPageSelected = rows.length > 0 && rows.every(row => selected.has(row.id));
  function gallery(ids: string[], index: number) { setViewer({ ids, index }); }
  return <div className="shell library-shell"><header><a className="brand" href="notes.html"><span className="mark">i</span>IdeaClip</a><nav><a href="notes.html?projects">项目孵化中心</a><span>灵感管理中心</span><a href="notes.html?research">深度研究</a><a href="tasks.html">AI 任务中心</a><a href="settings.html">设置</a></nav></header><main>
    <div className="hero"><div><p className="eyebrow">YOUR IDEA GARDEN</p><h1>灵感管理中心</h1><p className="muted">回看、连接、整理，每一个值得研究的可能。</p></div><button className="primary" onClick={() => { void edit(); }}>＋ 新建灵感</button></div>
    <div className="library-tabs" role="group" aria-label="笔记状态"><button aria-pressed={filter.state === 'saved'} onClick={() => change({ state: 'saved' })}>已保存（{result?.saved ?? '—'}）</button><button aria-pressed={filter.state === 'draft'} onClick={() => change({ state: 'draft' })}>草稿（{result?.drafts ?? '—'}）</button><button aria-pressed={filter.state === 'all'} onClick={() => change({ state: 'all' })}>全部笔记</button><span className="privacy">● 本地存储，AI 按已确认模式发送</span></div>
    <details className="recovery-section"><summary>恢复未提交编辑</summary><PendingDrafts all /></details>
    <section className="panel library-filters" aria-label="搜索与筛选"><div className="search-row"><input aria-label="搜索灵感" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、正文、感悟、标签或作者…" disabled={busy} /><select aria-label="搜索范围" value={filter.scope} disabled={busy} onChange={event => change({ scope: event.target.value as LibraryFilter['scope'] })}>{Object.entries({ all: '全部内容', title: '标题', content: '正文', body: '我的感悟', tags: '标签', author: '作者' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div className="filter-grid"><label>来源网站<select aria-label="来源网站" disabled={busy} value={filter.site === null ? '' : JSON.stringify(filter.site)} onChange={event => change({ site: event.target.value === '' ? null : JSON.parse(event.target.value) })}><option value="">全部来源</option>{result?.sites.map(site => <option key={site} value={JSON.stringify(site)}>{site || '手动记录'}</option>)}</select></label><label>分类<select aria-label="分类" disabled={busy} value={filter.category === null ? '' : JSON.stringify(filter.category)} onChange={event => change({ category: event.target.value === '' ? null : JSON.parse(event.target.value) })}><option value="">全部分类</option>{result?.categories.map(category => <option key={category} value={JSON.stringify(category)}>{category || '未分类'}</option>)}</select></label><label>收藏<select aria-label="收藏" disabled={busy} value={filter.favorite} onChange={event => change({ favorite: event.target.value as LibraryFilter['favorite'] })}><option value="all">全部收藏状态</option><option value="yes">仅收藏</option><option value="no">未收藏</option></select></label><label>时间排序<select aria-label="时间排序" disabled={busy} value={filter.sort} onChange={event => change({ sort: event.target.value as LibraryFilter['sort'] })}><option value="newest">最新创建</option><option value="oldest">最早创建</option><option value="modified">最近修改</option></select></label><label>创建时间从<input aria-label="创建时间从" disabled={busy} type="date" value={dates.from} onChange={event => dateChange('from', event.target.value)} /></label><label>创建时间至<input aria-label="创建时间至" disabled={busy} type="date" value={dates.to} onChange={event => dateChange('to', event.target.value)} /></label></div>
      <div className="filter-bottom"><button disabled={busy} onClick={() => { setQuery(''); setDates({ from: '', to: '' }); setFilter({ ...initialFilter }); setSelected(new Set()); setError(''); setDateError(''); }}>清除筛选</button><div role="group" aria-label="展示模式"><button aria-pressed={mode === 'cards'} onClick={() => setMode('cards')}>卡片模式</button><button aria-pressed={mode === 'list'} onClick={() => setMode('list')}>列表模式</button></div></div>
    </section>
    <p><a href={"analysis.html?"+([...selected].map(id=>"compare="+encodeURIComponent(id)).join("&")||"compare=")}>商业机会对比（选择 2～10 条）</a></p><section className="library-batch panel" aria-label="批量管理"><div className="selection-line"><label><input type="checkbox" checked={allPageSelected} disabled={disabled || !rows.length} onChange={event => setSelected(old => { const next = new Set(old); rows.forEach(row => event.target.checked ? next.add(row.id) : next.delete(row.id)); return next; })} />全选当前页</label><span>已选择 {selected.size} 条</span><button disabled={busy} onClick={() => setSelected(new Set())}>清空选择</button></div><div className="batch-controls"><select aria-label="批量操作" disabled={disabled} value={operation} onChange={event => setOperation(event.target.value)}><option value="category">修改分类</option><option value="addTags">添加标签</option><option value="removeTags">移除标签</option><option value="favorite">标记收藏</option><option value="unfavorite">取消收藏</option><option value="delete">删除笔记</option></select>{['category', 'addTags', 'removeTags'].includes(operation) && <input aria-label="批量操作内容" disabled={disabled} value={value} onChange={event => setValue(event.target.value)} placeholder={operation === 'category' ? '新分类（留空可清除）' : '完整标签，多个用逗号分隔'} />}<button className={operation === 'delete' ? 'danger' : 'primary'} disabled={disabled || !selected.size} onClick={perform}>{busy ? `正在处理 ${progress} 条…` : '执行批量操作'}</button></div></section>
    {(error || queryError || dateError) && <p className="error" role="alert">{error || queryError || dateError}</p>}
    {report && <section className="batch-report" role="status"><strong>成功 {report.succeeded.length} 条，失败 {report.failed.length} 条。</strong>{report.failed.length > 0 && <ul>{report.failed.map(item => <li key={item.id}>{item.title}：{item.reason}</li>)}</ul>}</section>}
    <div className="result-line" aria-live="polite"><span>{loading || searchPending ? '正在查找灵感…' : `找到 ${result?.total ?? 0} 条灵感`}</span><span>每页 {PAGE_SIZE} 条</span></div>
    <div className={`library-results ${mode}`} aria-busy={loading || searchPending}>{loading ? <div className="empty">正在读取本地笔记…</div> : !rows.length ? <section className="empty"><span className="seed">✳</span><h2>还没有匹配的灵感</h2><p className="muted">试试其他筛选，或记录一个新的想法。</p></section> : rows.map(note => <NoteTile key={note.id} note={note} mode={mode} selected={selected.has(note.id)} disabled={disabled} toggle={() => setSelected(old => { const next = new Set(old); next.has(note.id) ? next.delete(note.id) : next.add(note.id); return next; })} detail={() => setDetailId(note.id)} gallery={gallery} edit={() => { void edit(note.id); }} favorite={() => { void batch([note.id], { type: 'favorite', value: !note.favorite }); }} remove={() => { if (confirm(`删除“${note.title}”及其未提交编辑？原图与采集记录会保留。`)) void batch([note.id], { type: 'delete' }, true); }} />)}</div>
    <div className="pagination"><button disabled={disabled || filter.page === 0} onClick={() => setFilter(old => ({ ...old, page: old.page - 1 }))}>上一页</button><span>第 {filter.page + 1} / {Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE))} 页</span><button disabled={disabled || !result || (filter.page + 1) * PAGE_SIZE >= result.total} onClick={() => setFilter(old => ({ ...old, page: old.page + 1 }))}>下一页</button></div>
  </main><footer>IdeaClip · 给每一个可能，留一个位置。</footer>
    {detailId && <Detail id={detailId} close={() => setDetailId(null)} gallery={gallery} edit={() => { void edit(detailId); }} />}
    {viewer && <Modal title="截图大图" wide close={() => setViewer(null)}><LocalPicture id={viewer.ids[viewer.index]} original alt={`截图大图 ${viewer.index + 1}`} /><div className="gallery-controls"><button disabled={viewer.ids.length < 2} onClick={() => setViewer({ ...viewer, index: (viewer.index + viewer.ids.length - 1) % viewer.ids.length })}>上一张</button><span>{viewer.index + 1} / {viewer.ids.length}</span><button disabled={viewer.ids.length < 2} onClick={() => setViewer({ ...viewer, index: (viewer.index + 1) % viewer.ids.length })}>下一张</button></div></Modal>}
    {confirmation && <Modal title="确认批量删除" close={() => setConfirmation(null)}><p>即将删除所选 {confirmation.length} 条笔记及其未提交编辑。截图文件和原始采集保留。删除笔记不可撤销。</p><label className="delete-ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />我确认删除所选笔记及未提交编辑</label><div className="actions"><button onClick={() => setConfirmation(null)}>取消</button><button className="danger" disabled={!acknowledged || busy} onClick={() => { const ids = confirmation; setConfirmation(null); void batch(ids, { type: 'delete' }, true); }}>确认删除 {confirmation.length} 条</button></div></Modal>}
  </div>;
}
