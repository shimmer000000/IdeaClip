import { bindingValid } from '../skills/repository';
import { liveQuery } from 'dexie';
import { db, type Analysis, type IdeaClipDB } from '../storage';
import { AIEngine, type Preview } from '../ai/engine';
import { RequestFailure } from '../ai/transport';
import { getCredential, hasPermission } from '../ai/config';
import { authorizeAutomatic, assertSnapshot, pauseAutomatic, assistPermission, automaticContentProblem } from './policy';
import { QueueFailure, sourceProblem, type AITask, type AutomaticAuthority } from './model';
import { signalQueue } from './signals';

export type TaskLock = <T>(name: string, action: () => Promise<T>) => Promise<T>;
export const taskLock: TaskLock = (name, action) => {
  if (!globalThis.navigator?.locks) return Promise.reject(new Error('浏览器缺少安全任务锁，队列保持暂停。'));
  return navigator.locks.request('ideaclip-task:' + name, action);
};
async function completeFromReport(id: string, database: IdeaClipDB) {
  return database.transaction('rw', [database.aiTasks, database.analyses], async () => {
    const task = await database.aiTasks.get(id); const attempt = task?.attemptId ?? task?.lastAttemptId;
    const report = attempt ? await database.analyses.get(attempt) : null;
    if (!task || !report || report.noteId !== task.noteId || (report.inputRevision !== undefined && report.inputRevision !== task.revision)) return false;
    await database.aiTasks.update(id, { state: 'done', resultId: report.id, feeUnknown: false, reason: '已找到完成的报告，未重复执行。', errorCode: '', updatedAt: Date.now() }); return true;
  });
}
export async function cancelTask(id: string, database = db) {
  await database.transaction('rw', [database.aiTasks, database.analyses], async () => {
    const task = await database.aiTasks.get(id); if (!task || task.state === 'done') return;
    if (task.attemptId && await database.analyses.get(task.attemptId)) { await database.aiTasks.update(id, { state: 'done', resultId: task.attemptId, reason: '', updatedAt: Date.now() }); return; }
    await database.aiTasks.update(id, { state: 'cancelled', reason: task.attemptId ? '用户取消客户端请求，可能已经计费；不自动重试。' : '用户取消，未发送。', feeUnknown: !!task.attemptId, updatedAt: Date.now() });
  }); signalQueue(id);
}
export async function cancelWaiting(database = db) { await database.aiTasks.where('state').anyOf('waiting', 'paused').modify({ state: 'cancelled', reason: '用户取消全部等待任务，未发送。', updatedAt: Date.now() }); signalQueue(); }
export async function resumeWaiting(session: string, database = db) {
  const policy = await database.autoPolicy.get('general'); const config = await database.aiConfig.get('manual');
  if (!policy?.autoEnabled || policy.mode === 'manual' || !(await database.settings.get('general'))?.aiEnabled || !config || config.version !== policy.configVersion) throw new Error('请先开启 AI，并重新确认当前配置的自动分析范围和预算。');
  const credential = await getCredential(config.endpoint);
  if (!await hasPermission(config.endpoint) || (credential?.version ?? null) !== policy.credentialVersion) throw new Error('凭据或端点授权失效，请先在设置页确认，再重新授权自动模式。');
  if (policy.mode === 'assist') for (const host of policy.allowHosts) if (!await assistPermission('https://' + host)) throw new Error('浏览辅助网站权限已撤销，请先在设置页重新授权。');
  if (!await bindingValid(policy, database)) throw new Error('默认模板或版本授权失效，请在设置页重新确认自动分析。');
  let resumed = 0; let stale = 0;
  await database.transaction('rw', [database.autoPolicy, database.aiTasks, database.notes, database.noteDrafts, database.contentCaptures, database.aiTemplates, database.skillPreferences], async () => {
    await database.autoPolicy.update('general', { sessionId: session, paused: false, reason: '' });
    const rows = await database.aiTasks.where('state').equals('paused').toArray();
    for (const task of rows) {
      if (task.attemptId) continue;
      try {
        if (task.skillId !== policy.skillId || task.skillVersion !== policy.skillVersion || task.skillSignature !== policy.skillSignature) { await database.aiTasks.update(task.id, { state: 'paused', errorCode: 'template', reason: '旧任务模板版本与新授权不同；请取消旧任务并手动分析，不会自动换用新模板。' }); stale++; continue; }
        const note = await assertSnapshot(task, database); const denied = sourceProblem(note, policy);
        if (denied || (policy.mode === 'assist' && task.source !== 'assist')) throw new Error(denied || '当前模式不允许旧保存模式任务，请手动分析。');
        const quality = await automaticContentProblem(note, database);
        if (quality) { await database.aiTasks.update(task.id, { state: 'paused', reason: quality, errorCode: 'quality', updatedAt: Date.now() }); stale++; continue; }
        await database.aiTasks.update(task.id, { state: 'waiting', consentId: policy.consentId, sessionId: session, reason: '', errorCode: '', updatedAt: Date.now() }); resumed++;
      } catch { await database.aiTasks.update(task.id, { state: 'failed', reason: '快照失效或来源不符合当前授权，未发送；请核对原笔记。', errorCode: 'snapshot', updatedAt: Date.now() }); stale++; }
    }
  }); signalQueue(); return { resumed, stale };
}
export async function recoverQueue(session: string, database = db, recoverLock?: (id: string, action: () => Promise<void>) => Promise<void>) {
  let interrupted = false;
  const recover = async (task: AITask) => {
    const current = await database.aiTasks.get(task.id); if (current?.state !== 'running') return;
    if (await completeFromReport(task.id, database)) return;
    interrupted = true;
    await database.aiTasks.update(task.id, { state: 'failed', feeUnknown: true, reason: '上次执行中断，费用或结果未知；不会自动重发，请核对后手动确认重试。', errorCode: 'interrupted', updatedAt: Date.now() });
  };
  for (const task of await database.aiTasks.where('state').equals('running').toArray()) {
    if (recoverLock) await recoverLock(task.id, () => recover(task)); else await recover(task);
  }
  const policy = await database.autoPolicy.get('general');
  if (policy?.autoEnabled && (policy.sessionId !== session || interrupted)) await pauseAutomatic(interrupted ? '发现运行中断任务，费用未知；剩余未发送任务需人工恢复。' : '浏览器已重启，等待任务需人工恢复；默认会话密钥也可能需要重填。', database);
}

export class QueueExecutor {
  readonly unsaved = new Map<string, Analysis>();
  private current: string | null = null; private readonly channel: BroadcastChannel | null;
  constructor(readonly engine = new AIEngine(), private readonly database: IdeaClipDB = db, private readonly lock: TaskLock = taskLock) {
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('ideaclip-auto-queue');
    if (this.channel) this.channel.onmessage = event => { if (!event.data.taskId || event.data.taskId === this.current) void this.checkCancellation(); };
  }
  private async checkCancellation() {
    if (!this.current) return; const task = await this.database.aiTasks.get(this.current); const policy = await this.database.autoPolicy.get('general');
    if (!task || task.state !== 'running' || task.consentId !== policy?.consentId || (task.execution === 'auto' && (!policy?.autoEnabled || policy.paused || policy.mode === 'manual'))) this.engine.cancelAll();
  }
  close() { this.engine.close(); this.channel?.close(); }
  private async fail(id: string, error: unknown, attemptId: string | null) {
    if (await completeFromReport(id, this.database)) return;
    const usage = attemptId ? await this.database.aiUsage.get(attemptId).catch(() => undefined) : null;
    // Missing/unreadable ledger after a claimed attempt is uncertain, never proof of no charge.
    const charged = !!usage?.reservedMicros || (!!attemptId && usage === undefined);
    const code = error instanceof RequestFailure || error instanceof QueueFailure ? error.code : 'local';
    const knownUnsent = !charged && ['paused', 'budget', 'permission', 'credential', 'consent', 'config', 'quality', 'template'].includes(code);
    const reason = error instanceof RequestFailure || error instanceof QueueFailure ? error.message : '本地任务处理失败，原笔记未修改，请检查空间和配置。';
    await this.database.transaction('rw', [this.database.aiTasks], async () => {
      const task = await this.database.aiTasks.get(id); if (!task || !['waiting', 'running'].includes(task.state)) return;
      await this.database.aiTasks.update(id, { state: knownUnsent ? 'paused' : 'failed', attemptId: knownUnsent ? null : attemptId, lastAttemptId: attemptId || task.lastAttemptId, feeUnknown: charged, reason: reason + (charged ? ' 已预留费用不退回，可能已计费；不自动重试。' : ''), errorCode: code, updatedAt: Date.now() });
    });
    await pauseAutomatic('上一个任务未完成，自动队列已暂停，请核对失败原因后恢复。', this.database);
  }
  async execute(id: string, session: string, manualPreview?: Preview) {
    return this.lock(id, async () => {
      let attemptId: string | null = null; this.current = id;
      try {
        const task = await this.database.aiTasks.get(id);
        if (!task || (manualPreview ? !['failed', 'cancelled'].includes(task.state) : task.state !== 'waiting')) return;
        if (await completeFromReport(id, this.database)) return;
        const note = await assertSnapshot(task, this.database); const policy = await this.database.autoPolicy.get('general');
        if (!policy) throw new QueueFailure('consent', '自动分析授权不存在。'); const denied = sourceProblem(note, policy); if (denied) throw new QueueFailure('source', denied);
        if (!manualPreview) { const quality = await automaticContentProblem(note, this.database); if (quality) throw new QueueFailure('quality', quality); }
        const preview = manualPreview ?? await this.engine.preview(task.noteId, [], task.skillId);
        if (preview.noteId !== task.noteId || preview.revision !== task.revision || preview.imageIds.length) throw new QueueFailure('snapshot', '重试预览与任务版本不一致或包含图片，未发送。');
        const authority: AutomaticAuthority = { taskId: id, consentId: policy.consentId, sessionId: session, credentialVersion: policy.credentialVersion, manualRetry: !!manualPreview };
        await this.database.transaction('rw', [this.database.aiTasks, this.database.autoPolicy, this.database.settings, this.database.notes, this.database.noteDrafts, this.database.contentCaptures, this.database.aiTemplates, this.database.skillPreferences], async () => {
          const current = await this.database.aiTasks.get(id);
          if (!current || (manualPreview ? !['failed', 'cancelled'].includes(current.state) : current.state !== 'waiting')) throw new QueueFailure('cancelled', '任务状态已改变，未重复执行。');
          await this.database.aiTasks.update(id, { state: 'running', attemptId: preview.id, lastAttemptId: preview.id, reason: '', errorCode: '', execution: manualPreview ? 'manual' : 'auto', consentId: policy.consentId, sessionId: session, updatedAt: Date.now() });
          await authorizeAutomatic(preview, authority, this.database);
        });
        attemptId = preview.id;
        const result = await this.engine.run(preview.id, authority);
        if (!result.saved) { this.unsaved.set(id, result.analysis); throw new QueueFailure('save', '报告已取得但本地保存失败；请在当前执行页重试保存，无需再次请求模型。关闭本页可能失去未保存结果。'); }
        await completeFromReport(id, this.database);
      } catch (error) { await this.fail(id, error, attemptId); }
      finally { this.current = null; }
    });
  }
  async prepareRetry(id: string) {
    if (await completeFromReport(id, this.database)) throw new Error('该任务已有完成报告，已关联结果，无需重复付费请求。');
    const task = await this.database.aiTasks.get(id); if (!task || !['failed', 'cancelled'].includes(task.state)) throw new Error('仅失败或已取消任务可以手动重试。');
    await assertSnapshot(task, this.database); const policy = await this.database.autoPolicy.get('general'); const note = await this.database.notes.get(task.noteId);
    if (!policy || !note || sourceProblem(note, policy)) throw new Error('来源已不符合授权或属于敏感页面，禁止从自动任务重试。');
    return this.engine.preview(task.noteId, [], task.skillId);
  }
  async retrySave(id: string) { const analysis = this.unsaved.get(id); if (!analysis) throw new Error('本页没有可恢复的报告，请回到原执行页核对。'); await this.engine.save(analysis); await completeFromReport(id, this.database); this.unsaved.delete(id); }
}

export class QueueRunner {
  private closed = false; private dirty = true; private waiting: (() => void) | null = null; private readonly controller = new AbortController(); private subscription: { unsubscribe(): void } | null = null;
  constructor(private readonly executor: QueueExecutor, private readonly session: string, private readonly database = db) {}
  wake() { this.dirty = true; this.waiting?.(); }
  async start() {
    if (!globalThis.navigator?.locks) throw new Error('任务中心需要支持 Web Locks 的 Chrome / Edge。');
    try { await navigator.locks.request('ideaclip-automatic-owner', { signal: this.controller.signal }, async () => {
      if (this.closed) return;
      await recoverQueue(this.session, this.database, async (id, action) => { await navigator.locks.request('ideaclip-task:' + id, { ifAvailable: true }, async lock => { if (lock) await action(); }); });
      this.subscription = liveQuery(async () => ({ policy: await this.database.autoPolicy.get('general'), enabled: (await this.database.settings.get('general'))?.aiEnabled, waiting: await this.database.aiTasks.where('state').equals('waiting').count() })).subscribe({ next: () => this.wake(), error: () => this.close() });
      while (!this.closed) {
        this.dirty = false;
        const policy = await this.database.autoPolicy.get('general'); const enabled = (await this.database.settings.get('general'))?.aiEnabled;
        if (enabled && policy?.autoEnabled && !policy.paused && policy.mode !== 'manual' && policy.sessionId === this.session) {
          const task = await this.database.aiTasks.where('[state+createdAt]').between(['waiting', 0], ['waiting', Number.MAX_SAFE_INTEGER], true, true).first();
          if (task) { await this.executor.execute(task.id, this.session); continue; }
        }
        await new Promise<void>(resolve => { this.waiting = resolve; if (this.dirty || this.closed) resolve(); }); this.waiting = null;
      }
    }); } catch (error) { if (!this.closed) throw error; }
  }
  close() { this.closed = true; this.controller.abort(); this.subscription?.unsubscribe(); this.executor.close(); this.wake(); }
}
