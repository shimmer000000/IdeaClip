import { useEffect, useRef, useState } from 'react';
import { db } from '../storage';

interface Lease { users: number; promise: Promise<Blob | null> }
const jobs: (() => Promise<void>)[] = []; let running = 0;
const leases = new Map<string, Lease>();
function pump() {
  while (running < 2 && jobs.length) {
    running++; const job = jobs.shift()!;
    void job().finally(() => { running--; pump(); });
  }
}
async function thumbnail(id: string): Promise<Blob | null> {
  const cached = await db.screenshotThumbs.get(id); if (cached) return cached.blob;
  const source = await db.screenshots.get(id); if (!source) return null;
  const bitmap = await createImageBitmap(source.blob);
  try {
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d'); if (!context) throw new Error('无法生成缩略图');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.78 });
    // A failed cache write must not prevent viewing the image or modify its original.
    await db.screenshotThumbs.put({ id, blob }).catch(() => {}); return blob;
  } finally { bitmap.close(); }
}
function acquire(id: string) {
  let lease = leases.get(id);
  if (!lease) {
    let resolve!: (blob: Blob | null) => void; let reject!: (reason: unknown) => void;
    lease = { users: 0, promise: new Promise((yes, no) => { resolve = yes; reject = no; }) };
    const created = lease; leases.set(id, created);
    jobs.push(async () => {
      try { resolve(created.users ? await thumbnail(id) : null); }
      catch (error) { reject(error); }
      finally { if (leases.get(id) === created) leases.delete(id); }
    });
  }
  lease.users++; pump();
  return { promise: lease.promise, release: () => { lease!.users--; } };
}
export function LocalPicture({ id, original = false, alt }: { id: string; original?: boolean; alt: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(original);
  const [picture, setPicture] = useState({ id: '', url: '' });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (original || !host.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '200px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, [original]);
  useEffect(() => {
    if (!visible) return;
    let alive = true; let url = ''; setFailed(false);
    const lease = original ? { promise: db.screenshots.get(id).then(row => row?.blob ?? null), release: () => {} } : acquire(id);
    void lease.promise.then(blob => {
      if (!alive) return;
      if (!blob) { setFailed(true); return; }
      url = URL.createObjectURL(blob); setPicture({ id, url });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; lease.release(); if (url) URL.revokeObjectURL(url); setPicture(previous => previous.id === id ? { id: '', url: '' } : previous); };
  }, [id, visible, original]);
  return <div ref={host} className={original ? 'local-picture original' : 'local-picture'}>{picture.id === id && picture.url ? <img src={picture.url} alt={alt} loading={original ? 'eager' : 'lazy'} /> : <span>{failed ? '图片暂不可用' : '截图预览'}</span>}</div>;
}
