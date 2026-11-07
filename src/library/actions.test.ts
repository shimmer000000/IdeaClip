import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote, IdeaClipDB, updateNote } from '../storage';
import { beginDraft, commitDraft, editNote, patchDraft } from '../inspiration/repository';
import { executeBatch } from './actions';
import { CatalogQuery, initialFilter } from './query';

let database: IdeaClipDB;
beforeEach(() => { database = new IdeaClipDB(`batch-${crypto.randomUUID()}`); });
afterEach(async () => { vi.restoreAllMocks(); await database.delete(); });
async function note(title: string) { return createNote({ title, url: '', body: '感悟', tags: ['原标签'] }, database); }
describe('批量管理事务', () => {
  it('分类、添加/移除完整标签、收藏更新源记录、索引和干净编辑快照', async () => {
    const a = await note('A'); const b = await note('B'); await editNote(a, database);
    await updateNote(a, { title: 'A 更新', url: '', body: '最新感悟', tags: ['原标签'], status: 'inbox' }, database);
    for (const operation of [{ type: 'category', value: '研究' }, { type: 'addTags', value: '新增,新增,原标签' }, { type: 'removeTags', value: '原标签' }, { type: 'favorite', value: true }] as const) expect((await executeBatch([a, b], operation, database)).failed).toEqual([]);
    expect(await database.notes.get(a)).toMatchObject({ category: '研究', tags: ['新增'], favorite: true });
    expect(await database.noteCatalog.get(a)).toMatchObject({ category: '研究', tags: ['新增'], favorite: true });
    expect((await database.noteDrafts.get(a))?.input).toMatchObject({ category: '研究', tagsText: '新增', favorite: true });
    await commitDraft(a, 'saved', undefined, database); expect((await database.notes.get(a))?.category).toBe('研究');
    expect((await database.notes.get(a))?.body).toBe('最新感悟');
  });
  it('未提交编辑与缺失记录分别报告失败，其他笔记成功', async () => {
    const a = await note('可修改'); const b = await note('编辑中'); await editNote(b, database); await patchDraft(b, { body: '未提交感悟' }, (await database.noteDrafts.get(b))!.input, database);
    const result = await executeBatch([a, b, 'missing', a], { type: 'favorite', value: true }, database);
    expect(result.succeeded).toEqual([a]); expect(result.failed).toHaveLength(2);
    expect((await database.noteDrafts.get(b))?.input.body).toBe('未提交感悟'); expect((await database.notes.get(b))?.favorite).toBe(false);
  });
  it('单条索引写入失败时源记录回滚，其他条目继续并报告部分成功', async () => {
    const a = await note('失败'); const b = await note('成功');
    vi.spyOn(database.noteCatalog, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    const result = await executeBatch([a, b], { type: 'category', value: '新分类' }, database);
    expect(result.succeeded).toEqual([b]); expect(result.failed[0].id).toBe(a);
    expect((await database.notes.get(a))?.category).toBe(''); expect((await database.notes.get(b))?.category).toBe('新分类');
  });
  it('删除必须确认，删除后保留图片与采集并清除索引及回链', async () => {
    const id = await note('删除'); await editNote(id, database);
    await database.screenshots.add({ id: 'image', blob: new Blob(['original']) } as never);
    await database.contentCaptures.add({ id: 'capture', noteId: id } as never);
    await expect(executeBatch([id], { type: 'delete' }, database)).rejects.toThrow('再次确认');
    expect((await executeBatch([id], { type: 'delete' }, database, { confirmed: true })).succeeded).toEqual([id]);
    expect(await database.notes.get(id)).toBeUndefined(); expect(await database.noteCatalog.get(id)).toBeUndefined(); expect(await database.noteSearch.get(id)).toBeUndefined(); expect(await database.draftCatalog.get(id)).toBeUndefined();
    expect(await database.screenshots.count()).toBe(1); expect((await database.contentCaptures.get('capture'))?.noteId).toBeNull();
  });
  it('v4 升级 v5 构建检索目录而不改写旧记录与 Blob', async () => {
    const legacy = new Dexie(database.name);
    legacy.version(4).stores({ notes: 'id, url, status, createdAt, updatedAt, saveState, *tags, *screenshotIds, *captureIds', noteDrafts: 'id, &entryKey, sourcePageUrl, updatedAt, *input.screenshotIds', contentCaptures: 'id, sourceUrl, platform, collectedAt, updatedAt, noteId, *screenshotIds', screenshots: 'id, createdAt', settings: 'id', analyses: 'id, noteId, createdAt', projects: 'id, updatedAt, *noteIds' });
    const old = { id: 'legacy', title: '旧标题', body: '旧感悟', content: '旧正文', url: 'https://example.com', createdAt: 1, updatedAt: 2, tags: ['旧标签'], saveState: 'saved' };
    await legacy.table('notes').add(old); await legacy.table('screenshots').add({ id: 'image', blob: new Blob(['original']) }); await legacy.table('noteDrafts').add({ id: 'pending', entryKey: 'manual:a', input: { title: '未提交标题' }, hasChanges: true, updatedAt: 3 }); legacy.close();
    await database.open(); expect(database.verno).toBe(13); expect(await database.notes.get('legacy')).toEqual(old);
    expect((await new CatalogQuery().run({ ...initialFilter, query: '旧正文' }, database)).rows[0].id).toBe('legacy');
    expect(await database.draftCatalog.get('pending')).toMatchObject({ title: '未提交标题', pending: 1 }); expect(await (await database.screenshots.get('image'))?.blob.text()).toBe('original');
  });
  it('未提交编辑目录只记录轻量信息，显式保存后更新目录状态', async () => {
    const id = await beginDraft('draft', {}, database); await patchDraft(id, { title: '标题', content: '正文' }, (await database.noteDrafts.get(id))!.input, database);
    expect(await database.draftCatalog.get(id)).toMatchObject({ title: '标题', pending: 1 });
    await commitDraft(id, 'draft', undefined, database); expect((await database.draftCatalog.get(id))?.pending).toBe(0); expect((await database.noteCatalog.get(id))?.saveState).toBe('draft');
  });
});
