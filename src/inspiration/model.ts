import { httpUrl, sourcePlatform, type Platform } from '../collection/model';
import type { Note, NoteStatus } from '../storage';

export interface NoteDetails {
  platform: Platform;
  author: string | null;
  publishedAt: string | null;
  content: string;
  screenshotIds: string[];
  captureIds: string[];
  researchQuestions: string;
  category: string;
  saveState: 'draft' | 'saved';
  favorite: boolean;
  revision: number;
  sourceTabId: number | null;
  sourcePageUrl: string;
}
export function noteDefaults(url = ''): NoteDetails {
  return { platform: sourcePlatform(url), author: null, publishedAt: null, content: '', screenshotIds: [], captureIds: [], researchQuestions: '', category: '', saveState: 'saved', favorite: false, revision: 0, sourceTabId: null, sourcePageUrl: httpUrl(url) ?? '' };
}
export interface NoteInput {
  title: string;
  url: string;
  platform: Platform;
  author: string | null;
  publishedAt: string | null;
  content: string;
  body: string;
  researchQuestions: string;
  category: string;
  tagsText: string;
  screenshotIds: string[];
  captureIds: string[];
  favorite: boolean;
  status: NoteStatus;
}
export interface NoteDraft {
  id: string;
  entryKey: string;
  input: NoteInput;
  baseRevision: number | null;
  sourceTabId: number | null;
  sourcePageUrl: string;
  pendingCaptureId: string | null;
  hasChanges: boolean;
  createdAt: number;
  updatedAt: number;
}
export function inputFromNote(note?: Note): NoteInput {
  const complete = { ...noteDefaults(note?.url), ...note };
  return structuredClone({ title: note?.title ?? '', url: note?.url ?? '', platform: complete.platform, author: complete.author, publishedAt: complete.publishedAt, content: complete.content, body: note?.body ?? '', researchQuestions: complete.researchQuestions, category: complete.category, tagsText: note?.tags?.join(', ') ?? '', screenshotIds: complete.screenshotIds, captureIds: complete.captureIds, favorite: complete.favorite, status: note?.status ?? 'inbox' });
}
export const inputKeys: (keyof NoteInput)[] = ['title', 'url', 'platform', 'author', 'publishedAt', 'content', 'body', 'researchQuestions', 'category', 'tagsText', 'screenshotIds', 'captureIds', 'favorite', 'status'];
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function mergeIds(current: string[], before: string[], desired: string[]) {
  const removed = new Set(before.filter(id => !desired.includes(id)));
  return [...new Set([...current.filter(id => !removed.has(id)), ...desired.filter(id => !before.includes(id))])];
}
