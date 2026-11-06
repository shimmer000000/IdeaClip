import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage';
import { beginDraft, draftFromCapture, draftFromScreenshot, editNote } from './repository';

export type EditorTarget = { kind: 'active' | 'blank' | 'note' | 'capture' | 'screenshot'; id?: string };
export async function openEditor(target: EditorTarget) {
  if (globalThis.chrome?.runtime?.id) {
    const response = await chrome.runtime.sendMessage({ type: 'IC_NOTE_OPEN', ...target, requestId: crypto.randomUUID() });
    if (!response?.ok) throw new Error(response?.error ?? '无法打开编辑页，请重试。');
    return;
  }
  let id: string;
  if (target.kind === 'note' && target.id) id = await editNote(target.id);
  else if (target.kind === 'capture' && target.id) id = await draftFromCapture(target.id);
  else if (target.kind === 'screenshot' && target.id) id = await draftFromScreenshot(target.id);
  else if (target.kind === 'blank') id = await beginDraft(`manual:${crypto.randomUUID()}`);
  else throw new Error('请在浏览器扩展中收藏当前网页。');
  location.href = `note.html?id=${encodeURIComponent(id)}`;
}
export function EditorEntry({ target, children, closePopup = false, beforeOpen }: { target: EditorTarget; children: string; closePopup?: boolean; beforeOpen?: () => Promise<void> }) {
  const working = useRef(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function open() {
    if (working.current) return; working.current = true; setBusy(true); setError('');
    try { await beforeOpen?.(); await openEditor(target); if (closePopup) window.close(); }
    catch (error) { setError(error instanceof Error ? error.message : '打开失败，请重试。'); }
    finally { working.current = false; setBusy(false); }
  }
  return <div className="editor-entry"><button type="button" className="primary" disabled={busy} onClick={() => { void open(); }}>{busy ? '正在打开…' : children}</button>{error && <p role="alert" className="error">{error}</p>}</div>;
}
export function PendingDrafts({ all = false }: { all?: boolean }) {
  const [limit, setLimit] = useState(all ? 20 : 5);
  const drafts = useLiveQuery(() => {
    return db.draftCatalog.where('[pending+updatedAt]').between([1, 0], [1, Number.MAX_SAFE_INTEGER], true, true).reverse().limit(limit + 1).toArray();
  }, [limit]);
  const shown = drafts?.slice(0, limit);
  return shown?.length ? <section className="pending-drafts"><h2>恢复未提交编辑</h2>{shown.map(draft => <a key={draft.id} href={`note.html?id=${draft.id}`} target="_blank" rel="noreferrer">{draft.title || '未命名灵感'} · {new Date(draft.updatedAt).toLocaleString('zh-CN')}</a>)}{drafts && drafts.length > limit && (all ? <button onClick={() => setLimit(old => old + 20)}>加载更多未提交编辑</button> : <a href="notes.html" target="_blank" rel="noreferrer">在灵感库查看全部未提交编辑 ↗</a>)}</section> : null;
}
