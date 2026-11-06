import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote, deleteNote, getSettings, IdeaClipDB, setAIEnabled, updateNote } from './storage';
import { requestAnalysis } from './ai';

let database: IdeaClipDB;
const input = { title: ' 测试灵感 ', url: 'https://example.com', body: ' 商业机会 ', tags: ['产品', '产品', ' '] };
beforeEach(() => { database = new IdeaClipDB(`test-${crypto.randomUUID()}`); });
afterEach(async () => { await database.delete(); vi.restoreAllMocks(); });

describe('本地灵感与隐私开关', () => {
  it('空库默认关闭 AI；读取默认值不会生成笔记', async () => {
    expect((await getSettings(database)).aiEnabled).toBe(false);
    expect(await database.notes.count()).toBe(0);
  });
  it('保存、规范化、更新、按标签查询和删除笔记', async () => {
    const id = await createNote(input, database);
    const saved = await database.notes.get(id);
    expect(saved).toMatchObject({ title: '测试灵感', body: '商业机会', tags: ['产品'], status: 'inbox' });
    expect(await database.notes.where('tags').equals('产品').count()).toBe(1);
    await updateNote(id, { ...input, title: '新标题', status: 'incubating' }, database);
    expect(await database.notes.get(id)).toMatchObject({ title: '新标题', status: 'incubating', createdAt: saved?.createdAt });
    await database.analyses.add({ id: 'analysis', noteId: id, createdAt: Date.now(), content: '仅为测试' });
    await deleteNote(id, database);
    expect(await database.notes.count()).toBe(0);
    expect(await database.analyses.count()).toBe(0);
  });
  it('重新打开数据库后笔记和开关仍保留', async () => {
    const id = await createNote(input, database);
    await setAIEnabled(true, database);
    database.close();
    await database.open();
    expect(await database.notes.get(id)).toBeDefined();
    expect((await getSettings(database)).aiEnabled).toBe(true);
    await setAIEnabled(false, database);
    expect((await getSettings(database)).aiEnabled).toBe(false);
  });
  it.each(['javascript:alert(1)', 'file:///secret', 'data:text/html,hi', 'invalid'])('拒绝非法链接 %s', async url => {
    await expect(createNote({ ...input, url }, database)).rejects.toThrow();
    expect(await database.notes.count()).toBe(0);
  });
  it('允许无来源的手动笔记，拒绝空标题和超长标题', async () => {
    await createNote({ ...input, url: '' }, database);
    await expect(createNote({ ...input, title: ' ' }, database)).rejects.toThrow();
    await expect(createNote({ ...input, title: '字'.repeat(201) }, database)).rejects.toThrow();
  });
  it('更新不存在的笔记会报错', async () => {
    await expect(updateNote('missing', { ...input, status: 'inbox' }, database)).rejects.toThrow('不存在');
  });
  it('AI 关闭与尚未确认本次分析时均不发起网络请求', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(requestAnalysis(database)).rejects.toThrow('已关闭');
    await setAIEnabled(true, database);
    await expect(requestAnalysis(database)).rejects.toThrow('确认本次');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
