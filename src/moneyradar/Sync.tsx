import { useMemo, useState } from 'react';
import './sync.css';
import { browserSync, localBase, projectUrl, type Preview, type Receipt, type Outbox } from './service';

export function MoneyRadarSync({ noteId, disabled }: { noteId: string; disabled: boolean }) {
  const service = useMemo(browserSync, []);
  const [open,setOpen] = useState(false), [base,setBase] = useState('http://127.0.0.1:47831'), [paired,setPaired] = useState(false), [pending,setPending] = useState<any>(), [preview,setPreview] = useState<Preview>(), [old,setOld] = useState<Outbox>(), [receipt,setReceipt] = useState<Receipt>(), [selected,setSelected] = useState(false), [confirmed,setConfirmed] = useState(false), [message,setMessage] = useState(''), [busy,setBusy] = useState(false);
  async function run(fn: () => Promise<void>) { if (busy) return; setBusy(true); setMessage(''); try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : '操作失败，请手动重试'); } finally { setBusy(false); } }
  async function load() {
    const pair = await service.pair(); setPaired(!!pair); if (pair) setBase(pair.base);
    setPending(await service.pending()); const previous = await service.outbox(noteId); setOld(previous); setReceipt(previous?.receipt);
    const unresolved = previous && previous.state !== 'saved';
    setPreview(unresolved ? previous.payload : await service.preview(noteId)); setSelected(false); setConfirmed(false); setOpen(true);
  }
  const locked = !!old && old.state !== 'saved';
  const edit = <K extends keyof Preview>(key: K, value: Preview[K]) => { if (preview) setPreview({ ...preview, [key]: value }); setConfirmed(false); };
  return <section className="panel note-section" data-moneyradar><h2>MoneyRadar 情报同步</h2><p>逐条预览后发送公开内容。截图、我的感悟和 AI 报告不会发送，不自动同步收藏库。</p>
    <button type="button" disabled={disabled || busy} onClick={() => void run(load)}>发送到 MoneyRadar</button>{disabled && <p className="muted">请先保存当前收藏，提交未保存编辑。</p>}
    {open && <div role="dialog" aria-modal="false" aria-label="发送到MoneyRadar预览">
      <details open={!paired}><summary>本地配对设置</summary><label htmlFor="mr-address">MoneyRadar 本机地址</label><input id="mr-address" value={base} disabled={paired || busy} onChange={e => setBase(e.target.value)} />
        <p>独立受限凭据，仅保存在 Chrome 会话存储；浏览器重启后需重新配对，不使用两个项目的主密钥。</p>
        {!paired ? <><button disabled={busy} onClick={() => {
          // Request optional host access directly from this user gesture, before any await.
          let origin: string; try { origin = localBase(base); } catch { setMessage('请填写 http://127.0.0.1:端口'); return; }
          const access = chrome.permissions.request({ origins: ['http://127.0.0.1/*'] });
          void run(async () => { if (!await access) throw new Error('未授予本机访问权限，未申请配对'); await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}); const p = await service.requestPair(origin); setPending(p); await chrome.tabs.create({url:p.approvalUrl}); });
        }}>申请本地配对</button>{pending && <><p>配对码：<strong>{pending.verificationCode}</strong> · 扩展 ID：<code>{chrome.runtime.id}</code></p><p>请在新开的 MoneyRadar 页面核对并授权，然后回到此页。</p><button disabled={busy} onClick={() => void run(async () => { await service.claimPair(); setPaired(true); setBase((await service.pair())!.base); setMessage('配对完成，仅允许收藏相关操作'); })}>完成配对</button></>}</> : <><p>已配对，仅有收藏入库与本次结果查询权限。</p><button disabled={busy} onClick={() => void run(async () => { await service.disconnect(); setPaired(false); setPending(undefined); setMessage('本机凭据已移除；撤销服务器连接请到MoneyRadar数据管理'); })}>断开本机会话</button></>}
      </details>
      {preview && <><label><input type="checkbox" checked={selected} onChange={e => { setSelected(e.target.checked); setConfirmed(false); }} />选择当前收藏：{preview.title}</label><label htmlFor="mr-title">发送标题</label><input id="mr-title" maxLength={200} value={preview.title} disabled={locked} onChange={e => edit('title',e.target.value)} /><label htmlFor="mr-url">公开网址</label><input id="mr-url" readOnly value={preview.url} />
        <label htmlFor="mr-summary">公开正文摘要（最多3000字，请检查是否含私人信息）</label><textarea id="mr-summary" maxLength={3000} rows={7} value={preview.summary} disabled={locked} onChange={e => edit('summary',e.target.value)} /><p className="muted">摘要取已保存正文的前3000字；可删减。来源：{preview.source} · 观察时间由MoneyRadar记录。</p>
        <label htmlFor="mr-tags">发送标签（逗号分隔，最多30个）</label><input id="mr-tags" value={preview.tags.join(',')} disabled={locked} onChange={e => edit('tags',e.target.value.split(/[,，]/).map(t => t.trim()).filter(Boolean))} />
        <label htmlFor="mr-notes">本次公开备注（默认空白，需手动填写）</label><textarea id="mr-notes" maxLength={1000} value={preview.notes} disabled={locked} onChange={e => edit('notes',e.target.value)} />
        <label><input type="checkbox" checked={preview.demo} disabled={locked} onChange={e => edit('demo',e.target.checked)} />这是演示数据，保存为演示档案</label>
        <p>重复网址只追加本次确认的来源内容，保留 MoneyRadar 人工分析。收费入口或宣传内容不会自动生成收入证据。</p>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我确认所选记录及以上内容可发送到本机 MoneyRadar</label>
        {locked ? <><p>上次结果未确认，以下重试会先查已保存结果；仅无结果时重发同一请求。</p><button disabled={!paired || !selected || !confirmed || busy || disabled} onClick={() => void run(async () => { const r = await service.retry(noteId,true); setReceipt(r); setOld(await service.outbox(noteId)); setMessage(r.replayed ? '已确认上次保存结果，未重复追加' : '重试保存成功'); })}>手动查询并安全重试</button></> : <button disabled={!paired || !selected || !confirmed || busy || disabled} onClick={() => void run(async () => { try { const r = await service.send(preview,true); setReceipt(r); setMessage(r.status === 'duplicate' ? '已识别重复，确认内容已追加为来源，人工分析保留' : '已成功保存到MoneyRadar'); } finally { setOld(await service.outbox(noteId)); } })}>确认发送此收藏</button>}
      </>}
      {receipt && paired && receipt.openUrl.startsWith(base + '/#project/') && <a href={projectUrl(base,receipt.openUrl)} target="_blank" rel="noreferrer">打开 MoneyRadar 项目 ↗</a>}
      {locked && <button disabled={busy} onClick={() => { if (!confirm('请先在MoneyRadar手动核对旧请求可能已经保存。放弃仅清除本机重试快照，不删除收藏或MoneyRadar档案；新的内容仍需重新预览确认。确认已核对并放弃旧请求？')) return; void run(async () => { await service.discard(noteId,true); setOld(undefined); setReceipt(undefined); setPreview(await service.preview(noteId)); setSelected(false); setConfirmed(false); setMessage('已放弃本机旧请求，请重新预览并确认'); }); }}>核对后放弃旧请求并重新预览</button>}
      <div className="actions"><button disabled={busy} onClick={() => setOpen(false)}>关闭预览</button><button disabled={busy} onClick={() => void run(async () => { await service.clearSaved(); setMessage('已清理本机已保存同步记录，收藏和MoneyRadar档案保留'); })}>清理已保存的同步记录</button></div>
    </div>}
    {message && <p role="status" aria-live="polite">{message}</p>}</section>;
}
