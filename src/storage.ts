import Dexie, { type Table } from 'dexie';

export type NoteStatus = 'inbox' | 'incubating' | 'archived';
export interface Note {
  id: string;
  title: string;
  url: string;
  body: string;
  tags: string[];
  status: NoteStatus;
  createdAt: number;
  updatedAt: number;
}
export interface Settings { id: 'general'; aiEnabled: boolean }
export interface Analysis { id: string; noteId: string; createdAt: number; content: string }
export interface Project { id: string; title: string; noteIds: string[]; createdAt: number; updatedAt: number }
export interface Screenshot {
  id: string;
  blob: Blob;
  kind: 'visible' | 'region';
  width: number;
  height: number;
  originalBytes: number;
  sourceTabId: number;
  sourceUrl: string;
  sourceTitle: string;
  createdAt: number;
}

export class IdeaClipDB extends Dexie {
  notes!: Table<Note, string>;
  settings!: Table<Settings, string>;
  analyses!: Table<Analysis, string>;
  projects!: Table<Project, string>;
  screenshots!: Table<Screenshot, string>;
  constructor(name = 'ideaclip') {
    super(name);
    this.version(1).stores({
      notes: 'id, url, status, createdAt, updatedAt, *tags',
      settings: 'id',
      analyses: 'id, noteId, createdAt',
      projects: 'id, updatedAt, *noteIds',
    });
    // Add a store without changing or clearing v1 notes/settings.
    this.version(2).stores({ screenshots: 'id, createdAt' });
  }
}
export const db = new IdeaClipDB();

export async function saveScreenshot(screenshot: Screenshot, database = db) {
  if (!(screenshot.blob instanceof Blob) || screenshot.blob.size === 0) throw new Error('截图内容为空，未保存。');
  try { await database.screenshots.add(screenshot); }
  catch { throw new Error('截图保存失败，可能是本地空间不足或数据库不可用。请释放空间后重新截图；已有笔记不会被删除。'); }
}

export async function getSettings(database = db): Promise<Settings> {
  return (await database.settings.get('general')) ?? { id: 'general', aiEnabled: false };
}
export async function setAIEnabled(aiEnabled: boolean, database = db) {
  await database.settings.put({ id: 'general', aiEnabled });
}

type NoteInput = Pick<Note, 'title' | 'url' | 'body' | 'tags'>;
function cleanInput(input: NoteInput): NoteInput {
  const title = input.title.trim();
  if (!title) throw new Error('请填写灵感标题。');
  if (title.length > 200) throw new Error('标题不能超过 200 字。');
  const url = input.url.trim();
  if (url && !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('仅支持 HTTP 或 HTTPS 链接。');
  return { title, url, body: input.body.trim(), tags: [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))] };
}
export async function createNote(input: NoteInput, database = db): Promise<string> {
  const clean = cleanInput(input);
  const now = Date.now();
  const note: Note = { ...clean, id: crypto.randomUUID(), status: 'inbox', createdAt: now, updatedAt: now };
  await database.notes.add(note);
  return note.id;
}
export async function updateNote(id: string, input: NoteInput & { status: NoteStatus }, database = db) {
  const clean = cleanInput(input);
  if (!['inbox', 'incubating', 'archived'].includes(input.status)) throw new Error('无效的灵感状态。');
  const count = await database.notes.update(id, { ...clean, status: input.status, updatedAt: Date.now() });
  if (!count) throw new Error('这条灵感已不存在，请刷新列表。');
}
export async function deleteNote(id: string, database = db) {
  await database.transaction('rw', database.notes, database.analyses, async () => {
    await database.analyses.where('noteId').equals(id).delete();
    await database.notes.delete(id);
  });
}
