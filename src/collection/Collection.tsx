import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage';
import { EditorEntry } from '../inspiration/Entry';
import { httpUrl, platformNames, type ContentCapture } from './model';
import { saveCaptureEdits } from './storage';
import { QualitySummary } from './QualitySummary';
import { assessQuality } from './quality';

export function CollectButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recent = useLiveQuery(() => db.contentCaptures.orderBy('updatedAt').last());
  async function collect() {
    setBusy(true); setError('');
    try {
      if (!globalThis.chrome?.runtime?.id) throw new Error('请在已安装的 IdeaClip 扩展中提取网页内容。');
      const result = await chrome.runtime.sendMessage({ type: 'IC_COLLECT_START' });
      if (!result?.ok) throw new Error(result?.error ?? '提取未完成，请重试。');
      window.close();
    } catch (e) { setError(e instanceof Error ? e.message : '提取失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <section className="collect-entry"><button className="capture" disabled={busy} onClick={() => { void collect(); }}>{busy ? '正在读取页面…' : '提取网页内容'}</button>{error && <p className="error" role="alert">{error}</p>}{recent && <a className="recent-capture" href={`collection.html?id=${recent.id}`} target="_blank" rel="noreferrer">最近采集 · {recent.title || '未识别标题'} ↗</a>}</section>;
}

function ScreenshotImage({ id }: { id: string }) {
  const image = useLiveQuery(() => db.screenshots.get(id), [id]);
  const [url, setUrl] = useState('');
  useEffect(() => { if (!image) return; const local = URL.createObjectURL(image.blob); setUrl(local); return () => URL.revokeObjectURL(local); }, [image]);
  return image && url ? <figure><img src={url} alt={`关联截图：${image.sourceTitle}`} /><figcaption>{image.sourceTitle || '网页截图'}</figcaption></figure> : null;
}

function CollectionEditor({ record }: { record: ContentCapture }) {
  const [title, setTitle] = useState(record.title);
  const [sourceUrl, setSourceUrl] = useState(record.sourceUrl);
  const [author, setAuthor] = useState(record.author ?? '');
  const [publishedAt, setPublishedAt] = useState(record.publishedAt ?? '');
  const [text, setText] = useState(record.text);
  const [images, setImages] = useState(record.images);
  const [links, setLinks] = useState(record.links.map(link => link.url).join('\n'));
  const [screenshotIds, setScreenshotIds] = useState(record.screenshotIds);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const screenshots = useLiveQuery(async () => {
    const items: { id: string; title: string; time: number }[] = [];
    await db.screenshots.orderBy('createdAt').reverse().each(image => { items.push({ id: image.id, title: image.sourceTitle, time: image.createdAt }); });
    return items;
  });
  async function save(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError(''); setStatus('');
    try {
      const linkList = [...new Set(links.split('\n').map(link => link.trim()).filter(Boolean))].map(url => ({ url, text: record.links.find(link => link.url === url)?.text ?? url }));
      await saveCaptureEdits(record.id, { title, sourceUrl, author, publishedAt, text, links: linkList, images, screenshotIds });
      setStatus('修改已保存到本地采集草稿。'); return true;
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，输入仍保留在此页面。'); return false; }
    finally { setBusy(false); }
  }
  const safeSource = httpUrl(record.originalUrl);
  const quality = text === record.text && sourceUrl === record.sourceUrl ? record.quality : assessQuality({ text, url: sourceUrl, platform: record.platform });
  return <><section className="collection-summary panel"><span className="badge">{platformNames[record.platform]}</span><p>{record.siteName} · 采集于 {new Date(record.collectedAt).toLocaleString('zh-CN')}</p><strong>自动采集时：{record.status === 'unavailable' ? '自动采集未取得正文，可手动补充' : record.status === 'partial' ? '部分内容，待人工核对' : '已识别可读正文，全文完整性未确认'}</strong><ul>{record.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>{safeSource && <a href={safeSource} target="_blank" rel="noreferrer">查看原始网页 ↗</a>}<p className="muted">当前文本来源：{record.textOrigin === 'manual' ? '手动粘贴' : record.textOrigin === 'edited' ? '用户修改' : record.textOrigin === 'empty' ? '暂无正文' : '页面提取'}。手动修改不会把自动采集的完整性提示改为“已通过”。</p></section>
    <QualitySummary quality={quality} provenance={record.provenance} text={text} url={sourceUrl} /><form onSubmit={save} className="panel collection-form"><h2>采集预览与修改</h2><EditorEntry target={{ kind: "capture", id: record.id }} beforeOpen={async () => { if (!await save()) throw new Error("采集修改尚未保存，请先修正页面提示。"); }}>整理为灵感</EditorEntry><label>网页标题<input required maxLength={1000} value={title} onChange={e => setTitle(e.target.value)} placeholder="未识别，请手动填写" /></label><label>原始 URL<input required type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://" /></label><div className="metadata-row"><label>作者<input value={author} onChange={e => setAuthor(e.target.value)} placeholder="未识别，可手动填写" /></label><label>发布时间<input value={publishedAt} onChange={e => setPublishedAt(e.target.value)} placeholder="未识别，不推断日期" /></label></div><label htmlFor="collected-body">正文预览</label><textarea id="collected-body" rows={14} maxLength={100000} value={text} onChange={e => setText(e.target.value)} placeholder="采集失败或内容不完整时，可在这里手动粘贴正文。" /><p className="muted">{text.length} / 100000 字符 · 以纯文本保存，不执行网页 HTML。</p><label>外部链接（每行一个 HTTP / HTTPS URL）<textarea rows={4} value={links} onChange={e => setLinks(e.target.value)} /></label>
    <h2>图片与视频封面</h2><p className="muted">只记录页面中的 URL 与说明，不请求远程图片，也不下载视频。</p>{images.length === 0 ? <p className="muted">未识别到图片或封面。</p> : images.map((image, index) => <fieldset className="media-row" key={index}><legend>{image.kind === 'video-cover' ? '视频封面' : '图片'} {index + 1}</legend><label>图片 URL<input type="url" value={image.url} onChange={e => setImages(previous => previous.map((item, i) => i === index ? { ...item, url: e.target.value } : item))} /></label><label>图片说明<input value={image.description} onChange={e => setImages(previous => previous.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} /></label><button type="button" onClick={() => setImages(previous => previous.filter((_, i) => i !== index))}>移除此记录</button></fieldset>)}
    <h2>选择已有截图</h2><p className="muted">仅建立关联，不修改截图或旧笔记。请核对来源，截图可能来自其他网页。</p>{!screenshots?.length ? <p className="muted">暂无截图。可先返回原网页使用截图功能，再回来选择。</p> : <label>关联截图（可多选）<select multiple size={Math.min(5, Math.max(2, screenshots.length))} value={screenshotIds} onChange={e => setScreenshotIds([...e.target.selectedOptions].map(option => option.value))}>{screenshots.map(image => <option value={image.id} key={image.id}>{image.title || '网页截图'} · {new Date(image.time).toLocaleString('zh-CN')}</option>)}</select></label>}<button className="clear-screenshots" type="button" onClick={() => setScreenshotIds([])}>取消全部截图关联</button><div className="screenshot-selection">{screenshotIds.map(id => <ScreenshotImage key={id} id={id} />)}</div>
    <h2>页面中的 GitHub 项目</h2>{record.githubLinks.length ? <ul>{record.githubLinks.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul> : <p className="muted">未识别到 GitHub 项目链接。</p>}{error && <p className="error" role="alert">{error}</p>}{status && <p className="notice" role="status">{status}</p>}<div className="actions"><button className="primary" disabled={busy}>{busy ? '保存中…' : '保存采集修改'}</button></div><p className="muted">采集修改保存后，可点击“整理为灵感”补充感悟并关联到笔记。不会调用 AI API。</p></form></>;
}

export function CollectionPreview() {
  const id = new URLSearchParams(location.search).get('id');
  const result = useLiveQuery(async () => ({ record: id ? await db.contentCaptures.get(id) : await db.contentCaptures.orderBy('updatedAt').last() }), [id]);
  return <div className="shell collection-preview"><header><a className="brand" href="notes.html"><span className="mark">i</span>IdeaClip</a><span className="privacy">● 内容仅保存在此设备</span></header><main><p className="eyebrow">UNDERSTAND THE SOURCE</p><h1>留住内容，也留住出处。</h1>{!result ? <p role="status">正在读取采集草稿…</p> : !result.record ? <p role="alert">找不到采集草稿，请回到原网页重新提取。</p> : <CollectionEditor record={result.record} key={result.record.id} />}</main></div>;
}
