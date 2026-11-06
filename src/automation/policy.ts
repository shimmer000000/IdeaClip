import Dexie from 'dexie';
import type { IdeaClipDB, Note } from '../storage';
import type { Preview } from '../ai/engine';
import { digest } from '../backup/zip';
import { DEFAULT_POLICY, QueueFailure, sourceProblem, parseHosts, sourceOrigins, type AutoPolicy, type AITask, type AutomaticAuthority } from './model';
import { signalQueue } from './signals';
import { captureAllowsAuto } from '../collection/quality';

export const snapshotHash = (note: Note) => digest(new Blob([JSON.stringify({ title: note.title, content: note.content, body: note.body, url: note.url, revision: note.revision, updatedAt: note.updatedAt })]));
export async function automaticContentProblem(note: Note, database: IdeaClipDB): Promise<string> {
  if (!note.content.trim()) return '正文质量不足：没有已采集正文。可补充后逐次确认手动分析；不会自动发送。';
  const captures = await database.contentCaptures.bulkGet(note.captureIds ?? []);
  return captures.some(c => c && captureAllowsAuto(c, note.content, note.url)) ? '' : '正文质量或来源待核对：需当前网页重新采集的完整正文，并与笔记内容和 URL 一致。手动修改、旧记录、恢复数据或不完整采集不自动发送，可逐次确认手动分析。';
}
export async function assistPermission(url: string) {
  return !!globalThis.chrome?.runtime?.id && chrome.permissions.contains({ origins: sourceOrigins([new URL(url).hostname]) });
}
// Called inside the note's write transaction. The queue and note either both commit or both roll back.
export async function enqueueSavedNote(note: Note, database: IdeaClipDB, assisted = false): Promise<string | null> {
  if (note.saveState !== 'saved') return null;
  const policy = await database.autoPolicy.get('general');
  if (!policy?.autoEnabled || policy.mode === 'manual' || (policy.mode === 'assist' && !assisted) || !(await database.settings.get('general'))?.aiEnabled) return null;
  const dedupeKey = `${note.id}:revision:${note.revision}`; const existing = await database.aiTasks.where('dedupeKey').equals(dedupeKey).first(); if (existing) return existing.id;
  if (await database.aiTasks.where('state').anyOf('waiting', 'paused', 'running').count() >= 1000) throw new Error('自动队列达到 1000 条上限，请先整理任务再保存；编辑内容仍保留。');
  const denied = sourceProblem(note, policy); const config = await database.aiConfig.get('manual'); const stale = config?.version !== policy.configVersion;
  const qualityProblem = denied ? '' : await automaticContentProblem(note, database);
  const now = Date.now(); const task: AITask = { id: crypto.randomUUID(), dedupeKey, noteId: note.id, revision: note.revision, snapshotHash: await Dexie.waitFor(snapshotHash(note)), state: denied ? 'cancelled' : policy.paused || stale || qualityProblem ? 'paused' : 'waiting', reason: denied || qualityProblem || (stale ? '服务商配置变化，需重新确认自动授权。' : policy.paused ? policy.reason || '自动队列已暂停。' : ''), errorCode: denied ? 'source' : qualityProblem ? 'quality' : stale ? 'config' : '', source: assisted ? 'assist' : 'save', consentId: policy.consentId, sessionId: policy.sessionId, createdAt: now, updatedAt: now, attemptId: null, lastAttemptId: null, resultId: null, feeUnknown: false, execution: 'auto' };
  await database.aiTasks.add(task); return task.id;
}
export async function assertSnapshot(task: AITask, database: IdeaClipDB): Promise<Note> {
  const note = await database.notes.get(task.noteId);
  if (!note || note.saveState !== 'saved' || note.revision !== task.revision || await Dexie.waitFor(snapshotHash(note)) !== task.snapshotHash || (await database.noteDrafts.get(task.noteId))?.hasChanges) throw new QueueFailure('snapshot', '保存版本已改变、删除或存在未提交编辑，任务快照失效；未发送新版本。');
  return note;
}
export async function authorizeAutomatic(preview: Preview, authority: AutomaticAuthority, database: IdeaClipDB): Promise<void> {
  const policy = await database.autoPolicy.get('general'); const task = await database.aiTasks.get(authority.taskId);
  if (!policy || !(await database.settings.get('general'))?.aiEnabled || (!authority.manualRetry && (!policy.autoEnabled || policy.mode === 'manual' || policy.paused))) throw new QueueFailure('paused', '自动分析已暂停或关闭。');
  if (!task || task.state !== 'running' || task.execution !== (authority.manualRetry ? 'manual' : 'auto') || task.attemptId !== preview.id || task.noteId !== preview.noteId || task.consentId !== authority.consentId || policy.consentId !== authority.consentId || task.sessionId !== authority.sessionId || (!authority.manualRetry && policy.sessionId !== authority.sessionId)) throw new QueueFailure('consent', '自动任务或本浏览器会话授权失效，需人工恢复。');
  if (preview.imageIds.length || (!authority.manualRetry && (policy.configVersion !== preview.config.version || policy.credentialVersion !== authority.credentialVersion || preview.costMicros > policy.perTaskMicros || Math.floor(preview.config.dailyBudgetUsd * 1000000) > policy.dailyBudgetMicros || (policy.mode === 'assist' && task.source !== 'assist')))) throw new QueueFailure('consent', '配置、凭据、图像范围或费用超过已确认的自动授权。');
  // Uses waitFor only inside the short budget transaction; no network is awaited there.
  const note = await database.notes.get(task.noteId);
  if (!note || note.revision !== task.revision || await Dexie.waitFor(snapshotHash(note)) !== task.snapshotHash || (await database.noteDrafts.get(task.noteId))?.hasChanges) throw new QueueFailure('snapshot', '笔记已改变，原任务失效，请人工核对。');
  const denied = sourceProblem(note, policy); if (denied) throw new QueueFailure('source', denied);
  if (!authority.manualRetry) { const problem = await automaticContentProblem(note, database); if (problem) throw new QueueFailure('quality', problem); }
  if (task.source === 'assist' && !await Dexie.waitFor(assistPermission(note.url))) throw new QueueFailure('permission', '浏览辅助的网站权限已撤销，未发送；请重新授权网站。');
}
export async function pauseAutomatic(reason: string, database: IdeaClipDB) {
  await database.transaction('rw', [database.autoPolicy, database.aiTasks], async () => {
    const policy = await database.autoPolicy.get('general'); if (policy) await database.autoPolicy.update('general', { paused: true, reason });
    await database.aiTasks.where('state').equals('waiting').modify({ state: 'paused', reason, updatedAt: Date.now() });
  }); signalQueue();
}
export async function savePolicy(policy: AutoPolicy, database: IdeaClipDB, confirmed: boolean) {
  const allowHosts = parseHosts(policy.allowHosts.join('\n')); const denyHosts = parseHosts(policy.denyHosts.join('\n'));
  if (!['manual', 'after-save', 'assist'].includes(policy.mode) || (policy.mode === 'manual' && policy.autoEnabled)) throw new Error('分析模式无效。');
  if (policy.autoEnabled && (!confirmed || !policy.consentId || !policy.configVersion || !policy.sessionId || (!allowHosts.length && !policy.allowManual) || (policy.mode === 'assist' && !allowHosts.length) || policy.perTaskMicros < 1 || policy.dailyBudgetMicros < policy.perTaskMicros || !Number.isSafeInteger(policy.perTaskMicros) || !Number.isSafeInteger(policy.dailyBudgetMicros))) throw new Error('自动分析必须明确确认发送范围、单次上限和每日预算。');
  await database.transaction('rw', [database.autoPolicy, database.aiTasks], async () => {
    await database.autoPolicy.put({ ...DEFAULT_POLICY, ...policy, allowHosts, denyHosts, id: 'general' });
    await database.aiTasks.where('state').equals('waiting').modify({ state: 'paused', reason: '自动授权已更新，请在任务中心人工恢复原等待任务。', updatedAt: Date.now() });
  }); signalQueue();
}
