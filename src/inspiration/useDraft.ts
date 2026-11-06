import { useCallback, useEffect, useRef, useState } from 'react';
import { inputKeys, equal, mergeIds, type NoteDraft, type NoteInput } from './model';
import { patchDraft } from './repository';

export function useDraft(draft: NoteDraft) {
  const [input, setInput] = useState(draft.input);
  const local = useRef(structuredClone(draft.input)); const base = useRef(structuredClone(draft.input));
  const dirty = useRef(new Set<keyof NoteInput>());
  const pending = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopped = useRef(false);
  const [status, setStatus] = useState(draft.hasChanges ? '已自动保留未提交草稿' : '当前内容已提交');
  const [error, setError] = useState('');
  useEffect(() => {
    for (const key of inputKeys) if (!dirty.current.has(key)) {
      (local.current as unknown as Record<string, unknown>)[key] = structuredClone(draft.input[key]);
      (base.current as unknown as Record<string, unknown>)[key] = structuredClone(draft.input[key]);
    }
    setInput(structuredClone(local.current));
    if (draft.hasChanges && !dirty.current.size && !pending.current) setStatus('已自动保留未提交草稿');
  }, [draft]);

  const flush = useCallback(async function persist(): Promise<void> {
    clearTimeout(timer.current);
    if (stopped.current) return;
    if (pending.current) { await pending.current; if (dirty.current.size) await persist(); return; }
    if (!dirty.current.size) return;
    const keys = [...dirty.current]; const patch: Partial<NoteInput> = {}; const before: Partial<NoteInput> = {};
    for (const key of keys) {
      (patch as Record<string, unknown>)[key] = structuredClone(local.current[key]);
      (before as Record<string, unknown>)[key] = structuredClone(base.current[key]);
    }
    pending.current = patchDraft(draft.id, patch, before).then(saved => {
      for (const key of keys) {
        if (key === 'screenshotIds') local.current.screenshotIds = mergeIds(saved.screenshotIds, patch.screenshotIds!, local.current.screenshotIds);
        const sent = key === 'screenshotIds' ? saved.screenshotIds : patch[key];
        (base.current as unknown as Record<string, unknown>)[key] = structuredClone(saved[key]);
        if (equal(local.current[key], sent)) dirty.current.delete(key);
      }
      setInput(structuredClone(local.current)); setError('');
    }).catch(e => { setStatus('草稿尚未保留成功，请勿关闭'); setError(`草稿自动保留失败，当前输入仍在本页。请勿关闭，重试或复制保留。${e instanceof Error ? e.message : ''}`); throw e; }).finally(() => { pending.current = null; });
    await pending.current;
    if (dirty.current.size) await persist();
    else setStatus('已自动保留未提交草稿');
  }, [draft.id]);

  function change<K extends keyof NoteInput>(key: K, value: NoteInput[K]) {
    if (stopped.current) return;
    local.current[key] = value; dirty.current.add(key); setInput(structuredClone(local.current)); setStatus('正在保留草稿…');
    clearTimeout(timer.current); timer.current = setTimeout(() => { void flush().catch(() => {}); }, 150);
  }
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => {
      if (dirty.current.size || pending.current) { event.preventDefault(); event.returnValue = ''; void flush().catch(() => {}); }
    };
    const hidden = () => { if (document.hidden) void flush().catch(() => {}); };
    window.addEventListener('beforeunload', leaving); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('beforeunload', leaving); document.removeEventListener('visibilitychange', hidden); clearTimeout(timer.current); };
  }, [flush]);
  function stop() { stopped.current = true; dirty.current.clear(); clearTimeout(timer.current); }
  return { input, local, change, flush, status, setStatus, error, stop };
}
