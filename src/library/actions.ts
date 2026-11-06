import { db, deleteNote } from '../storage';
import { equal, inputFromNote } from '../inspiration/model';
import { updateIndexedDraft, writeNoteIndex } from './projections';
export type BatchOperation = { type: 'category'; value: string } | { type: 'addTags' | 'removeTags'; value: string } | { type: 'favorite'; value: boolean } | { type: 'delete' };
export interface BatchResult { succeeded: string[]; failed: { id: string; title: string; reason: string }[] }
export async function executeBatch(ids: string[], operation: BatchOperation, database = db, options: { confirmed?: boolean; onProgress?: (completed: number) => void } = {}): Promise<BatchResult> {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 500) throw new Error('请选中 1 至 500 条笔记。');
  if (operation.type === 'delete' && !options.confirmed) throw new Error('删除前必须再次确认。');
  const tags = 'value' in operation && typeof operation.value === 'string' ? [...new Set(operation.value.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))] : [];
  if (operation.type === 'category' && operation.value.trim().length > 100) throw new Error('分类最多 100 字符。');
  if ((operation.type === 'addTags' || operation.type === 'removeTags') && (!tags.length || tags.length > 50 || tags.some(tag => tag.length > 50))) throw new Error('请填写有效标签，最多 50 个，每个不超过 50 字符。');
  const result: BatchResult = { succeeded: [], failed: [] };
  for (const id of unique) {
    let title = '已不存在的笔记';
    try {
      await database.transaction('rw', [database.notes, database.noteDrafts, database.analyses, database.contentCaptures, database.noteCatalog, database.noteSearch, database.draftCatalog, database.libraryState], async () => {
        const note = await database.notes.get(id); if (!note) throw new Error('笔记已被其他窗口删除。'); title = note.title;
        if (operation.type === 'delete') { await deleteNote(id, database); return; }
        const draft = await database.noteDrafts.get(id);
        if (draft?.hasChanges) throw new Error('存在未提交编辑，请先保存或核对后再修改。');
        const next = { ...note };
        if (operation.type === 'category') next.category = operation.value.trim();
        else if (operation.type === 'favorite') next.favorite = operation.value;
        else if (operation.type === 'addTags') next.tags = [...new Set([...note.tags, ...tags])];
        else next.tags = note.tags.filter(tag => !tags.includes(tag));
        if (next.tags.length > 50) throw new Error('添加后超过 50 个标签，本条未修改。');
        if (equal(next, note)) return;
        next.revision = (note.revision ?? 0) + 1; next.updatedAt = Date.now(); await database.notes.put(next); await writeNoteIndex(next, database);
        if (draft) await updateIndexedDraft(id, { input: inputFromNote(next), baseRevision: next.revision, updatedAt: next.updatedAt }, database);
      });
      result.succeeded.push(id);
    } catch (error) { result.failed.push({ id, title, reason: error instanceof Error && /未提交|删除|超过/.test(error.message) ? error.message : '本条写入失败，事务已回滚，请稍后重试。' }); }
    options.onProgress?.(result.succeeded.length + result.failed.length);
  }
  return result;
}
