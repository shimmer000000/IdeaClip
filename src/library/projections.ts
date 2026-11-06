import type { Transaction } from 'dexie';
import type { IdeaClipDB, Note } from '../storage';
import type { NoteDraft } from '../inspiration/model';

export interface NoteCard {
  id: string; title: string; url: string; site: string; platform: Note['platform']; author: string | null;
  category: string; tags: string[]; favorite: boolean; saveState: 'draft' | 'saved';
  createdAt: number; updatedAt: number; bodySummary: string; screenshotIds: string[];
}
export interface NoteSearch { id: string; title: string; content: string; body: string; tags: string; author: string }
export interface DraftCard { id: string; title: string; updatedAt: number; pending: 0 | 1 }
export interface LibraryState { id: 'notes'; revision: number }
export interface ScreenshotThumb { id: string; blob: Blob }
export const normalize = (text: string) => text.normalize('NFKC').toLowerCase();
export function siteOf(url: string) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }
export function cardOf(note: Note): NoteCard {
  return { id: note.id, title: note.title ?? '', url: note.url ?? '', site: siteOf(note.url), platform: note.platform ?? 'web', author: note.author ?? null, category: note.category ?? '', tags: note.tags ?? [], favorite: Boolean(note.favorite), saveState: note.saveState === 'draft' ? 'draft' : 'saved', createdAt: note.createdAt ?? 0, updatedAt: note.updatedAt ?? 0, bodySummary: (note.body ?? '').slice(0, 240), screenshotIds: note.screenshotIds ?? [] };
}
export function searchOf(note: Note): NoteSearch {
  return { id: note.id, title: normalize(note.title ?? ''), content: normalize(note.content ?? ''), body: normalize(note.body ?? ''), tags: normalize((note.tags ?? []).join('\n')), author: normalize(note.author ?? '') };
}
export function draftCardOf(draft: NoteDraft): DraftCard { return { id: draft.id, title: draft.input.title, updatedAt: draft.updatedAt, pending: draft.hasChanges ? 1 : 0 }; }
async function touch(database: IdeaClipDB) { const previous = await database.libraryState.get('notes'); await database.libraryState.put({ id: 'notes', revision: (previous?.revision ?? 0) + 1 }); }
export async function writeNoteIndex(note: Note, database: IdeaClipDB) { await database.noteCatalog.put(cardOf(note)); await database.noteSearch.put(searchOf(note)); await touch(database); }
export async function deleteNoteIndex(id: string, database: IdeaClipDB) { await database.noteCatalog.delete(id); await database.noteSearch.delete(id); await database.draftCatalog.delete(id); await touch(database); }
export async function addIndexedDraft(draft: NoteDraft, database: IdeaClipDB) { await database.noteDrafts.add(draft); await database.draftCatalog.put(draftCardOf(draft)); }
export async function updateIndexedDraft(id: string, changes: Partial<NoteDraft>, database: IdeaClipDB) {
  const old = await database.noteDrafts.get(id); if (!old) return 0;
  const count = await database.noteDrafts.update(id, changes); await database.draftCatalog.put(draftCardOf({ ...old, ...changes })); return count;
}
export async function migrateLibrary(tx: Transaction) {
  let last: string | undefined;
  for (;;) {
    const table = tx.table<Note>('notes');
    const rows: Note[] = await (last ? table.where('id').above(last) : table.toCollection()).limit(64).toArray();
    if (!rows.length) break;
    await tx.table('noteCatalog').bulkPut(rows.map(cardOf)); await tx.table('noteSearch').bulkPut(rows.map(searchOf));
    last = rows.at(-1)!.id;
  }
  last = undefined;
  for (;;) {
    const table = tx.table<NoteDraft>('noteDrafts');
    const rows: NoteDraft[] = await (last ? table.where('id').above(last) : table.toCollection()).limit(64).toArray();
    if (!rows.length) break;
    await tx.table('draftCatalog').bulkPut(rows.map(draftCardOf)); last = rows.at(-1)!.id;
  }
  await tx.table('libraryState').put({ id: 'notes', revision: 1 });
}
