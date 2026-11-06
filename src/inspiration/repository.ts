import { addIndexedDraft, updateIndexedDraft, writeNoteIndex } from '../library/projections';
import { db, type Note, type Screenshot } from '../storage';
import { httpUrl, MAX_TEXT, sourcePlatform } from '../collection/model';
import { equal, inputFromNote, inputKeys, mergeIds, noteDefaults, type NoteDraft, type NoteInput } from './model';

export async function beginDraft(entryKey: string, options: { sourceTabId?: number | null; sourcePageUrl?: string; title?: string } = {}, database = db) {
  return database.transaction('rw', [database.noteDrafts, database.draftCatalog], async () => {
    const previous = await database.noteDrafts.where('entryKey').equals(entryKey).first();
    if (previous) return previous.id;
    const now = Date.now(); const input = inputFromNote();
    input.title = options.title ?? ''; input.url = options.sourcePageUrl ?? ''; input.platform = sourcePlatform(input.url);
    const draft: NoteDraft = { id: crypto.randomUUID(), entryKey, input, baseRevision: null, sourceTabId: options.sourceTabId ?? null, sourcePageUrl: input.url, pendingCaptureId: null, hasChanges: true, createdAt: now, updatedAt: now };
    await addIndexedDraft(draft, database); return draft.id;
  });
}
export async function editNote(id: string, database = db) {
  return database.transaction('rw', [database.notes, database.noteCatalog, database.noteSearch, database.libraryState, database.noteDrafts, database.draftCatalog], async () => {
    const draft = await database.noteDrafts.get(id); if (draft) return id;
    const note = await database.notes.get(id); if (!note) throw new Error('笔记已不存在，请刷新列表。');
    await addIndexedDraft({ id, entryKey: `note:${id}`, input: inputFromNote(note), baseRevision: note.revision ?? 0, sourceTabId: note.sourceTabId ?? null, sourcePageUrl: note.sourcePageUrl || note.url, pendingCaptureId: null, hasChanges: false, createdAt: note.createdAt, updatedAt: Date.now() }, database);
    return id;
  });
}
export async function reloadSavedNote(id: string, database = db) {
  await database.transaction('rw', [database.notes, database.noteCatalog, database.noteSearch, database.libraryState, database.noteDrafts, database.draftCatalog], async () => {
    const note = await database.notes.get(id);
    if (!note) throw new Error('尚无已保存版本，当前编辑不能重置。');
    const draft = await database.noteDrafts.get(id); if (!draft) throw new Error('草稿已删除。');
    await updateIndexedDraft(id, { input: inputFromNote(note), baseRevision: note.revision, pendingCaptureId: null, hasChanges: false, updatedAt: Date.now() }, database);
  });
}
export async function draftFromCapture(captureId: string, database = db) {
  const capture = await database.contentCaptures.get(captureId);
  if (!capture) throw new Error('采集记录不存在。');
  if (capture.noteId && await database.notes.get(capture.noteId)) return editNote(capture.noteId, database);
  const id = await beginDraft(`capture:${captureId}`, { sourceTabId: capture.sourceTabId, sourcePageUrl: capture.originalUrl || capture.sourceUrl }, database);
  const draft = await database.noteDrafts.get(id);
  if (draft && !draft.input.captureIds.includes(captureId)) await adoptCapture(id, captureId, database);
  return id;
}
export async function draftFromScreenshot(screenshotId: string, database = db) {
  const screenshot = await database.screenshots.get(screenshotId); if (!screenshot) throw new Error('截图不存在。');
  const id = await beginDraft(`screenshot:${screenshotId}`, { sourceTabId: screenshot.sourceTabId, sourcePageUrl: screenshot.sourceUrl, title: screenshot.sourceTitle }, database);
  await database.transaction('rw', [database.noteDrafts, database.draftCatalog], async () => {
    const draft = await database.noteDrafts.get(id); if (!draft) throw new Error('草稿不存在。');
    await updateIndexedDraft(id, { input: { ...draft.input, screenshotIds: [...new Set([...draft.input.screenshotIds, screenshotId])] }, hasChanges: true, updatedAt: Date.now() }, database);
  });
  return id;
}

export async function patchDraft(id: string, patch: Partial<NoteInput>, before: Partial<NoteInput>, database = db) {
  return database.transaction('rw', [database.noteDrafts, database.draftCatalog], async () => {
    const draft = await database.noteDrafts.get(id); if (!draft) throw new Error('草稿已删除，当前输入尚未保存，请复制保留后重新创建。');
    const input = structuredClone(draft.input);
    for (const key of Object.keys(patch) as (keyof NoteInput)[]) {
      if (!inputKeys.includes(key)) throw new Error('无效的编辑字段。');
      if (key === 'screenshotIds') input.screenshotIds = mergeIds(input.screenshotIds, before.screenshotIds ?? [], patch.screenshotIds ?? []);
      else {
        if (!equal(input[key], before[key]) && !equal(input[key], patch[key])) throw new Error('同一字段已在其他窗口更新。当前输入仍保留，请复制后刷新核对，避免覆盖其他修改。');
        (input as unknown as Record<string, unknown>)[key] = structuredClone(patch[key]);
      }
    }
    await updateIndexedDraft(id, { input, hasChanges: true, updatedAt: Date.now() }, database);
    return input;
  });
}
export async function adoptCapture(id: string, captureId: string, database = db) {
  await database.transaction('rw', [database.noteDrafts, database.draftCatalog, database.contentCaptures, database.screenshots, database.notes], async () => {
    const draft = await database.noteDrafts.get(id); const capture = await database.contentCaptures.get(captureId);
    if (!draft || !capture) throw new Error('草稿或采集记录不存在。');
    if (capture.noteId && capture.noteId !== id && await database.notes.get(capture.noteId)) throw new Error('这份采集已关联另一条笔记。请在采集预览中点击“整理为灵感”编辑原笔记，或手动复制正文。');
    const input = { ...draft.input, title: draft.input.title || capture.title, url: capture.sourceUrl || draft.input.url, platform: capture.platform, author: capture.author, publishedAt: capture.publishedAt, content: capture.text, screenshotIds: [...new Set([...draft.input.screenshotIds, ...capture.screenshotIds])], captureIds: [...new Set([...draft.input.captureIds, captureId])] };
    for (const screenshotId of input.screenshotIds) if (!await database.screenshots.get(screenshotId)) throw new Error('采集关联的截图已不存在，请先取消该截图关联。');
    const sourcePageUrl = capture.originalUrl || capture.sourceUrl || draft.sourcePageUrl;
    const entryKey = draft.entryKey.startsWith('source:') && sourcePageUrl !== draft.sourcePageUrl ? `note:${id}` : draft.entryKey;
    await updateIndexedDraft(id, { input, entryKey, sourceTabId: capture.sourceTabId, sourcePageUrl, pendingCaptureId: null, hasChanges: true, updatedAt: Date.now() }, database);
  });
}
export async function stageCapture(id: string, captureId: string, database = db) {
  await database.transaction('rw', [database.noteDrafts, database.draftCatalog, database.contentCaptures], async () => {
    if (!await database.noteDrafts.get(id) || !await database.contentCaptures.get(captureId)) throw new Error('草稿或采集记录不存在。');
    await updateIndexedDraft(id, { pendingCaptureId: captureId, hasChanges: true, updatedAt: Date.now() }, database);
  });
}
export async function storeDraftScreenshot(id: string, screenshot: Screenshot, database = db) {
  if (!screenshot.blob.size) throw new Error('截图为空，未保存。');
  await database.transaction('rw', [database.noteDrafts, database.draftCatalog, database.screenshots], async () => {
    const draft = await database.noteDrafts.get(id);
    if (!draft || draft.sourceTabId !== screenshot.sourceTabId || draft.sourcePageUrl !== screenshot.sourceUrl) throw new Error('截图来源与草稿不匹配，请重新连接原网页。');
    await database.screenshots.add(screenshot);
    await updateIndexedDraft(id, { input: { ...draft.input, screenshotIds: [...new Set([...draft.input.screenshotIds, screenshot.id])] }, hasChanges: true, updatedAt: Date.now() }, database);
  }).catch(error => {
    if (error instanceof Error && /Quota|Abort|Unknown|Database|ReadOnly/.test(error.name)) throw new Error('截图本地保存失败，可能空间不足或数据库不可用。原笔记与草稿不会被删除，请重试。');
    throw error;
  });
}
export async function commitDraft(id: string, saveState: 'draft' | 'saved', expectedInput?: NoteInput, database = db) {
  return database.transaction('rw', [database.notes, database.noteCatalog, database.noteSearch, database.libraryState, database.noteDrafts, database.draftCatalog, database.screenshots, database.contentCaptures], async () => {
    const draft = await database.noteDrafts.get(id); if (!draft) throw new Error('草稿不存在或已删除，不能保存。');
    if (expectedInput && !equal(draft.input, expectedInput)) throw new Error('内容刚刚更新，请核对当前预览后再次保存。');
    if (draft.pendingCaptureId) throw new Error('还有待确认的正文采集，请先采用或忽略本次采集。');
    const input = draft.input; const previous = await database.notes.get(id);
    if (draft.baseRevision !== null && (!previous || previous.revision !== draft.baseRevision)) throw new Error('笔记已在其他窗口修改或删除，未覆盖旧记录。当前草稿仍保留，请刷新核对。');
    if (draft.baseRevision === null && previous) throw new Error('笔记 ID 冲突，请重新打开编辑页。');
    if (saveState === 'saved' && !input.title.trim()) throw new Error('请填写灵感标题后保存。');
    if (input.title.length > 1000 || [input.content, input.body, input.researchQuestions].some(text => text.length > MAX_TEXT)) throw new Error('标题最多 1000 字符，正文、感悟和问题各最多 100000 字符。');
    if (input.url.trim() && !httpUrl(input.url)) throw new Error('原始网址仅支持 HTTP / HTTPS。未完成的网址仍保留在未提交草稿中。');
    if (!['x', 'github', 'wechat', 'article', 'web'].includes(input.platform) || !['inbox', 'incubating', 'archived'].includes(input.status)) throw new Error('来源平台或整理状态无效。');
    const screenshotIds = [...new Set(input.screenshotIds)]; const captureIds = [...new Set(input.captureIds)];
    for (const imageId of screenshotIds) if (!await database.screenshots.get(imageId)) throw new Error('所选截图已不存在，请取消关联后重试。');
    for (const captureId of captureIds) {
      const capture = await database.contentCaptures.get(captureId);
      if (!capture) throw new Error('关联的采集记录已不存在。');
      if (capture.noteId && capture.noteId !== id && await database.notes.get(capture.noteId)) throw new Error('这份采集已关联另一条笔记，未覆盖已有关系。');
    }
    const tags = [...new Set(input.tagsText.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))];
    if (tags.length > 50 || tags.some(tag => tag.length > 50) || input.category.length > 100) throw new Error('最多 50 个标签，每个不超过 50 字；分类不超过 100 字。');
    const fields = { title: input.title.trim() || '未命名灵感', url: input.url.trim(), body: input.body, content: input.content, tags, status: input.status, platform: input.platform, author: input.author?.trim() || null, publishedAt: input.publishedAt?.trim() || null, screenshotIds, captureIds, researchQuestions: input.researchQuestions, category: input.category.trim(), favorite: input.favorite, saveState, sourceTabId: draft.sourceTabId, sourcePageUrl: draft.sourcePageUrl };
    const unchanged = previous && Object.entries(fields).every(([key, value]) => equal(previous[key as keyof Note], value));
    if (!unchanged) {
      const note: Note = { ...noteDefaults(), ...fields, id, createdAt: previous?.createdAt ?? draft.createdAt, updatedAt: Date.now(), revision: (previous?.revision ?? 0) + 1 };
      await database.notes.put(note); await writeNoteIndex(note, database);
      await database.contentCaptures.where('noteId').equals(id).filter(capture => !captureIds.includes(capture.id)).modify({ noteId: null });
      for (const captureId of captureIds) await database.contentCaptures.update(captureId, { noteId: id });
      await updateIndexedDraft(id, { baseRevision: note.revision, hasChanges: false, updatedAt: Date.now() }, database);
    } else await updateIndexedDraft(id, { hasChanges: false }, database);
    return id;
  });
}
export async function deleteScreenshot(id: string, database = db) {
  await database.transaction('rw', [database.screenshots, database.screenshotThumbs, database.notes, database.noteDrafts, database.draftCatalog, database.contentCaptures], async () => {
    const references = await database.notes.where('screenshotIds').equals(id).count() + await database.noteDrafts.where('input.screenshotIds').equals(id).count() + await database.contentCaptures.where('screenshotIds').equals(id).count();
    if (references) throw new Error('截图仍被笔记或采集草稿引用，不能删除文件。请先解除关联。');
    await database.screenshots.delete(id); await database.screenshotThumbs.delete(id);
  });
}
