import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteNote, getSettings, setAIEnabled, type Note, type NoteStatus } from './storage';
import { openPage } from './browser';
import { CaptureButtons, RecentCapture } from './capture/Capture';
import { CollectButton } from './collection/Collection';
import { EditorEntry, PendingDrafts, openEditor } from './inspiration/Entry';

const statuses: Record<NoteStatus, string> = { inbox: '收集箱', incubating: '孵化中', archived: '已归档' };
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';

function Header({ compact = false }: { compact?: boolean }) {
  return <header><a className="brand" href="notes.html"><span className="mark">i</span>IdeaClip<span className="version">初始版</span></a>{!compact && <nav aria-label="主导航"><a href="notes.html">灵感库</a><a href="settings.html">设置</a></nav>}</header>;
}
function Notice({ children }: { children: ReactNode }) { return <p className="notice" role="status">{children}</p>; }

export function Popup() {

  const [error, setError] = useState('');
  return <div className="popup"><Header compact /><main><p className="eyebrow">CAPTURE A SPARK</p><h1>留住这一刻的灵感。</h1><p className="muted">先收藏，再让想法慢慢生长。</p><EditorEntry target={{ kind: "active" }} closePopup>收藏当前网页</EditorEntry><p className="muted">在独立编辑页整理，未提交编辑会自动保留。</p><CaptureButtons /><RecentCapture /><CollectButton /><p className="capture-hint">截图自动压缩并保存在本地；区域选择时按 Esc 取消。</p><PendingDrafts /></main><footer><button onClick={() => { void openPage('notes').catch(e => setError(messageOf(e))); }}>打开灵感库 ↗</button><button onClick={() => { void openPage('settings').catch(e => setError(messageOf(e))); }}>设置</button></footer>{error && <p role="alert">{error}</p>}</div>;
}

export function Notes() {
  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const [error, setError] = useState('');
  const filtered = notes?.filter(note => (filter === 'all' || note.status === filter) && `${note.title} ${note.body} ${note.tags.join(' ')} ${note.url}`.toLowerCase().includes(query.toLowerCase()));
  async function remove(note: Note) {
    if (!window.confirm(`删除“${note.title}”？此操作无法撤销。`)) return;
    try { await deleteNote(note.id); } catch (e) { setError(messageOf(e)); }
  }
  return <div className="shell"><Header /><main>
    <div className="hero"><div><p className="eyebrow">YOUR IDEA GARDEN</p><h1>让灵感，有处生长。</h1><p className="muted">收集值得留意的事物，连接下一个可能。</p></div><button className="primary" onClick={() => { void openEditor({ kind: "blank" }).catch(e => setError(messageOf(e))); }}>＋ 新建灵感</button></div>
    <PendingDrafts all /><div className="stats"><span><strong>{notes?.length ?? '—'}</strong> 条灵感</span><span className="privacy">● 仅保存在此设备</span></div>
    <div className="toolbar"><input aria-label="搜索灵感" placeholder="搜索标题、想法或标签…" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="筛选状态" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部状态</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    {error && <p role="alert" className="error">{error}</p>}
    {notes === undefined ? <Notice>正在读取本地灵感…</Notice> : filtered?.length === 0 ? <section className="empty"><span className="seed">✳</span><h2>{notes.length ? '还没有匹配的灵感' : '每个项目，都始于一个小想法。'}</h2><p className="muted">{notes.length ? '试试其他关键词或状态。' : '点击「新建灵感」，或从插件弹窗收藏一个网页。'}</p></section> : <div className="grid">{filtered?.map(note => <article className="note panel" key={note.id}><div className="card-top"><span className="badge">{statuses[note.status]}</span><time>{new Date(note.updatedAt).toLocaleDateString('zh-CN')}</time></div><h2>{note.favorite ? "★ " : ""}{note.title}</h2><span className="muted">{note.saveState === "draft" ? "草稿" : "已保存"}</span>{note.body && <p className="note-body">{note.body}</p>}{note.url && <a className="source" href={note.url} target="_blank" rel="noreferrer">↗ {new URL(note.url).hostname}</a>}<div className="tags">{note.tags.map(tag => <span key={tag}>#{tag}</span>)}</div><div className="card-actions"><button onClick={() => { void openEditor({ kind: "note", id: note.id }).catch(e => setError(messageOf(e))); }}>编辑</button><button className="danger" onClick={() => { void remove(note); }}>删除</button></div></article>)}</div>}
  </main><footer>IdeaClip · 给每一个可能，留一个位置。</footer></div>;
}

export function Settings() {
  const settings = useLiveQuery(() => getSettings());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (!settings) return;
    setBusy(true); setError('');
    try { await setAIEnabled(!settings.aiEnabled); } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  return <div className="shell"><Header /><main className="settings"><p className="eyebrow">MAKE IT YOURS</p><h1>你的灵感，你来掌控。</h1><p className="muted">本地优先，从最少的权限开始。</p><section className="panel"><span className="badge">分析偏好</span><h2>AI 商业模式分析</h2><p>总开关默认关闭。开启仅保存偏好；AI 服务尚未接入，当前不会发送笔记，也不会生成分析。</p><div className="toggle-row"><label htmlFor="ai-toggle">AI 分析总开关</label><button id="ai-toggle" role="switch" aria-checked={settings?.aiEnabled ?? false} disabled={!settings || busy} onClick={() => { void toggle(); }}>{settings?.aiEnabled ? '已开启' : '已关闭'}</button></div>{error && <p role="alert" className="error">{error}</p>}</section><section className="panel"><h2>数据与隐私</h2><p>笔记、标签与设置保存在当前浏览器的 IndexedDB 中，不会同步到 GitHub。</p><p>当前版本不提供 API Key 输入、不接入云服务、不自动抓取网页正文。卸载插件或清除扩展数据将丢失本地笔记。</p></section><p className="muted">IdeaClip 0.1.0 · 项目初始化</p></main></div>;
}
