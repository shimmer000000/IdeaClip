import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeaClipDB, type Screenshot } from '../storage';
import { emptyPage } from './model';
import { saveCaptureEdits, storeExtraction } from './storage';

let database: IdeaClipDB;
beforeEach(() => { database = new IdeaClipDB(`collection-${crypto.randomUUID()}`); });
afterEach(async () => { vi.restoreAllMocks(); await database.delete(); });
describe('采集草稿与截图关联', () => {
  it('v2 升级保留笔记、截图 Blob 与设置，并新增采集表', async () => {
    const legacy = new Dexie(database.name);
    legacy.version(2).stores({ notes: 'id, url, status, createdAt, updatedAt, *tags', settings: 'id', analyses: 'id, noteId, createdAt', projects: 'id, updatedAt, *noteIds', screenshots: 'id, createdAt' });
    await legacy.table('notes').put({ id: 'old', title: '旧笔记' });
    await legacy.table('screenshots').put({ id: 'image', blob: new Blob(['old-image']), createdAt: 1 });
    await legacy.table('settings').put({ id: 'general', aiEnabled: false }); legacy.close();
    await database.open(); expect(database.verno).toBe(13);
    expect((await database.notes.get('old'))?.title).toBe('旧笔记');
    expect(await (await database.screenshots.get('image'))?.blob.text()).toBe('old-image');
    expect((await database.settings.get('general'))?.aiEnabled).toBe(false);
  });
  it('手动补正文、保留原始 URL 和完整性提示，截图引用保存后可重开', async () => {
    const page = emptyPage('https://x.com/fixture/status/123', '无法自动读取', '需登录或 DOM 变化');
    const id = await storeExtraction(page, 10, database);
    await database.screenshots.add({ id: 'image', blob: new Blob(['image']), createdAt: 1 } as Screenshot);
    const edits = { ...page, title: '手动标题', sourceUrl: 'https://x.com/fixture/status/123?s=1', text: '<script>alert(1)</script> 手动补充', screenshotIds: ['image', 'image'] };
    await saveCaptureEdits(id, edits, database);
    database.close(); await database.open();
    const saved = await database.contentCaptures.get(id);
    expect(saved).toMatchObject({ originalUrl: page.sourceUrl, textOrigin: 'manual', status: 'unavailable', text: edits.text, screenshotIds: ['image'], noteId: null });
    expect(saved?.warnings).toContain('需登录或 DOM 变化');
    expect(await database.screenshots.count()).toBe(1); expect(await database.notes.count()).toBe(0);
  });
  it('拒绝危险链接和不存在的截图，原草稿不被覆盖', async () => {
    const page = emptyPage('https://example.com', '标题', ''); const id = await storeExtraction(page, null, database);
    await expect(saveCaptureEdits(id, { ...page, links: [{ url: 'javascript:alert(1)', text: '' }], screenshotIds: [] }, database)).rejects.toThrow('仅允许');
    await expect(saveCaptureEdits(id, { ...page, screenshotIds: ['missing'] }, database)).rejects.toThrow('不存在');
    expect((await database.contentCaptures.get(id))?.text).toBe('');
  });
  it('数据库写入失败时明确报错', async () => {
    vi.spyOn(database.contentCaptures, 'add').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
    await expect(storeExtraction(emptyPage('https://example.com', '', ''), 1, database)).rejects.toThrow('保存失败');
  });
});
