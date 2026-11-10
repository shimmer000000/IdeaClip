import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteNote } from '../storage';
import { httpUrl, platformNames } from '../collection/model';
import { QualitySummary } from '../collection/QualitySummary';
import { assessQuality } from '../collection/quality';
import { adoptCapture, commitDraft, reloadSavedNote } from './repository';
import { useDraft } from './useDraft';
import type { NoteDraft } from './model';
import {requestCapture} from '../capture/request';

function LocalImage({ id }: { id: string }) {
  const image = useLiveQuery(() => db.screenshots.get(id).catch(() => undefined), [id]);
  const [url, setUrl] = useState('');
  useEffect(() => { if (!image) return; const local = URL.createObjectURL(image.blob); setUrl(local); return () => URL.revokeObjectURL(local); }, [image]);
  return image && url ? <img src={url} alt={`笔记截图：${image.sourceTitle || '网页截图'}`} /> : <p className="muted">正在读取截图，或此图片暂不可用。</p>;
}

function EditorForm({ draft }: { draft: NoteDraft }) {
  const autoPolicy = useLiveQuery(() => db.autoPolicy.get('general'));
  const [assistSave, setAssistSave] = useState(false);
  const form = useDraft(draft);
  const { input, change } = form;
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [selectedCapture, setSelectedCapture] = useState('');
  const captureId = draft.pendingCaptureId || selectedCapture;
  const capture = useLiveQuery(() => captureId ? db.contentCaptures.get(captureId).catch(() => undefined) : undefined, [captureId]);
  const note = useLiveQuery(() => db.notes.get(draft.id).catch(() => undefined), [draft.id]);
  const captures = useLiveQuery(() => db.contentCaptures.orderBy('updatedAt').reverse().toArray().catch(() => []));
  const screenshots = useLiveQuery(async () => {
    try {
      const rows: { id: string; title: string; time: number }[] = [];
      await db.screenshots.orderBy('createdAt').reverse().each(image => { rows.push({ id: image.id, title: image.sourceTitle, time: image.createdAt }); });
      return { rows, failed: false };
    } catch { return { rows: [], failed: true }; }
  });
  async function run(operation: () => Promise<void>) {
    if (working.current) return; working.current = true; setBusy(true); setError('');
    try { await form.flush(); await operation(); }
    catch (error) { setError(`操作未完成，当前编辑内容仍保留。${error instanceof Error ? error.message : '请重试。'}`); }
    finally { working.current = false; setBusy(false); }
  }
  function save(saveState: 'draft' | 'saved') {
    void run(async () => {
      await commitDraft(draft.id, saveState, form.local.current, db, { assisted: assistSave });
      form.setStatus(saveState === 'saved' ? '已保存灵感，全部内容已关联到同一条笔记' : '已保存草稿，可稍后继续编辑');
    });
  }
  function sourceAction(kind: 'visible' | 'region' | 'full' | 'segment' | 'content') {
    void run(async () => {
      if (!globalThis.chrome?.runtime?.id) throw new Error('请在浏览器扩展中执行截图与网页采集。');
      if(kind!=='content'){await requestCapture(kind,{draftId:draft.id});return;}
      const response = await chrome.runtime.sendMessage({ type: 'IC_COLLECT_START', kind, draftId: draft.id });
      if (!response?.ok) throw new Error(response?.error ?? '网页操作失败，请重新点击插件授权。');
    });
  }
  function applyCapture() {
    if (!capture) return;
    void run(async () => {
      if (form.local.current.content && form.local.current.content !== capture.text && !confirm('要用这次采集替换当前正文吗？原采集记录会保留，我的感悟不会被替换。')) return;
      await adoptCapture(draft.id, capture.id); setSelectedCapture('');
    });
  }
  async function remove() {
    if (!confirm('删除这条笔记及其未提交编辑？截图文件与原始采集记录会保留。')) return;
    await run(async () => { await deleteNote(draft.id); form.stop(); location.href = 'notes.html'; });
  }
  async function reloadSaved() {
    if (!confirm('放弃本页未提交修改，重新读取已保存版本？需要保留的文字请先复制。')) return;
    try { await reloadSavedNote(draft.id); form.stop(); location.reload(); }
    catch (error) { setError(`未重置编辑，当前输入仍在本页。${error instanceof Error ? error.message : ''}`); }
  }
  const originalUrl = httpUrl(input.url);
  const contentSource = captures?.find(c => input.captureIds.includes(c.id) && c.text === input.content && c.sourceUrl === input.url);
  return <>
    <div className="note-save-status" aria-live="polite"><span role="status">{form.status}</span><span>{note?.saveState === 'saved' ? '已保存笔记' : note ? '已存为草稿' : '尚未提交为笔记'}{draft.hasChanges ? ' · 有未提交编辑' : ''}</span></div>
    {(error || form.error) && <div role="alert" className="error panel">{error || form.error}{form.error && <button type="button" onClick={() => { void run(async () => {}); }}>重试保留草稿</button>}{note && <button type="button" onClick={() => { void reloadSaved(); }}>重新读取已保存版本</button>}</div>}
    <section className="panel note-section"><h2>网页截图</h2><div className="actions"><button disabled={busy} onClick={() => sourceAction('visible')}>截取可见页面</button><button disabled={busy} onClick={() => sourceAction('region')}>选择区域截图</button><button disabled={busy} onClick={() => sourceAction('full')}>截取长图</button><button disabled={busy} onClick={() => sourceAction('segment')}>分段截长图</button></div>
      <p className="muted">可添加多张截图。移除只解除这条笔记的关联，保留原图。超长网页可用“分段截长图”从当前位置截取一段。长图会自动滚动原网页，Esc/滚轮/点击可取消；请等待加载完成，固定和悬浮元素不会收入长图。</p>
      <div className="note-images">{input.screenshotIds.map((id, index) => <figure key={id}><LocalImage id={id} /><figcaption>截图 {index + 1}<button type="button" onClick={() => change('screenshotIds', input.screenshotIds.filter(imageId => imageId !== id))}>移除截图 {index + 1}</button></figcaption></figure>)}</div>
      <details><summary>选择已有截图（{screenshots?.rows.length ?? 0} 张）</summary>{screenshots?.failed && <p className="error">截图列表读取失败，编辑内容仍保留，请稍后重试。</p>}<div className="image-options">{screenshots?.rows.map((image, index) => <label key={image.id}><input type="checkbox" checked={input.screenshotIds.includes(image.id)} onChange={e => change('screenshotIds', e.target.checked ? [...input.screenshotIds, image.id] : input.screenshotIds.filter(id => id !== image.id))} />选择截图 {index + 1} · {image.title || '网页截图'} · {new Date(image.time).toLocaleString('zh-CN')}</label>)}</div></details>
    </section>
    <section className="panel note-section"><h2>网页信息</h2><label htmlFor="idea-title">灵感标题</label><input id="idea-title" value={input.title} maxLength={1000} onChange={e => change('title', e.target.value)} placeholder="给这个想法起个名字" />
      <label htmlFor="idea-url">原始网页 URL</label><input id="idea-url" value={input.url} onChange={e => change('url', e.target.value)} placeholder="https://（手动灵感可留空）" />{originalUrl && <a className="source" href={originalUrl} target="_blank" rel="noreferrer">查看原始网页 ↗</a>}
      <div className="metadata-row"><div><label htmlFor="idea-platform">来源平台</label><select id="idea-platform" value={input.platform} onChange={e => change('platform', e.target.value as typeof input.platform)}>{Object.entries(platformNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></div><div><label htmlFor="idea-author">网页作者</label><input id="idea-author" maxLength={1000} value={input.author ?? ''} onChange={e => change('author', e.target.value)} placeholder="未识别，可手动填写" /></div></div>
      <label htmlFor="idea-published">发布时间</label><input id="idea-published" maxLength={1000} value={input.publishedAt ?? ''} onChange={e => change('publishedAt', e.target.value)} placeholder="未识别，不推断日期" />
    </section>
    <section className="panel note-section"><div className="section-heading"><h2>正文内容</h2><button disabled={busy} onClick={() => sourceAction('content')}>提取正文</button></div>
      <label htmlFor="existing-capture">选择已有正文采集</label><select id="existing-capture" value={captureId} onChange={e => setSelectedCapture(e.target.value)} disabled={Boolean(draft.pendingCaptureId)}><option value="">选择一份采集记录（可选）</option>{captures?.map(item => <option key={item.id} value={item.id}>{item.title || '未识别标题'} · {new Date(item.collectedAt).toLocaleString('zh-CN')}</option>)}</select>
      {capture && <div className="capture-candidate"><strong>采集预览，待确认采用</strong><p>{capture.title} · {platformNames[capture.platform]}</p><textarea aria-label="本次采集预览" value={capture.text} readOnly rows={5} /><ul>{capture.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><div className="actions"><button disabled={busy} onClick={applyCapture}>采用采集内容</button><button disabled={busy} onClick={() => { void run(async () => { await db.noteDrafts.update(draft.id, { pendingCaptureId: null }); setSelectedCapture(''); }); }}>忽略本次采集</button></div></div>}
      <label htmlFor="idea-content">采集正文</label><textarea id="idea-content" rows={10} maxLength={100000} value={input.content} onChange={e => change('content', e.target.value)} placeholder="提取后采用正文，也可以手动粘贴和修改。" />
      {input.captureIds.length > 0 && <p className="muted">已关联 {input.captureIds.length} 份采集记录，原始来源和完整性提示保留在采集预览中。{input.captureIds.map(id => <a key={id} href={`collection.html?id=${id}`} target="_blank" rel="noreferrer"> 查看采集 ↗ </a>)}</p>}
    </section>
    <QualitySummary quality={contentSource?.quality ?? assessQuality({ text: input.content, url: input.url, platform: input.platform })} provenance={contentSource?.provenance} text={input.content} url={input.url} /><section className="panel note-section"><h2>我的感悟</h2><label className="sr-only" htmlFor="idea-thoughts">我的感悟</label><textarea id="idea-thoughts" rows={6} maxLength={100000} value={input.body} onChange={e => change('body', e.target.value)} placeholder="这件事为什么值得记录？它让你想到什么机会？" />
      <h2>待研究问题</h2><label className="sr-only" htmlFor="idea-questions">待研究问题</label><textarea id="idea-questions" rows={4} maxLength={100000} value={input.researchQuestions} onChange={e => change('researchQuestions', e.target.value)} placeholder="接下来需要验证哪些假设？" />
    </section>
    <section className="panel note-section"><h2>分类与标签</h2><div className="metadata-row"><div><label htmlFor="idea-category">分类</label><input id="idea-category" maxLength={100} value={input.category} onChange={e => change('category', e.target.value)} placeholder="例如：产品机会" /></div><div><label htmlFor="idea-tags">标签</label><input id="idea-tags" maxLength={3000} value={input.tagsText} onChange={e => change('tagsText', e.target.value)} placeholder="多个标签用逗号分隔" /></div></div>
      <label htmlFor="idea-status">整理状态</label><select id="idea-status" value={input.status} onChange={e => change('status', e.target.value as typeof input.status)}><option value="inbox">收集箱</option><option value="incubating">孵化中</option><option value="archived">已归档</option></select>
      <label className="favorite-toggle"><input type="checkbox" checked={input.favorite} onChange={e => change('favorite', e.target.checked)} />标记收藏</label>
    </section>
    <section className="panel"><h2>保存与分析模式</h2><p>当前模式：{autoPolicy?.mode === "after-save" && autoPolicy.autoEnabled ? "保存后按已授权范围自动入队（不发送截图）" : autoPolicy?.mode === "assist" ? "浏览辅助，须主动确认本条入队" : "手动分析，保存不触发 AI"}。暂停时新任务保留为暂停，敏感来源或黑名单会阻止发送。</p>{autoPolicy?.mode === "assist" && <label className="check-line"><input type="checkbox" checked={assistSave} disabled={!autoPolicy.autoEnabled} onChange={event => setAssistSave(event.target.checked)} />本条保存灵感后按已授权范围加入 AI 队列（不含截图）</label>}<a href="tasks.html" target="_blank" rel="noreferrer">查看 AI 任务中心</a></section><div className="note-editor-footer">{note?.saveState === "saved" && <a href={`analysis.html?noteId=${encodeURIComponent(note.id)}`} target="_blank" rel="noreferrer">AI 分析与历史</a>}{note?.saveState === "saved" && <a href={`notes.html?research&from=note&id=${encodeURIComponent(note.id)}`} target="_blank" rel="noreferrer">深度研究</a>}{note?.saveState === "saved" && <a href={`notes.html?research&wizard&from=note&id=${encodeURIComponent(note.id)}`} target="_blank" rel="noreferrer">启动深度研究</a>}<div className="actions"><button disabled={busy} onClick={() => save('draft')}>保存草稿</button><button className="primary" disabled={busy} onClick={() => save('saved')}>{busy ? '处理中…' : '保存灵感'}</button><button disabled={busy} className="danger" onClick={() => { void remove(); }}>删除笔记</button></div><p className="muted">创建：{new Date(note?.createdAt ?? draft.createdAt).toLocaleString('zh-CN')} · 更新：{new Date(note?.updatedAt ?? draft.updatedAt).toLocaleString('zh-CN')} · AI 仅按当前已授权模式处理已保存内容。</p></div>
  </>;
}

export function NoteEditor() {
  const id = new URLSearchParams(location.search).get('id') ?? '';
  const last = useRef<NoteDraft | null>(null);
  const result = useLiveQuery(async () => {
    try { return { draft: await db.noteDrafts.get(id), failed: false }; }
    catch { return { draft: undefined, failed: true }; }
  }, [id]);
  if (result?.draft) last.current = result.draft;
  const draft = result?.draft ?? last.current;
  return <div className="shell note-editor"><header><a className="brand" href="notes.html"><span className="mark">i</span>IdeaClip</a><a href="notes.html">返回灵感库 ↗</a></header><main><p className="eyebrow">CONNECT THE SPARKS</p><h1>把观察，写成自己的灵感。</h1>{result?.failed && <p role="alert" className="error">本地数据暂时不可用。当前页面输入仍保留，请勿关闭并稍后重试。</p>}{!result ? <p role="status">正在恢复草稿…</p> : draft ? <EditorForm draft={draft} key={draft.id} /> : <p role="alert">找不到草稿，可能已被删除。请回到灵感库新建。</p>}</main></div>;
}
