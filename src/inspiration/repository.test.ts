import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote, deleteNote, getSettings, IdeaClipDB, updateNote, type Screenshot } from '../storage';
import { emptyPage } from '../collection/model';
import { storeExtraction } from '../collection/storage';
import { adoptCapture, beginDraft, commitDraft, deleteScreenshot, draftFromCapture, editNote, patchDraft, reloadSavedNote, stageCapture, storeDraftScreenshot } from './repository';
import { requestAnalysis } from '../ai';

let database: IdeaClipDB;
const url = 'https://example.com/article';
function image(id: string = crypto.randomUUID()): Screenshot { return { id, blob: new Blob(['local-image'], { type: 'image/png' }), kind: 'visible', width: 100, height: 80, sourceUrl: url, sourceTitle: '示例网页', sourceTabId: 7, originalBytes: 100, createdAt: 10 }; }
async function capture() {
  const first = image(); const second = image(); await database.screenshots.bulkAdd([first, second]);
  const id = await storeExtraction({ ...emptyPage(url, '测试标题', '需核对完整性'), text: '采集正文', author: '作者甲', publishedAt: '2026-11-01', platform: 'article', status: 'readable' }, 7, database);
  await database.contentCaptures.update(id, { screenshotIds: [first.id, second.id] });
  return { id, first, second };
}
async function patch(id: string, fields: Parameters<typeof patchDraft>[1]) { const previous = await database.noteDrafts.get(id); return patchDraft(id, fields, previous!.input, database); }
beforeEach(() => { database = new IdeaClipDB(`notes-${crypto.randomUUID()}`); });
afterEach(async () => { vi.restoreAllMocks(); await database.delete(); });

describe('完整灵感事务与草稿', () => {
  it('正文、感悟、待研究问题、分类、多个标签和多张截图保存在同一笔记', async () => {
    const source = await capture(); const id = await draftFromCapture(source.id, database);
    await patch(id, { body: '我的商业观察', researchQuestions: '如何验证需求？', category: '产品', tagsText: '产品, 商业，产品', favorite: true });
    await commitDraft(id, 'saved', undefined, database);
    expect(await database.notes.get(id)).toMatchObject({ title: '测试标题', url, platform: 'article', author: '作者甲', publishedAt: '2026-11-01', content: '采集正文', body: '我的商业观察', researchQuestions: '如何验证需求？', category: '产品', tags: ['产品', '商业'], screenshotIds: [source.first.id, source.second.id], captureIds: [source.id], favorite: true, saveState: 'saved' });
    expect((await database.contentCaptures.get(source.id))?.noteId).toBe(id);
    expect(await (await database.screenshots.get(source.first.id))?.blob.text()).toBe('local-image');
    const other = await beginDraft('other-note', {}, database);
    await expect(adoptCapture(other, source.id, database)).rejects.toThrow('已关联另一条笔记');
    expect((await database.noteDrafts.get(other))?.input.captureIds).toEqual([]);
  });
  it('编辑暂存在草稿中，重新打开数据库后可恢复，不提前覆盖已保存内容', async () => {
    const id = await beginDraft('manual:a', {}, database); await patch(id, { title: '原标题', body: '原感悟' }); await commitDraft(id, 'saved', undefined, database);
    await patch(id, { title: '未提交标题', body: '尚未提交的感悟' }); database.close(); await database.open();
    expect((await database.notes.get(id))?.title).toBe('原标题');
    expect((await database.noteDrafts.get(id))?.input.body).toBe('尚未提交的感悟');
    await commitDraft(id, 'saved', undefined, database);
    expect((await database.notes.get(id))?.body).toBe('尚未提交的感悟');
  });
  it('重复开始及并发保存保持同一 ID，不创建重复笔记或反复修改时间', async () => {
    const ids = await Promise.all([beginDraft('source:a', {}, database), beginDraft('source:a', {}, database)]); expect(ids[0]).toBe(ids[1]);
    await patch(ids[0], { title: '一次保存' });
    await Promise.all([commitDraft(ids[0], 'saved', undefined, database), commitDraft(ids[0], 'saved', undefined, database)]);
    const before = await database.notes.get(ids[0]); await commitDraft(ids[0], 'saved', undefined, database);
    expect(await database.notes.count()).toBe(1); expect(await database.notes.get(ids[0])).toEqual(before);
  });
  it('采集链接写入失败时整体回滚，已输入内容及截图均保留', async () => {
    const source = await capture(); const id = await draftFromCapture(source.id, database); await patch(id, { body: '不能丢失的输入' });
    vi.spyOn(database.contentCaptures, 'update').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
    await expect(commitDraft(id, 'saved', undefined, database)).rejects.toThrow();
    expect(await database.notes.count()).toBe(0); expect((await database.noteDrafts.get(id))?.baseRevision).toBeNull();
    expect((await database.noteDrafts.get(id))?.input.body).toBe('不能丢失的输入'); expect(await database.screenshots.count()).toBe(2);
  });
  it('删除笔记保留共享截图与采集，仍有引用时禁止删除图片文件', async () => {
    const shot = image(); await database.screenshots.add(shot);
    const ids = [await beginDraft('one', {}, database), await beginDraft('two', {}, database)];
    for (const id of ids) { await patch(id, { title: '共享截图', screenshotIds: [shot.id] }); await commitDraft(id, 'saved', undefined, database); }
    await deleteNote(ids[0], database); await expect(deleteScreenshot(shot.id, database)).rejects.toThrow('引用');
    expect((await database.notes.get(ids[1]))?.screenshotIds).toEqual([shot.id]);
    await deleteNote(ids[1], database); expect(await database.screenshots.count()).toBe(1);
    await deleteScreenshot(shot.id, database); expect(await database.screenshots.count()).toBe(0);
  });
  it('采集本身的截图引用也受到保护；删除笔记清空采集回链而不删除采集数据', async () => {
    const source = await capture(); const id = await draftFromCapture(source.id, database); await commitDraft(id, 'saved', undefined, database);
    await deleteNote(id, database);
    expect((await database.contentCaptures.get(source.id))?.noteId).toBeNull();
    expect(await database.contentCaptures.count()).toBe(1); await expect(deleteScreenshot(source.first.id, database)).rejects.toThrow('引用');
    await expect(patch(id, { title: '不应复活' })).rejects.toThrow(); await expect(commitDraft(id, 'saved', undefined, database)).rejects.toThrow('不存在');
    expect(await database.notes.count()).toBe(0);
  });
  it('同字段并发修改不会静默覆盖，不同字段可合并，新增截图不被旧快照抹掉', async () => {
    const id = await beginDraft('concurrent', {}, database); const before = (await database.noteDrafts.get(id))!.input;
    await patchDraft(id, { title: '窗口 A' }, before, database);
    await expect(patchDraft(id, { title: '窗口 B' }, before, database)).rejects.toThrow('其他窗口');
    await patchDraft(id, { body: '独立字段' }, before, database);
    await patch(id, { screenshotIds: ['new-capture'] });
    await patchDraft(id, { screenshotIds: ['user-selected'] }, { screenshotIds: [] }, database);
    expect((await database.noteDrafts.get(id))?.input).toMatchObject({ title: '窗口 A', body: '独立字段', screenshotIds: ['new-capture', 'user-selected'] });
  });
  it('已有笔记版本变化时拒绝覆盖，草稿仍可恢复', async () => {
    const id = await createNote({ title: '旧笔记', url, body: '旧感悟', tags: [] }, database); await editNote(id, database); await patch(id, { body: '本页新感悟' });
    await updateNote(id, { title: '另一窗口修改', url, body: '其他感悟', tags: [], status: 'inbox' }, database);
    await expect(commitDraft(id, 'saved', undefined, database)).rejects.toThrow('其他窗口');
    expect((await database.noteDrafts.get(id))?.input.body).toBe('本页新感悟'); expect((await database.notes.get(id))?.body).toBe('其他感悟');
    await reloadSavedNote(id, database); expect((await database.noteDrafts.get(id))?.input.body).toBe('其他感悟');
  });
  it('未命名可以保存草稿，但正式保存需要标题；非法 URL 的编辑仍保留', async () => {
    const id = await beginDraft('validation', {}, database); await commitDraft(id, 'draft', undefined, database);
    expect((await database.notes.get(id))?.saveState).toBe('draft'); await expect(commitDraft(id, 'saved', undefined, database)).rejects.toThrow('标题');
    await patch(id, { title: '测试', url: 'javascript:alert(1)' }); await expect(commitDraft(id, 'saved', undefined, database)).rejects.toThrow('HTTP');
    expect((await database.noteDrafts.get(id))?.input.url).toBe('javascript:alert(1)');
  });
  it('待确认采集不会替换正文与感悟，必须采用或忽略后提交', async () => {
    const source = await capture(); const oldUrl = 'https://old.example/';
    const id = await beginDraft(`source:${oldUrl}`, { sourcePageUrl: oldUrl }, database); await patch(id, { title: '我的标题', content: '手动正文', body: '独立感悟' });
    await stageCapture(id, source.id, database); await expect(commitDraft(id, 'saved', undefined, database)).rejects.toThrow('待确认');
    expect((await database.noteDrafts.get(id))?.input.content).toBe('手动正文'); await adoptCapture(id, source.id, database);
    expect((await database.noteDrafts.get(id))?.input).toMatchObject({ title: '我的标题', content: '采集正文', body: '独立感悟' });
    expect((await database.noteDrafts.get(id))?.entryKey).toBe(`note:${id}`);
    expect(await beginDraft(`source:${oldUrl}`, { sourcePageUrl: oldUrl }, database)).not.toBe(id);
  });
  it('截图来源不匹配时不写入 Blob 或关联', async () => {
    const id = await beginDraft('source', { sourceTabId: 7, sourcePageUrl: url }, database);
    await expect(storeDraftScreenshot(id, { ...image(), sourceUrl: 'https://other.example' }, database)).rejects.toThrow('来源');
    expect(await database.screenshots.count()).toBe(0); expect((await database.noteDrafts.get(id))?.input.screenshotIds).toEqual([]);
    vi.spyOn(database.noteDrafts, 'update').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
    await expect(storeDraftScreenshot(id, image(), database)).rejects.toThrow('保存失败');
    expect(await database.screenshots.count()).toBe(0);
  });
  it('v3 到 v4 保留旧感悟、截图、采集、设置和时间戳', async () => {
    const old = new Dexie(database.name);
    old.version(3).stores({ notes: 'id, url, status, createdAt, updatedAt, *tags', settings: 'id', analyses: 'id, noteId, createdAt', projects: 'id, updatedAt, *noteIds', screenshots: 'id, createdAt', contentCaptures: 'id, sourceUrl, platform, collectedAt, updatedAt, *screenshotIds' });
    const legacy = { id: 'legacy', title: '旧标题', url, body: '原有私人感悟（模拟数据）', tags: ['旧标签'], status: 'archived', createdAt: 123, updatedAt: 456 };
    await old.table('notes').put(legacy); await old.table('screenshots').put(image('old-shot')); await old.table('contentCaptures').put({ ...emptyPage(url, '旧采集', ''), id: 'old-capture', originalUrl: url, noteId: null, screenshotIds: ['old-shot'] }); await old.table('settings').put({ id: 'general', aiEnabled: true }); old.close();
    await database.open(); expect(database.verno).toBe(10); expect(await database.notes.get('legacy')).toMatchObject({ ...legacy, content: '', saveState: 'saved', favorite: false });
    expect(await (await database.screenshots.get('old-shot'))?.blob.text()).toBe('local-image'); expect(await database.contentCaptures.count()).toBe(1); expect((await getSettings(database)).aiEnabled).toBe(true);
  });
  it('AI 默认关闭，草稿、正式保存和 AI 门禁均不发送网络请求', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch'); expect((await getSettings(database)).aiEnabled).toBe(false);
    const id = await beginDraft('no-ai', {}, database); await patch(id, { title: '本地', content: '<script>用户原文</script>' }); await commitDraft(id, 'saved', undefined, database);
    await expect(requestAnalysis(database)).rejects.toThrow('已关闭'); expect(fetchSpy).not.toHaveBeenCalled();
  });
});
