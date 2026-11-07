import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeaClipDB, createNote } from '../storage';
import { noteDefaults, inputFromNote } from '../inspiration/model';
import { exportBackup, prepareBackup, restoreBackup, discardBackup, type PreparedBackup } from './service';
import { readZip, writeZip, digest, type ZipEntry } from './zip';
import { TABLES, type Manifest } from './model';

let source: IdeaClipDB; let target: IdeaClipDB; const prepared: PreparedBackup[] = [];
beforeEach(() => { source = new IdeaClipDB(`backup-source-${crypto.randomUUID()}`); target = new IdeaClipDB(`backup-target-${crypto.randomUUID()}`); });
afterEach(async () => { vi.restoreAllMocks(); for (const backup of prepared.splice(0)) await discardBackup(backup); await source.delete(); await target.delete(); });
const png = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII='), value => value.charCodeAt(0))], { type: 'image/png' });
async function fixture(database = source, imageCount = 2) {
  for (let index = 0; index < imageCount; index++) await database.screenshots.put({ id: `image-${index}`, blob: png(), kind: 'visible', width: 1, height: 1, originalBytes: 68, sourceTabId: 33, sourceUrl: 'https://example.com/post', sourceTitle: '来源', createdAt: 1 });
  const note = { ...noteDefaults(), id: 'note', title: '灵感', url: 'https://example.com/post', body: '我的感悟', content: '正文 <script>不会执行</script>', tags: ['商业', '研究'], status: 'inbox' as const, saveState: 'draft' as const, favorite: true, createdAt: 1, updatedAt: 2, screenshotIds: Array.from({ length: imageCount }, (_, i) => `image-${i}`), captureIds: ['capture'], revision: 1 };
  await database.notes.put(note);
  await database.noteDrafts.put({ id: 'note', entryKey: 'note:note', input: { ...inputFromNote(note), body: '尚未提交的感悟' }, sourceTabId: 33, sourcePageUrl: note.url, baseRevision: 1, pendingCaptureId: null, hasChanges: true, createdAt: 1, updatedAt: 3 });
  await database.contentCaptures.put({ id: 'capture', noteId: 'note', sourceUrl: note.url, originalUrl: note.url, platform: 'article', siteName: '示例', title: '原网页', author: '作者', publishedAt: null, text: '采集正文', images: [], links: [], githubLinks: [], collectedAt: 1, status: 'readable', warnings: [], sourceTabId: 33, screenshotIds: ['image-0'], updatedAt: 1, textOrigin: 'extracted' });
  await database.settings.put({ id: 'general', aiEnabled: false });
  await database.analyses.put({ id: 'analysis', noteId: 'note', createdAt: 1, content: '历史分析，不调用模型' });
  await database.projects.put({ id: 'project', title: '已有项目', noteIds: ['note'], createdAt: 1, updatedAt: 1 });
}
async function preview(file?: Blob) { const backup = await prepareBackup(file ?? await exportBackup(source)); prepared.push(backup); return backup; }
async function rewrite(file: Blob, change: (entries: ZipEntry[], manifest: Manifest) => Promise<void> | void, fixHashes = true) {
  const entries: ZipEntry[] = (await readZip(file)).map(({ name, blob }) => ({ name, blob }));
  const index = entries.findIndex(entry => entry.name === 'manifest.json'); const manifest: Manifest = JSON.parse(await entries[index].blob.text()); entries.splice(index, 1);
  await change(entries, manifest);
  if (fixHashes) manifest.entries = await Promise.all(entries.map(async entry => ({ name: entry.name, size: entry.blob.size, sha256: await digest(entry.blob) })));
  return writeZip([...entries, { name: 'manifest.json', blob: new Blob([JSON.stringify(manifest)]) }]);
}
describe('完整备份恢复', () => {
  it.each(['notes', 'noteDrafts'] as const)('新 %s 与本地另一种笔记形态同 ID 时跳过，不把无关草稿与笔记混合', async table => {
    const note = { ...noteDefaults(), id: 'shared', title: '源笔记', url: '', body: '源感悟', tags: [], status: 'inbox' as const, createdAt: 1, updatedAt: 1 };
    const draft = { id: 'shared', entryKey: 'manual:shared', input: inputFromNote(note), baseRevision: null, sourceTabId: null, sourcePageUrl: '', pendingCaptureId: null, hasChanges: true, createdAt: 1, updatedAt: 1 };
    if (table === 'notes') { await source.notes.put(note); await target.noteDrafts.put({ ...draft, input: { ...draft.input, body: '本地草稿' } }); }
    else { await source.noteDrafts.put(draft); await target.notes.put({ ...note, body: '本地笔记' }); }
    expect(await restoreBackup(await preview(), 'merge', target)).toMatchObject({ succeeded: 0, skipped: 1, conflicts: 1 });
    if (table === 'notes') { expect(await target.notes.count()).toBe(0); expect((await target.noteDrafts.get('shared'))?.input.body).toBe('本地草稿'); }
    else { expect(await target.noteDrafts.count()).toBe(0); expect((await target.notes.get('shared'))?.body).toBe('本地笔记'); }
  });
  it('校验暂存空间不足时停止并清理，原笔记未变', async () => {
    await fixture(); const file = await exportBackup(source); const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) { if (this.transaction.db.name.startsWith('ideaclip-restore-stage-')) throw new DOMException('full', 'QuotaExceededError'); return add.apply(this, args); });
    await expect(prepareBackup(file)).rejects.toThrow('空间不足'); expect((await source.notes.get('note'))?.body).toBe('我的感悟'); expect((await Dexie.getDatabaseNames()).filter(n => n.startsWith('ideaclip-restore-stage-'))).toEqual([]);
  });
  it('源数据关联缺失时明确停止导出，不生成无法恢复的备份', async () => {
    await fixture(); await source.screenshots.delete('image-0'); await expect(exportBackup(source)).rejects.toThrow('关联'); expect(await source.notes.count()).toBe(1); expect(await source.contentCaptures.count()).toBe(1);
  });
  it('恶意超范围时间拒绝，避免恢复后管理页日期渲染失败', async () => {
    await fixture(); const invalid = await rewrite(await exportBackup(source), async entries => { const entry = entries.find(e => e.name.startsWith('data/notes/'))!; const rows = JSON.parse(await entry.blob.text()); rows[0].createdAt = Number.MAX_SAFE_INTEGER; entry.blob = new Blob([JSON.stringify(rows)]); }); await expect(preview(invalid)).rejects.toThrow('时间');
  });
  it('空数据库可导出有效 ZIP 并恢复，默认 AI 仍关闭', async () => {
    const file = await exportBackup(source); expect((await readZip(file)).map(e => e.name)).toEqual(['manifest.json']);
    const backup = await preview(file); expect(backup.summary.counts.notes).toBe(0); expect(await restoreBackup(backup, 'merge', target)).toMatchObject({ succeeded: 0, failed: 0 }); expect(await target.notes.count()).toBe(0);
  });
  it('图片 Blob、多图、正文感悟、标签、草稿、设置、分析项目与关联完整恢复并重建索引', async () => {
    await fixture(); const backup = await preview(); const result = await restoreBackup(backup, 'merge', target); expect(result.succeeded).toBe(8);
    expect(await target.notes.get('note')).toMatchObject({ body: '我的感悟', content: '正文 <script>不会执行</script>', tags: ['商业', '研究'], saveState: 'draft', favorite: true, screenshotIds: ['image-0', 'image-1'], captureIds: ['capture'], sourceTabId: null });
    expect(await digest((await target.screenshots.get('image-0'))!.blob)).toBe(await digest(png()));
    expect((await target.noteDrafts.get('note'))?.input.body).toBe('尚未提交的感悟'); expect(await target.draftCatalog.get('note')).toMatchObject({ pending: 1 });
    expect(await target.contentCaptures.get('capture')).toMatchObject({ noteId: 'note', screenshotIds: ['image-0'] }); expect((await target.projects.get('project'))?.noteIds).toEqual(['note']); expect(await target.analyses.count()).toBe(1); expect((await target.settings.get('general'))?.aiEnabled).toBe(false); expect((await target.noteSearch.get('note'))?.body).toBe('我的感悟');
  });
  it('多批截图备份逐项恢复，不使用 Base64 内嵌图片', async () => {
    await fixture(source, 80); const file = await exportBackup(source); const entries = await readZip(file); expect(entries.filter(entry => entry.name.startsWith('images/'))).toHaveLength(80);
    const metadata = entries.filter(entry => entry.name.startsWith('data/screenshots/')); expect(metadata.length).toBe(5); expect(await metadata[0].blob.text()).not.toContain('base64'); await restoreBackup(await preview(file), 'merge', target); expect(await target.screenshots.count()).toBe(80);
  });
  it('重复合并全部去重；不同 ID 保持已有数据', async () => {
    await fixture(); const backup = await preview(); await createNote({ title: '本地', body: '', tags: [], url: '' }, target); await restoreBackup(backup, 'merge', target); const result = await restoreBackup(backup, 'merge', target); expect(result).toMatchObject({ succeeded: 0, skipped: 8, duplicates: 8, conflicts: 0 }); expect(await target.notes.count()).toBe(2);
  });
  it('冲突保留本地，连带新记录跳过，避免同 ID 图片误关联；无关记录仍可导入', async () => {
    await fixture(); const local = { ...(await source.screenshots.get('image-0'))!, sourceTitle: '本地不同图片' }; await target.screenshots.put(local); await createNote({ title: '独立新笔记', body: '', tags: [], url: '' }, source);
    const result = await restoreBackup(await preview(), 'merge', target); expect(result.conflicts).toBe(6); expect(result.succeeded).toBe(3); expect((await target.projects.get('project'))?.noteIds).toEqual(['note']); expect(await target.notes.count()).toBe(1); expect((await target.screenshots.get('image-0'))?.sourceTitle).toBe('本地不同图片'); expect(await target.notes.get('note')).toBeUndefined();
  });
  it('未提交草稿 entryKey 冲突保留两端安全，不触发静默覆盖', async () => {
    await fixture(); const draft = (await source.noteDrafts.get('note'))!; await target.noteDrafts.put({ ...draft, id: 'local-id' }); const result = await restoreBackup(await preview(), 'merge', target); expect(result.conflicts).toBeGreaterThan(0); expect(await target.notes.count()).toBe(0); expect(await target.noteDrafts.count()).toBe(1);
  });
  it('完整替换必须确认，成功后旧数据被备份数据整体替换', async () => {
    await fixture(); await createNote({ title: '旧本地', body: '', tags: [], url: '' }, target); const backup = await preview(); await expect(restoreBackup(backup, 'replace', target)).rejects.toThrow('二次确认'); expect(await target.notes.count()).toBe(1); await restoreBackup(backup, 'replace', target, { confirmed: true }); expect((await target.notes.toArray()).map(row => row.id)).toEqual(['note']); expect(await target.noteCatalog.count()).toBe(1);
  });
  it('模拟配额不足，替换清空和部分写入全部回滚，预览可重试', async () => {
    await fixture(); const localId = await createNote({ title: '原有内容', body: '不能丢', tags: [], url: '' }, target); const backup = await preview(); vi.spyOn(target.noteSearch, 'bulkPut').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(restoreBackup(backup, 'replace', target, { confirmed: true })).rejects.toThrow('空间不足'); expect(await target.notes.count()).toBe(1); expect((await target.notes.get(localId))?.body).toBe('不能丢'); expect(await target.screenshots.count()).toBe(0); expect(await target.noteCatalog.get(localId)).toBeDefined();
    await restoreBackup(backup, 'replace', target, { confirmed: true }); expect(await target.screenshots.count()).toBe(2);
  });
  it('事务中途取消恢复，所有原始表和目录保持原状', async () => {
    await fixture(); const localId = await createNote({ title: '原笔记', body: '', tags: [], url: '' }, target); const backup = await preview(); const controller = new AbortController();
    await expect(restoreBackup(backup, 'replace', target, { confirmed: true, signal: controller.signal, progress: message => { if (message.startsWith('正在恢复：写入')) controller.abort(); } })).rejects.toThrow('回滚'); expect((await target.notes.toArray()).map(row => row.id)).toEqual([localId]); expect(await target.contentCaptures.count()).toBe(0);
  });
  it('CRC / SHA 损坏被拒绝，已有数据库不变', async () => {
    await fixture(); const file = await exportBackup(source); const corrupted = await rewrite(file, entries => { const entry = entries.find(e => e.name.startsWith('images/'))!; entry.blob = new Blob(['broken']); }, false); await expect(preview(corrupted)).rejects.toThrow('校验和');
    const bytes = new Uint8Array(await file.arrayBuffer()); bytes[50] ^= 1; await expect(preview(new Blob([bytes]))).rejects.toThrow(); expect(await source.notes.count()).toBe(1);
  });
  it('不兼容的格式和未来 schema 被拒绝', async () => {
    const file = await exportBackup(source); for (const databaseVersion of [0, 14]) await expect(preview(await rewrite(file, (_entries, manifest) => { manifest.databaseVersion = databaseVersion; }))).rejects.toThrow('不兼容');
    await expect(preview(await rewrite(file, (_entries, manifest) => { manifest.formatVersion = 999 as 1; }))).rejects.toThrow('不兼容');
  });
  it('缺失图片或关联、重复 ID 与恶意 URL 都拒绝', async () => {
    await fixture(); const file = await exportBackup(source);
    const missing = await rewrite(file, entries => { entries.splice(entries.findIndex(e => e.name.startsWith('images/')), 1); }); await expect(preview(missing)).rejects.toThrow('缺少关联截图');
    for (const change of ['reference', 'duplicate', 'url']) {
      const invalid = await rewrite(file, async entries => { const entry = entries.find(e => e.name.startsWith('data/notes/'))!; const rows = JSON.parse(await entry.blob.text()); if (change === 'reference') rows[0].captureIds = ['missing']; else if (change === 'duplicate') rows.push(rows[0]); else rows[0].url = 'javascript:alert(1)'; entry.blob = new Blob([JSON.stringify(rows)]); }); await expect(preview(invalid)).rejects.toThrow();
    }
  });
  it('凭据字段不导出，常见令牌及 URL 敏感参数移除', async () => {
    const token = 'sk-' + 'a'.repeat(24); const key = await createNote({ title: '安全', body: `api_key=${token} Bearer ${'b'.repeat(24)}`, tags: [], url: 'https://example.com/?access_token=private&keep=yes' }, source);
    await source.settings.put({ id: 'general', aiEnabled: false, apiKey: 'private-credential', accessToken: 'private-access' } as never); await source.notes.update(key, { secret: 'private-unknown' } as never);
    const entries = await readZip(await exportBackup(source)); const texts = await Promise.all(entries.filter(e => e.name.startsWith('data/')).map(e => e.blob.text())); const joined = texts.join(''); expect(joined).not.toContain(token); expect(joined).not.toContain('private-'); expect(joined).not.toContain('access_token'); expect(joined).toContain('keep=yes');
  });
  it('v1 数据库升级后可导出迁移，不丢失旧感悟、标签和设置', async () => {
    const legacy = new Dexie(source.name); legacy.version(1).stores({ notes: 'id, url, status, createdAt, updatedAt, *tags', settings: 'id', analyses: 'id, noteId, createdAt', projects: 'id, updatedAt, *noteIds' });
    await legacy.table('notes').put({ id: 'old', title: '旧灵感', url: '', body: '旧感悟', tags: ['旧标签'], status: 'inbox', createdAt: 1, updatedAt: 2 }); await legacy.table('settings').put({ id: 'general', aiEnabled: true }); legacy.close();
    await restoreBackup(await preview(), 'merge', target); expect(await target.notes.get('old')).toMatchObject({ body: '旧感悟', content: '', tags: ['旧标签'], createdAt: 1, updatedAt: 2 }); expect((await target.settings.get('general'))?.aiEnabled).toBe(true);
    expect(await target.noteCatalog.count()).toBe(1); expect(await source.notes.count()).toBe(1);
  });
  it('格式 v1 可迁移 schema 1 元数据，来源缺省补齐且感悟不变', async () => {
    await createNote({ title: '早期笔记', body: '早期感悟', tags: ['早期'], url: '' }, source); const file = await rewrite(await exportBackup(source), async (entries, manifest) => { manifest.databaseVersion = 1; const entry = entries.find(e => e.name.startsWith('data/notes/'))!; const [row] = JSON.parse(await entry.blob.text()); entry.blob = new Blob([JSON.stringify([{ id: row.id, title: row.title, body: row.body, url: row.url, tags: row.tags, createdAt: row.createdAt, updatedAt: row.updatedAt }])]); }); await restoreBackup(await preview(file), 'merge', target); expect((await target.notes.toArray())[0]).toMatchObject({ body: '早期感悟', content: '', saveState: 'saved' });
  });
  it('校验阶段取消不改动主数据库，临时数据库释放', async () => {
    await fixture(); const controller = new AbortController(); controller.abort(); await expect(prepareBackup(await exportBackup(source), { signal: controller.signal })).rejects.toThrow('取消'); expect(await source.notes.count()).toBe(1); expect((await Dexie.getDatabaseNames()).filter(n => n.startsWith('ideaclip-restore-stage-'))).toEqual([]);
  });
  it('原始网址文本保留，不因 URL 规范化改写末尾斜杠或编码', async () => {
    await fixture(); const url = 'https://Example.com?q=%2f'; await source.contentCaptures.update('capture', { originalUrl: url, sourceUrl: 'https://fixture.example' }); await restoreBackup(await preview(), 'merge', target); expect(await target.contentCaptures.get('capture')).toMatchObject({ originalUrl: url, sourceUrl: 'https://fixture.example' });
  });
  it('超大像素图片头和元数据尺寸不一致均拒绝解码或恢复', async () => {
    await fixture(); const file = await exportBackup(source);
    const oversized = await rewrite(file, async entries => { const image = entries.find(entry => entry.name.startsWith('images/'))!; const bytes = new Uint8Array(await image.blob.arrayBuffer()); new DataView(bytes.buffer).setUint32(16, 0x7fffffff); image.blob = new Blob([bytes]); }); await expect(preview(oversized)).rejects.toThrow('尺寸');
    const mismatch = await rewrite(file, async entries => { const entry = entries.find(e => e.name.startsWith('data/screenshots/'))!; const rows = JSON.parse(await entry.blob.text()); rows[0].width = 100; entry.blob = new Blob([JSON.stringify(rows)]); }); await expect(preview(mismatch)).rejects.toThrow('尺寸与元数据');
  });
});

describe('ZIP 安全边界', () => {
  it('路径穿越和未知条目、重复路径拒绝生成', async () => {
    for (const name of ['../evil.js', 'images/../../evil', 'script.js', '/manifest.json']) await expect(writeZip([{ name, blob: new Blob(['x']) }])).rejects.toThrow('非法路径');
    await expect(writeZip([{ name: 'manifest.json', blob: new Blob() }, { name: 'manifest.json', blob: new Blob() }])).rejects.toThrow('重名');
  });
  it('压缩/加密/大小欺骗/目录截断与非法路径均拒绝读取', async () => {
    const file = await exportBackup(source);
    for (const kind of ['compression', 'encryption', 'bomb', 'truncated', 'path']) {
      const bytes = new Uint8Array(await file.arrayBuffer()); const view = new DataView(bytes.buffer); const central = view.getUint32(bytes.length - 6, true);
      if (kind === 'compression') view.setUint16(central + 10, 8, true);
      if (kind === 'encryption') view.setUint16(central + 8, 0x801, true);
      if (kind === 'bomb') view.setUint32(central + 24, 0x7fffffff, true);
      if (kind === 'path') bytes[central + 46] = '.'.charCodeAt(0);
      const corrupted = kind === 'truncated' ? new Blob([bytes.slice(0, -1)]) : new Blob([bytes]); await expect(readZip(corrupted)).rejects.toThrow();
    }
  });
  it('超过单条大小上限提前拒绝', async () => { await expect(writeZip([{ name: 'manifest.json', blob: new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]) }])).rejects.toThrow('8 MiB'); });
  it('备份不会包含缓存或临时 object URL，也没有 AI 调用', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); await fixture(); const file = await exportBackup(source); await restoreBackup(await preview(file), 'merge', target); const entries = await readZip(file); expect(entries.every(e => e.name === 'manifest.json' || e.name.startsWith('images/') || TABLES.some(table => e.name.startsWith(`data/${table}/`)))).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
});
