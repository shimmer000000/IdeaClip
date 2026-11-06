import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage';
import type { LibraryFilter, QueryResult } from './query';

export function useCatalog(filter: LibraryFilter, refresh: number) {
  const version = useLiveQuery(async () => {
    try { return { revision: (await db.libraryState.get('notes'))?.revision ?? 0, error: '' }; }
    catch { return { revision: -1, error: '本地索引初始化失败，请释放存储空间后刷新。已有笔记未删除。' }; }
  });
  const worker = useRef<Worker | null>(null); const sequence = useRef(0);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    const instance = new Worker(new URL('./catalog.worker.ts', import.meta.url), { type: 'module' }); worker.current = instance;
    instance.onerror = () => { setError('本地搜索进程不可用，请刷新重试。'); setLoading(false); };
    return () => { instance.terminate(); worker.current = null; };
  }, []);
  useEffect(() => {
    if (!version) return;
    if (version.error) { setError(version.error); setLoading(false); return; }
    let disposed = false; let retry: ReturnType<typeof setTimeout>;
    sequence.current++;
    const instance = worker.current; if (!instance) return;
    setLoading(true); setError('');
    function request() { if (!disposed) instance!.postMessage({ id: ++sequence.current, filter }); }
    instance.onmessage = event => {
      const message = event.data;
      if (disposed || message.id !== sequence.current) return;
      if (message.retry) { retry = setTimeout(request, 120); return; }
      if (message.error) setError(message.error);
      else { setResult(message.result); setError(''); }
      setLoading(false);
    };
    const timer = setTimeout(request, 80);
    return () => { disposed = true; clearTimeout(timer); clearTimeout(retry); };
  }, [filter, refresh, version?.revision, version?.error]);
  return { result, loading, error };
}
