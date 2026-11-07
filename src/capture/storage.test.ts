import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdeaClipDB, saveScreenshot, type Screenshot } from '../storage';

const databases: Dexie[] = [];
afterEach(async () => { for (const database of databases.splice(0)) await database.delete(); vi.restoreAllMocks(); });
function screenshot(): Screenshot { return { id: crypto.randomUUID(), blob: new Blob(['test-image'], { type: 'image/webp' }), kind: 'visible', width: 100, height: 70, originalBytes: 200, sourceTabId: 1, sourceTitle: '测试页面', sourceUrl: 'https://example.com', createdAt: Date.now() }; }
describe('截图存储与升级兼容', () => {
  it('v1 数据库升级后旧笔记和 AI 偏好仍保留', async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({ notes: 'id, url, status, createdAt, updatedAt, *tags', settings: 'id', analyses: 'id, noteId, createdAt', projects: 'id, updatedAt, *noteIds' });
    const note = { id: 'old-note', title: '旧灵感不能丢失', url: '', body: '私人内容', tags: ['旧标签'], status: 'inbox', createdAt: 10, updatedAt: 20 };
    await old.table('notes').add(note); await old.table('settings').put({ id: 'general', aiEnabled: false }); old.close();
    const database = new IdeaClipDB(name); databases.push(database);
    await database.open();
    expect(database.verno).toBe(11);
    expect(await database.notes.get('old-note')).toMatchObject(note);
    expect((await database.settings.get('general'))?.aiEnabled).toBe(false);
    await saveScreenshot(screenshot(), database);
    expect(await database.screenshots.count()).toBe(1);
  });
  it('Blob 重新打开后可读取，重截使用不同 ID 保留原图', async () => {
    const database = new IdeaClipDB(`blob-${crypto.randomUUID()}`); databases.push(database);
    const first = screenshot(); await saveScreenshot(first, database); await saveScreenshot(screenshot(), database);
    database.close(); await database.open();
    expect(await database.screenshots.count()).toBe(2);
    expect(await (await database.screenshots.get(first.id))?.blob.text()).toBe('test-image');
  });
  it('空截图与空间不足均有明确错误，不删除笔记', async () => {
    const database = new IdeaClipDB(`failure-${crypto.randomUUID()}`); databases.push(database);
    await expect(saveScreenshot({ ...screenshot(), blob: new Blob() }, database)).rejects.toThrow('为空');
    vi.spyOn(database.screenshots, 'add').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
    await expect(saveScreenshot(screenshot(), database)).rejects.toThrow('保存失败');
  });
});
