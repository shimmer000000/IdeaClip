import { useEffect, useRef, useState } from 'react';
import { db } from '../storage';
import { cleanAbandonedStages, discardBackup, exportBackup, friendlyError, prepareBackup, restoreBackup, type PreparedBackup, type RestoreResult } from './service';
import './backup.css';

const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
function ReplaceConfirmation({ close, confirm }: { close: () => void; confirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null); const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="backup-confirm" aria-label="完整替换二次确认" onCancel={event => { event.preventDefault(); close(); }}><h2>确认完整替换？</h2><p>当前笔记、未提交草稿、截图、采集、设置、分析、项目、自定义模板、对比报告及研究计划、联网资料、综合报告、联网任务历史和研究向导（含项目草稿）将替换为备份内容。此操作不能在界面撤销，请先备份当前数据，并关闭其他编辑窗口。</p><p>写入在一个事务中完成，失败或中断将整体回滚。</p><label className="backup-ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />我已备份当前数据，确认完整替换</label><div className="backup-buttons"><button onClick={close}>取消替换</button><button className="danger" disabled={!acknowledged} onClick={confirm}>确认替换全部数据</button></div></dialog>;
}
export function BackupPanel() {
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [prepared, setPrepared] = useState<PreparedBackup | null>(null);
  const held = useRef<PreparedBackup | null>(null); const controller = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge'); const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null); const [usage, setUsage] = useState(''); const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void cleanAbandonedStages().catch(() => {});
    const beforeUnload = (event: BeforeUnloadEvent) => { if (busyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { controller.current?.abort(); if (held.current) void discardBackup(held.current).catch(() => {}); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setResult(null);
    const current = new AbortController(); controller.current = current;
    try { await action(current.signal); } catch (error) { setError(friendlyError(error)); setMessage(''); }
    finally { busyRef.current = false; setBusy(false); controller.current = null; }
  }
  async function clearPreview() { const previous = held.current; held.current = null; setPrepared(null); if (previous) await discardBackup(previous); }
  function backup() { void run(async signal => {
    const blob = await exportBackup(db, { signal, progress: setMessage });
    const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `IdeaClip-Backup-${date}.zip`; link.click();
    // Let the browser accept the download before releasing the local Blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 10000); setMessage(`备份文件已生成（${size(blob.size)}），请确认下载完成。`);
  }); }
  function choose(file?: File) { if (!file) return; void run(async signal => {
    await clearPreview(); setMessage('正在检查备份格式与完整性…');
    const next = await prepareBackup(file, { signal, progress: setMessage }); held.current = next; setPrepared(next); setMode('merge'); setMessage('校验通过，尚未更改当前数据库。');
  }); }
  function restore(confirmed = false) { const target = held.current; if (!target) return; setConfirm(false); void run(async signal => {
    const outcome = await restoreBackup(target, mode, db, { signal, confirmed, progress: setMessage }); setResult(outcome); setMessage('恢复完成，已通知打开的灵感库刷新。');
    await clearPreview().catch(() => setMessage('恢复已完成；临时校验文件未能清理，下次打开设置页会重试。'));
  }); }
  function estimate() { void run(async () => {
    const estimate = await navigator.storage?.estimate(); const notes = await db.notes.count(); const screenshots = await db.screenshots.count();
    setUsage(`笔记 ${notes} 条，截图 ${screenshots} 张；当前扩展存储估算 ${estimate?.usage == null ? '不可用' : size(estimate.usage)}，估算总配额 ${estimate?.quota == null ? '不可用' : size(estimate.quota)}（含索引、缓存及临时校验数据）。`); setMessage('已更新本地存储用量。');
  }); }
  return <section className="panel backup-panel"><span className="badge">本地数据</span><h2>数据备份与恢复</h2><p>导出完整 ZIP，包含笔记、感悟、正文、标签、草稿、收藏、原始截图、采集、设置及已有分析、商业机会对比、项目和研究计划（含资料、关联及历史）记录。搜索索引与缩略图在恢复后重建。</p><div className="backup-buttons"><button className="primary" disabled={busy} onClick={backup}>立即备份</button><button disabled={busy} onClick={() => input.current?.click()}>从文件恢复</button><button disabled={busy} onClick={estimate}>查看数据库使用量</button>{busy && <button onClick={() => controller.current?.abort()}>取消当前操作</button>}</div><input ref={input} aria-label="选择 IdeaClip 备份文件" type="file" accept=".zip,application/zip" disabled={busy} onChange={event => { choose(event.target.files?.[0]); event.target.value = ''; }} />{usage && <p className="muted">{usage}</p>}
    <details><summary>备份文件说明与安全提醒</summary><p>全程本地处理，不上传、不调用 AI。文件不加密，包含私人笔记，请妥善保存。只导出已知业务字段，不包含 API Key 或访问令牌配置，并移除常见凭据格式；请勿在笔记正文中记录秘密。链接中的敏感查询参数会移除，导入后需重新连接网页才能截图。</p><p>接受 IdeaClip 格式 v1–v6 的无压缩 ZIP，逐项校验 CRC32、SHA-256、图片签名、记录与关联。最多 512 MiB、10 万条记录、1 万个文件、50 万条关联、每项 8 MiB；不接受普通 ZIP、压缩条目、加密文件或脚本。大数据分批处理，临时校验与事务写入需要额外磁盘空间。</p><p>合并保留本地数据：相同稳定 ID 且内容相同则去重；内容不同则保留本地，跳过冲突数据及其关联分组。设置冲突保留本地。完整替换只在校验与二次确认后进行，失败整体回滚。恢复前请关闭其他编辑窗口，建议先备份当前数据。</p></details>
    {prepared && <div className="backup-preview"><h3>恢复预览</h3><p>备份创建时间：{new Date(prepared.summary.createdAt).toLocaleString('zh-CN')}</p><p>笔记 {prepared.summary.counts.notes} 条，截图 {prepared.summary.counts.screenshots} 张，未提交草稿 {prepared.summary.counts.noteDrafts} 条，采集 {prepared.summary.counts.contentCaptures} 条</p><p>设置 {prepared.summary.counts.settings} 条，分析 {prepared.summary.counts.analyses} 条，项目 {prepared.summary.counts.projects} 条，模板 {prepared.summary.counts.aiTemplates} 条（恢复后停用），对比报告 {prepared.summary.counts.comparisonReports} 份，研究计划 {prepared.summary.counts.researchPlans} 份（含资料与历史），联网资料 {prepared.summary.counts.researchSources} 条，研究报告 {prepared.summary.counts.researchReports} 份，研究向导 {prepared.summary.counts.researchWorkflows} 份（恢复后重新审核），联网任务历史 {prepared.summary.counts.researchRuns} 条（不恢复执行授权）；文件 {size(prepared.summary.bytes)}</p><label>恢复方式<select aria-label="恢复方式" value={mode} disabled={busy} onChange={event => setMode(event.target.value as 'merge' | 'replace')}><option value="merge">合并恢复（保留本地冲突记录）</option><option value="replace">完整替换（需要再次确认）</option></select></label><div className="backup-buttons"><button className="primary" disabled={busy} onClick={() => mode === 'replace' ? setConfirm(true) : restore()}>开始恢复</button><button disabled={busy} onClick={() => { void clearPreview().catch(error => setError(friendlyError(error))); }}>取消预览</button></div></div>}
    {message && <p role="status" className="notice">{message}</p>}{error && <p role="alert" className="error">{error}</p>}{result && <div role="status" className="backup-result"><strong>成功 {result.succeeded} 条，失败 {result.failed} 条，跳过 {result.skipped} 条</strong><p>重复 {result.duplicates} 条；冲突或关联冲突 {result.conflicts} 条。{result.conflicts > 0 ? '这些记录未覆盖本地内容；若需要完整备份版本，请先备份当前数据库，再使用完整替换。' : ''}</p></div>}{confirm && <ReplaceConfirmation close={() => setConfirm(false)} confirm={() => restore(true)} />}
  </section>;
}
