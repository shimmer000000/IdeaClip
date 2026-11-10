import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage';
import { EditorEntry } from '../inspiration/Entry';

async function startCapture(kind: 'visible' | 'region' | 'full', screenshotId?: string) {
  if (!globalThis.chrome?.runtime?.id) throw new Error('请在已安装的 IdeaClip 插件中使用截图功能。');
  const response = await chrome.runtime.sendMessage({ type: 'IC_CAPTURE_START', kind, screenshotId });
  if (!response?.ok) throw new Error(response?.error ?? '截图未完成，请重新点击插件后重试。');
}

export function CaptureButtons({ screenshotId }: { screenshotId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function capture(kind: 'visible' | 'region' | 'full') {
    setBusy(true); setError('');
    try {
      await startCapture(kind, screenshotId);
      if (!screenshotId) window.close();
    } catch (e) { setError(e instanceof Error ? e.message : '截图失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <section className="screenshot-actions" aria-label="网页截图"><div className="actions"><button className="primary" disabled={busy} onClick={() => { void capture('visible'); }}>{busy ? '处理中…' : screenshotId ? '重新截取可见页面' : '截取可见页面'}</button><button disabled={busy} onClick={() => { void capture('region'); }}>{screenshotId ? '重新选择区域' : '选择区域截图'}</button><button disabled={busy} onClick={() => { void capture('full'); }}>{screenshotId ? '重新截取长图' : '截取长图'}</button></div><p className="muted">长图自动滚动当前网页，Esc、滚轮或点击页面可取消；请先等待加载完成。固定/悬浮元素不收入长图。</p>{error && <p className="error" role="alert">{error}</p>}</section>;
}

export function RecentCapture() {
  const latest = useLiveQuery(() => db.screenshots.orderBy('createdAt').last());
  return latest ? <a className="recent-capture" href={`capture.html?id=${latest.id}`} target="_blank" rel="noreferrer">最近截图 · {new Date(latest.createdAt).toLocaleString('zh-CN')} ↗</a> : null;
}

export function CapturePreview() {
  const id = new URLSearchParams(location.search).get('id');
  const result = useLiveQuery(async () => ({ screenshot: id ? await db.screenshots.get(id) : await db.screenshots.orderBy('createdAt').last() }), [id]);
  const screenshot = result?.screenshot;
  const [imageUrl, setImageUrl] = useState('');
  useEffect(() => {
    if (!screenshot) return;
    const url = URL.createObjectURL(screenshot.blob); setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);
  return <div className="shell capture-preview"><header><a className="brand" href="notes.html"><span className="mark">i</span>IdeaClip</a><span className="privacy">● 图片仅保存在此设备</span></header><main><p className="eyebrow">KEEP THE MOMENT</p><h1>这一刻，已经留住。</h1>{!result ? <p role="status">正在读取截图…</p> : !screenshot ? <p role="alert">找不到截图。请回到网页，点击 IdeaClip 图标重新截图。</p> : <><p className="notice" role="status">已保存到本地数据库 · {screenshot.kind === 'full' ? '网页长图' : screenshot.kind === 'visible' ? '可见页面' : '选定区域'} · {screenshot.width} × {screenshot.height} px · {Math.ceil(screenshot.blob.size / 1024)} KB · {screenshot.blob.type === 'image/webp' ? 'WebP' : 'PNG'}</p><p className="muted">{screenshot.sourceTitle || '网页截图'} · {new Date(screenshot.createdAt).toLocaleString('zh-CN')}</p><div className="preview-frame">{imageUrl && <img src={imageUrl} alt="已保存的网页截图预览" />}</div><div className="actions">{imageUrl && <a className="download-image" href={imageUrl} download={`IdeaClip-${screenshot.id}.${screenshot.blob.type === 'image/webp' ? 'webp' : 'png'}`}>保存图片到电脑</a>}</div><CaptureButtons screenshotId={screenshot.id} /><EditorEntry target={{ kind: "screenshot", id: screenshot.id }}>整理为灵感</EditorEntry><p className="muted">重新截图会保留原图。原网页关闭或跳转后，请回到目标网页重新点击插件。普通截图长边最多2560像素、2 MB；长图宽最多1600、高最多24000像素、6 MB。长图限20000 CSS像素/40屏；无限滚动、横向或内嵌滚动区域不支持，动态内容需人工核对。</p></>}</main></div>;
}
