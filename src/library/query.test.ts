import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote, IdeaClipDB } from '../storage';
import { beginDraft, commitDraft, patchDraft } from '../inspiration/repository';
import { CatalogQuery, dayBoundary, initialFilter, PAGE_SIZE, QueryCancelled } from './query';

let database: IdeaClipDB; let engine: CatalogQuery;
beforeEach(() => { database = new IdeaClipDB(`query-${crypto.randomUUID()}`); engine = new CatalogQuery(); });
afterEach(async () => { vi.restoreAllMocks(); await database.delete(); });
async function seed() {
  const id = await beginDraft('a', {}, database); const original = (await database.noteDrafts.get(id))!.input;
  await patchDraft(id, { title: '产品发现', content: '正文专属关键词', body: '访谈感悟', tagsText: '研究, 设计', author: '作者甲', url: 'https://example.com/a', category: '产品', favorite: true }, original, database); await commitDraft(id, 'saved', undefined, database);
  const other = await createNote({ title: '其他笔记', url: 'https://github.com/example/repo', body: '其他想法', tags: ['代码'] }, database);
  const draft = await beginDraft('draft', {}, database); await patchDraft(draft, { title: '未完成内容' }, (await database.noteDrafts.get(draft))!.input, database); await commitDraft(draft, 'draft', undefined, database);
  return { id, other, draft };
}
describe('管理中心本地检索', () => {
  it.each([['title', '产品发现'], ['content', '正文专属'], ['body', '访谈'], ['tags', '设计'], ['author', '作者甲'], ['all', '产品 访谈']])('搜索范围 %s', async (scope, query) => {
    const { id } = await seed(); const result = await engine.run({ ...initialFilter, scope: scope as typeof initialFilter.scope, query }, database);
    expect(result.rows.map(row => row.id)).toEqual([id]);
  });
  it('组合来源、分类、收藏、时间筛选，草稿与已保存分开', async () => {
    const { id, draft } = await seed();
    const result = await engine.run({ ...initialFilter, site: 'example.com', category: '产品', favorite: 'yes', from: 0, to: Date.now() + 1000 }, database);
    expect(result.rows.map(row => row.id)).toEqual([id]); expect(result.saved).toBe(2); expect(result.drafts).toBe(1);
    expect((await engine.run({ ...initialFilter, state: 'draft' }, database)).rows.map(row => row.id)).toEqual([draft]);
    expect((await engine.run({ ...initialFilter, from: Date.now() + 10_000 }, database)).total).toBe(0);
  });
  it('索引变化后刷新缓存，不读取原图或所有正文', async () => {
    await seed(); await engine.run(initialFilter, database);
    const blobs = vi.spyOn(database.screenshots, 'get'); const notes = vi.spyOn(database.notes, 'get');
    expect((await engine.run({ ...initialFilter, query: '正文专属', scope: 'content' }, database)).total).toBe(1);
    expect(blobs).not.toHaveBeenCalled(); expect(notes).not.toHaveBeenCalled();
    await createNote({ title: '新增笔记', url: '', body: '', tags: [] }, database);
    expect((await engine.run(initialFilter, database)).total).toBe(3);
  });
  it('分页最多 24 条，最新、最早和最近修改顺序稳定', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 30; index++) {
      const id = await createNote({ title: `note-${index}`, url: '', body: '', tags: [] }, database); ids.push(id);
      // Set deterministic sort data in both source and projection for this fixture.
      await database.notes.update(id, { createdAt: index + 1, updatedAt: 100 - index });
      await database.noteCatalog.update(id, { createdAt: index + 1, updatedAt: 100 - index });
    }
    expect((await engine.run(initialFilter, database)).rows).toHaveLength(PAGE_SIZE);
    expect((await engine.run(initialFilter, database)).rows[0].id).toBe(ids[29]);
    expect((await engine.run({ ...initialFilter, sort: 'oldest' }, database)).rows[0].id).toBe(ids[0]);
    expect((await engine.run({ ...initialFilter, sort: 'modified', page: 1 }, database)).rows).toHaveLength(6);
  });
  it('取消过期搜索，日期范围按本地自然日包含结束日', async () => {
    await seed(); await expect(engine.run(initialFilter, database, () => true)).rejects.toBeInstanceOf(QueryCancelled);
    expect(dayBoundary('2026-11-06')).toBe(new Date(2026, 10, 6).getTime());
    expect(dayBoundary('2026-11-06', true)).toBe(new Date(2026, 10, 7).getTime() - 1);
    expect(() => dayBoundary('2026-02-31')).toThrow();
  });
});
