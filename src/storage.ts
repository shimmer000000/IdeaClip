import type { Details as ProjectDetails } from './incubation/model';
import type { Skill } from './skills/model';
import type { SkillPreferences } from './skills/repository';
import Dexie, { type Table } from 'dexie';
import type { ContentCapture } from './collection/model';
import { noteDefaults, type NoteDetails, type NoteDraft } from './inspiration/model';
import { deleteNoteIndex, migrateLibrary, writeNoteIndex, type NoteCard, type NoteSearch, type DraftCard, type LibraryState, type ScreenshotThumb } from './library/projections';
import type { AIConfig } from './ai/config';
import type { Report } from './ai/report';
import type { AIUsage } from './ai/engine';
import type {AIDiagnostic} from './ai/diagnostics';
import { announceAIChange } from './ai/events';
import { enqueueSavedNote, pauseAutomatic } from './automation/policy';
import { wakeQueue } from './automation/signals';
import type { AutoPolicy, AITask } from './automation/model';

export type NoteStatus = 'inbox' | 'incubating' | 'archived';
export interface Note extends NoteDetails {
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
export interface Analysis { research?: import("./research/online/model").ResearchResult; projectId?: string; comparison?: import("./comparison/model").ComparisonReport; sources?: import("./comparison/model").Source[]; id: string; noteId: string; createdAt: number; content: string; report?: Report; skillReport?: import('./skills/model').SkillReport; template?: Skill; sourceUrl?: string; model?: string; provider?: string; endpointOrigin?: string; inputDigest?: string; inputRevision?: number; imageCount?: number }
export interface Project extends Partial<ProjectDetails> { id: string; title: string; noteIds: string[]; createdAt: number; updatedAt: number }
export interface Screenshot {
  id: string;
  blob: Blob;
  kind: 'visible' | 'region' | 'full';
  width: number;
  height: number;
  originalBytes: number;
  sourceTabId: number;
  sourceUrl: string;
  sourceTitle: string;
  createdAt: number;
}

export class IdeaClipDB extends Dexie {
  researchWorkflows!: Table<import('./research/workflow/model').Workflow, string>;
  researchConfig!: Table<import('./research/online/model').ResearchConfig, string>;
  researchUsage!: Table<import('./research/online/model').ResearchUsage, string>;
  researchRuns!: Table<import('./research/online/model').ResearchRun, string>;
  researchSources!: Table<import('./research/online/model').ResearchSource, string>;
  researchReports!: Table<import('./research/online/model').ResearchResult, string>;
  researchPlans!: Table<import('./research/model').ResearchPlan, string>;
  notes!: Table<Note, string>;
  settings!: Table<Settings, string>;
  analyses!: Table<Analysis, string>;
  projects!: Table<Project, string>;
  screenshots!: Table<Screenshot, string>;
  contentCaptures!: Table<ContentCapture, string>;
  noteDrafts!: Table<NoteDraft, string>;
  noteCatalog!: Table<NoteCard, string>;
  noteSearch!: Table<NoteSearch, string>;
  draftCatalog!: Table<DraftCard, string>;
  libraryState!: Table<LibraryState, string>;
  screenshotThumbs!: Table<ScreenshotThumb, string>;
  aiConfig!: Table<AIConfig, string>;
  aiUsage!: Table<AIUsage, string>;
  aiDiagnostics!:Table<AIDiagnostic,string>;
  autoPolicy!: Table<AutoPolicy, string>;
  aiTasks!: Table<AITask, string>;
  comparisonReports!: Table<Analysis, string>;
  aiTemplates!: Table<Skill, string>;
  skillPreferences!: Table<SkillPreferences, string>;
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
    this.version(3).stores({ contentCaptures: 'id, sourceUrl, platform, collectedAt, updatedAt, *screenshotIds' });
    this.version(4).stores({
      notes: 'id, url, status, createdAt, updatedAt, saveState, *tags, *screenshotIds, *captureIds',
      noteDrafts: 'id, &entryKey, sourcePageUrl, updatedAt, *input.screenshotIds',
      contentCaptures: 'id, sourceUrl, platform, collectedAt, updatedAt, noteId, *screenshotIds',
    }).upgrade(async tx => {
      await tx.table('notes').toCollection().modify(note => {
        Object.assign(note, { ...noteDefaults(note.url ?? ''), ...note });
      });
    });
    this.version(5).stores({ noteCatalog: 'id, saveState, site, category, createdAt, updatedAt', noteSearch: 'id', draftCatalog: 'id, [pending+updatedAt]', libraryState: 'id', screenshotThumbs: 'id' }).upgrade(migrateLibrary);
    this.version(6).stores({ aiConfig: 'id', aiUsage: 'id, day, createdAt, noteId, status', analyses: 'id, noteId, createdAt, [noteId+createdAt]' });
    this.version(7).stores({ autoPolicy: 'id', aiTasks: 'id, &dedupeKey, state, createdAt, [state+createdAt], noteId, attemptId' });
    // Optional capture quality/provenance fields. Old records remain untouched and unverified.
    this.version(8).stores({});
    this.version(9).stores({ aiTemplates: 'id, updatedAt', skillPreferences: 'id' });
    this.version(10).stores({ comparisonReports: 'id, createdAt' });
    this.version(11).stores({});
    this.version(12).stores({ researchPlans: 'id, updatedAt, createdAt' });
    this.version(13).stores({ researchConfig:'id',researchUsage:'id, day, runId',researchRuns:'id, studyId, state, createdAt, [studyId+createdAt]',researchSources:'id, studyId, runId, collectedAt, [studyId+collectedAt]',researchReports:'id, studyId, createdAt, [studyId+createdAt]' });
    this.version(14).stores({researchWorkflows:'id, studyId, updatedAt'});
    this.version(15).stores({aiDiagnostics:'id, createdAt, noteId, attemptId'});
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
  announceAIChange();
  if (!aiEnabled) await pauseAutomatic('AI 总开关已关闭，等待任务已暂停。', database);
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
  const note: Note = { ...noteDefaults(clean.url), ...clean, id: crypto.randomUUID(), status: 'inbox', revision: 1, createdAt: now, updatedAt: now };
  let taskId: string | null = null;
  await database.transaction('rw', [database.notes, database.noteCatalog, database.noteSearch, database.libraryState, database.autoPolicy, database.aiTasks, database.aiConfig, database.settings, database.contentCaptures, database.aiTemplates, database.skillPreferences], async () => { await database.notes.add(note); await writeNoteIndex(note, database); taskId = await enqueueSavedNote(note, database); });
  if (taskId) wakeQueue();
  return note.id;
}
export async function updateNote(id: string, input: NoteInput & { status: NoteStatus }, database = db) {
  const clean = cleanInput(input);
  if (!['inbox', 'incubating', 'archived'].includes(input.status)) throw new Error('无效的灵感状态。');
  let taskId: string | null = null;
  await database.transaction('rw', [database.notes, database.noteCatalog, database.noteSearch, database.libraryState, database.autoPolicy, database.aiTasks, database.aiConfig, database.settings, database.contentCaptures, database.aiTemplates, database.skillPreferences], async () => {
    const previous = await database.notes.get(id);
    if (!previous) throw new Error('这条灵感已不存在，请刷新列表。');
    await database.notes.update(id, { ...clean, status: input.status, revision: (previous.revision ?? 0) + 1, updatedAt: Date.now() });
    await writeNoteIndex((await database.notes.get(id))!, database);
    taskId = await enqueueSavedNote((await database.notes.get(id))!, database);
  });
  if (taskId) wakeQueue();
}
export async function deleteNote(id: string, database = db) {
  await database.transaction('rw', [database.notes, database.analyses, database.contentCaptures, database.noteDrafts, database.noteCatalog, database.noteSearch, database.draftCatalog, database.libraryState], async () => {
    await database.analyses.where('noteId').equals(id).delete();
    await database.notes.delete(id);
    await database.contentCaptures.where('noteId').equals(id).modify({ noteId: null });
    await database.noteDrafts.delete(id);
    await deleteNoteIndex(id, database);
  });
}
