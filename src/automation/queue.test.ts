import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeaClipDB, createNote, setAIEnabled, type Note } from '../storage';
import { AIEngine } from '../ai/engine';
import { DEFAULT_CONFIG, getCredential, hasPermission } from '../ai/config';
import { chatTransport } from '../ai/transport';
import { beginDraft, commitDraft, patchDraft } from '../inspiration/repository';
import { mockCompletion } from '../../tests/ai-fixture';
import { DEFAULT_POLICY, candidateKind, parseHosts, sensitivePage, sourceProblem, type AutoPolicy } from './model';
import { assertSnapshot, enqueueSavedNote, pauseAutomatic, savePolicy } from './policy';
import { QueueExecutor, cancelTask, cancelWaiting, recoverQueue, resumeWaiting, type TaskLock } from './queue';
import { exportBackup, prepareBackup, restoreBackup, discardBackup } from '../backup/service';
import { readZip } from '../backup/zip';

vi.mock('../ai/config', async original => ({ ...await original<typeof import('../ai/config')>(), getCredential: vi.fn(), hasPermission: vi.fn() }));
let database: IdeaClipDB; const executors: QueueExecutor[] = []; const engines: AIEngine[] = [];
const endpoint = 'http://127.0.0.1:45555/v1/chat/completions';
const credential = { version: 'key-version', value: 'synthetic-queue-credential', endpoint, persistent: false };
const config = { ...DEFAULT_CONFIG, version: 'config-version', provider: 'custom' as const, endpoint, model: 'mock', timeoutMs: 1000, dailyBudgetUsd: 1, inputUsdPerMillion: 1, outputUsdPerMillion: 1 };
const policy = (): AutoPolicy => ({ ...DEFAULT_POLICY, mode: 'after-save', autoEnabled: true, allowHosts: ['example.com'], consentId: 'consent', configVersion: config.version, credentialVersion: credential.version, sessionId: 'session', perTaskMicros: 1000000, dailyBudgetMicros: 1000000, acceptedAt: Date.now() });
const immediate: TaskLock = async (_name, action) => action();
function executor(fetcher = vi.fn(async () => Response.json(mockCompletion())), extras: Partial<ConstructorParameters<typeof AIEngine>[1]> = {}, lock = immediate) {
  const engine = new AIEngine(database, { permission: async () => true, credential: async () => credential, transport: chatTransport(fetcher as typeof fetch), lock: async action => action(), ...extras }); engines.push(engine);
  const service = new QueueExecutor(engine, database, lock); executors.push(service); return { service, engine, fetcher };
}
async function note(url = 'https://example.com/post') { const id = await createNote({ title: '商业工具', url, body: '先验证用户需求', tags: [] }, database); return { id, task: (await database.aiTasks.where('noteId').equals(id).first())! }; }
async function draft(saveState: 'draft' | 'saved', assisted = false) {
  const id = await beginDraft('draft:' + crypto.randomUUID(), { title: 'SaaS 创意', sourcePageUrl: 'https://example.com/product' }, database);
  await patchDraft(id, { content: '产品正文' }, { content: '' }, database); await commitDraft(id, saveState, undefined, database, { assisted }); return id;
}
beforeEach(async () => {
  database = new IdeaClipDB('automation-test-' + crypto.randomUUID()); await database.settings.put({ id: 'general', aiEnabled: true }); await database.aiConfig.put(config); await database.autoPolicy.put(policy());
  vi.mocked(getCredential).mockResolvedValue(credential); vi.mocked(hasPermission).mockResolvedValue(true);
});
afterEach(async () => { for (const e of executors.splice(0)) e.close(); for (const e of engines.splice(0)) e.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await database.delete(); });

describe('主动保存、范围授权与事务队列', () => {
  it('默认手动且自动关闭，普通保存不入队', async () => { expect(DEFAULT_POLICY).toMatchObject({ mode: 'manual', autoEnabled: false }); await database.autoPolicy.delete('general'); await note(); expect(await database.aiTasks.count()).toBe(0); });
  it.each(['manual', 'disabled', 'global-off', 'draft', 'assist-unconfirmed'])('%s 不触发自动队列', async scenario => {
    if (scenario === 'manual') await database.autoPolicy.update('general', { mode: 'manual' });
    if (scenario === 'disabled') await database.autoPolicy.update('general', { autoEnabled: false });
    if (scenario === 'global-off') await database.settings.update('general', { aiEnabled: false });
    if (scenario === 'assist-unconfirmed') await database.autoPolicy.update('general', { mode: 'assist' });
    await draft(scenario === 'draft' ? 'draft' : 'saved'); expect(await database.aiTasks.count()).toBe(0);
  });
  it('主动保存与队列同事务；重复保存和同版本通知只产生一个任务', async () => {
    const id = await draft('saved'); await commitDraft(id, 'saved', undefined, database);
    const saved = (await database.notes.get(id))!; await enqueueSavedNote(saved, database); expect(await database.aiTasks.count()).toBe(1); expect((await database.aiTasks.toArray())[0]).toMatchObject({ noteId: id, revision: saved.revision, state: 'waiting' });
  });
  it('浏览辅助仅显式勾选并保存才入队', async () => { await database.autoPolicy.update('general', { mode: 'assist' }); const id = await draft('saved', true); expect((await database.aiTasks.toArray())[0]).toMatchObject({ noteId: id, source: 'assist' }); });
  it('暂停时新保存仅建立暂停任务', async () => { await pauseAutomatic('用户暂停', database); expect((await note()).task.state).toBe('paused'); });
  it('队列写入配额失败回滚笔记并保留草稿输入', async () => {
    const id = await beginDraft('quota', { title: '保留输入', sourcePageUrl: 'https://example.com' }, database); vi.spyOn(database.aiTasks, 'add').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(commitDraft(id, 'saved', undefined, database)).rejects.toThrow(); expect(await database.notes.get(id)).toBeUndefined(); expect((await database.noteDrafts.get(id))?.input.title).toBe('保留输入'); expect(await database.noteCatalog.get(id)).toBeUndefined();
  });
  it('必须明确同意范围和预算，拒绝通配符与非法金额', async () => {
    await expect(savePolicy(policy(), database, false)).rejects.toThrow('明确确认'); await expect(savePolicy({ ...policy(), perTaskMicros: NaN }, database, true)).rejects.toThrow(); await expect(savePolicy({ ...policy(), allowHosts: ['*.example.com'] }, database, true)).rejects.toThrow(); await expect(savePolicy({ ...policy(), allowHosts: [] }, database, true)).rejects.toThrow();
    await savePolicy({ ...policy(), allowHosts: ['EXAMPLE.com'] }, database, true); expect((await database.autoPolicy.get('general'))?.allowHosts).toEqual(['example.com']);
  });
  it('黑名单优先且包括子域，白名单仅精确主机，敏感页面不能覆盖', () => {
    const saved = { title: '工具', url: 'https://sub.example.com', body: '', content: '' };
    expect(sourceProblem(saved, policy())).toContain('白名单'); expect(sourceProblem(saved, { ...policy(), allowHosts: ['sub.example.com'], denyHosts: ['example.com'] })).toContain('黑名单'); expect(sourceProblem({ ...saved, url: 'https://example.com/login' }, policy())).toContain('敏感');
  });
  it.each(['https://mail.example.com/a', 'https://example.com/password', 'https://bank.example.org', 'https://example.com/a?token=x', 'https://example.com/settings', 'https://example.com/dashboard'])('敏感源 %s 保存保留但不发送', async url => { const saved = await note(url); expect(saved.task.state).toBe('cancelled'); expect(saved.task.reason).toContain('敏感'); expect(await database.notes.get(saved.id)).toBeDefined(); });
  it('本地规则识别候选且不识别敏感页面', () => {
    expect(candidateKind('https://github.com/a/repo', '项目', '')).toBe('GitHub 项目'); expect(candidateKind('https://x.com/a/status/123', '帖子', '创业获客')).toBe('X 商业创意帖子'); expect(candidateKind('https://x.com/a/status/123', '宠物', '')).toBeNull(); expect(candidateKind('https://example.com', 'SaaS subscription', '')).toBe('SaaS 产品'); expect(candidateKind('https://example.com/login', 'SaaS', '')).toBeNull(); expect(sensitivePage('https://example.com', '产品', '密码：secret')).toBe(true); expect(parseHosts('example.com,EXAMPLE.com')).toEqual(['example.com']);
  });
});

describe('执行、快照、预算和取消', () => {
  it('自动执行沿用 15 栏引擎与账本，绝不包含图片，执行两次不重复发送', async () => {
    const saved = await note(); const e = executor(); await e.service.execute(saved.task.id, 'session'); await e.service.execute(saved.task.id, 'session');
    expect(e.fetcher).toHaveBeenCalledTimes(1); const request = e.fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(request[1]).toMatchObject({ redirect: 'error', credentials: 'omit' }); expect(request[1].body).not.toContain('image_url'); expect(request[1].body).not.toContain('data:image');
    const report = (await database.analyses.toArray())[0]; expect(Object.keys(report.report!.sections)).toHaveLength(15); expect(report).toMatchObject({ noteId: saved.id, imageCount: 0 }); expect((await database.aiTasks.get(saved.task.id))?.state).toBe('done'); expect((await database.aiUsage.toArray())[0].reservedMicros).toBeGreaterThan(0);
  });
  it('两个执行页通过任务锁不重复发送', async () => {
    let tail = Promise.resolve(); const lock: TaskLock = (_id, action) => { const next = tail.then(action); tail = next.then(() => {}, () => {}); return next; };
    const saved = await note(); const a = executor(undefined, {}, lock); const b = executor(undefined, {}, lock); await Promise.all([a.service.execute(saved.task.id, 'session'), b.service.execute(saved.task.id, 'session')]); expect(a.fetcher.mock.calls.length + b.fetcher.mock.calls.length).toBe(1);
  });
  it.each(['revision', 'raw-content', 'dirty-draft', 'deleted'])('笔记 %s 后快照失效，零请求', async change => {
    const saved = await note(); if (change === 'revision') await database.notes.update(saved.id, { revision: 9 }); if (change === 'raw-content') await database.notes.update(saved.id, { content: '修改但未递增版本' }); if (change === 'deleted') await database.notes.delete(saved.id);
    if (change === 'dirty-draft') { const { editNote } = await import('../inspiration/repository'); await editNote(saved.id, database); await database.noteDrafts.update(saved.id, { hasChanges: true }); }
    const e = executor(); await e.service.execute(saved.task.id, 'session'); expect(e.fetcher).not.toHaveBeenCalled(); expect((await database.aiTasks.get(saved.task.id))?.errorCode).toBe('snapshot');
  });
  it.each(['paused', 'global-off', 'config', 'credential', 'permission', 'cap', 'session'])('%s 门禁不产生网络请求', async gate => {
    const saved = await note(); const e = executor(undefined, gate === 'permission' ? { permission: async () => false } : gate === 'credential' ? { credential: async () => ({ ...credential, version: 'changed' }) } : {});
    if (gate === 'paused') await database.autoPolicy.update('general', { paused: true }); if (gate === 'global-off') await database.settings.update('general', { aiEnabled: false }); if (gate === 'config') await database.aiConfig.update('manual', { version: 'changed' }); if (gate === 'cap') await database.autoPolicy.update('general', { perTaskMicros: 1 });
    await e.service.execute(saved.task.id, gate === 'session' ? 'wrong-session' : 'session'); expect(e.fetcher).not.toHaveBeenCalled(); expect((await database.aiTasks.get(saved.task.id))?.state).not.toBe('done');
  });
  it('预算耗尽暂停队列，恢复不能自动重复失败请求', async () => {
    const first = await note(); const e = executor(); const amount = (await e.engine.preview(first.id, [])).costMicros;
    await database.aiConfig.update('manual', { dailyBudgetUsd: amount / 1000000 }); await database.autoPolicy.update('general', { dailyBudgetMicros: amount, perTaskMicros: amount });
    await e.service.execute(first.task.id, 'session'); const second = await note(); const third = await note(); await e.service.execute(second.task.id, 'session'); expect(e.fetcher).toHaveBeenCalledTimes(1); expect((await database.aiTasks.get(second.task.id))?.state).toBe('paused'); expect((await database.aiTasks.get(third.task.id))?.state).toBe('paused'); expect((await database.autoPolicy.get('general'))?.paused).toBe(true);
  });
  it('超时只请求一次且保留费用，未知费用任务不能被恢复为等待', async () => {
    const saved = await note(); const e = executor(vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('cancel')), { once: true }))) as never);
    await e.service.execute(saved.task.id, 'session'); expect(e.fetcher).toHaveBeenCalledTimes(1); expect(await database.aiTasks.get(saved.task.id)).toMatchObject({ state: 'failed', errorCode: 'timeout', feeUnknown: true }); await resumeWaiting('session', database); expect((await database.aiTasks.get(saved.task.id))?.state).toBe('failed'); expect(e.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['cancel', 'pause', 'global-off'])('运行中 %s 取消客户端且不启动下一请求', async action => {
    const saved = await note(); const waiting = await note(); let aborted = false;
    const e = executor(vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => { init.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('abort')); }, { once: true }); })) as never);
    const pending = e.service.execute(saved.task.id, 'session'); await vi.waitFor(() => expect(e.fetcher).toHaveBeenCalledTimes(1));
    if (action === 'cancel') await cancelTask(saved.task.id, database); if (action === 'pause') await pauseAutomatic('用户暂停', database); if (action === 'global-off') await setAIEnabled(false, database);
    await pending; expect(aborted).toBe(true); expect((await database.aiTasks.get(waiting.task.id))?.state).toBe('paused'); expect((await database.aiTasks.get(saved.task.id))?.state).toBe(action === 'cancel' ? 'cancelled' : 'failed'); expect(e.fetcher).toHaveBeenCalledTimes(1);
  });
  it('取消全部仅取消未发送任务', async () => { const a = await note(); const b = await note(); await database.aiTasks.update(a.task.id, { state: 'running' }); await cancelWaiting(database); expect((await database.aiTasks.get(a.task.id))?.state).toBe('running'); expect((await database.aiTasks.get(b.task.id))?.state).toBe('cancelled'); });
  it.each(['disable-auto', 'renew-consent'])('%s 立即取消旧授权的运行请求', async change => {
    const saved = await note(); const e = executor(vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('abort')), { once: true }))) as never);
    const pending = e.service.execute(saved.task.id, 'session'); await vi.waitFor(() => expect(e.fetcher).toHaveBeenCalledTimes(1));
    await savePolicy({ ...policy(), autoEnabled: change !== 'disable-auto', consentId: 'replacement' }, database, true); await pending; expect((await database.aiTasks.get(saved.task.id))?.state).toBe('failed'); expect(e.fetcher).toHaveBeenCalledTimes(1);
  });
  it('缺失用量账本不能证明免费，已尝试任务不得变回可自动恢复状态', async () => {
    const saved = await note(); const e = executor(vi.fn(async () => { await database.aiUsage.clear(); throw new Error('synthetic failure'); })); await e.service.execute(saved.task.id, 'session'); expect(await database.aiTasks.get(saved.task.id)).toMatchObject({ state: 'failed', feeUnknown: true }); await resumeWaiting('session', database); expect((await database.aiTasks.get(saved.task.id))?.state).toBe('failed'); expect(e.fetcher).toHaveBeenCalledTimes(1);
  });
  it('无客户端密钥代理可以使用单独确认的自动授权', async () => {
    await database.aiConfig.update('manual', { auth: 'none' }); await savePolicy({ ...policy(), credentialVersion: null }, database, true); const saved = await note(); const e = executor(undefined, { credential: async () => null }); await e.service.execute(saved.task.id, 'session'); expect((await database.aiTasks.get(saved.task.id))?.state).toBe('done'); expect(e.fetcher).toHaveBeenCalledTimes(1);
  });
  it('同会话执行页意外关闭后，中断任务和后续任务也须人工核对', async () => { const a = await note(); const b = await note(); await database.aiTasks.update(a.task.id, { state: 'running', attemptId: 'unknown' }); await recoverQueue('session', database); expect((await database.aiTasks.get(a.task.id))?.state).toBe('failed'); expect((await database.aiTasks.get(b.task.id))?.state).toBe('paused'); });
  it('浏览辅助网站权限撤销时，仍有服务商权限也不能执行或恢复', async () => {
    await database.autoPolicy.update('general', { mode: 'assist' }); const id = await draft('saved', true); const task = (await database.aiTasks.where('noteId').equals(id).first())!; const e = executor(); vi.stubGlobal('chrome', { runtime: { id: 'synthetic' }, permissions: { contains: async () => false } });
    await e.service.execute(task.id, 'session'); expect(e.fetcher).not.toHaveBeenCalled(); expect((await database.aiTasks.get(task.id))?.errorCode).toBe('permission'); await expect(resumeWaiting('session', database)).rejects.toThrow('网站权限已撤销');
  });
  it('暂停/人工恢复验证新会话、凭据和快照，只恢复未发送版本', async () => {
    const a = await note(); const b = await note(); await pauseAutomatic('暂停', database); await database.notes.update(b.id, { body: '新感悟' }); expect(await resumeWaiting('new-session', database)).toEqual({ resumed: 1, stale: 1 }); expect(await database.aiTasks.get(a.task.id)).toMatchObject({ state: 'waiting', sessionId: 'new-session' }); expect((await database.aiTasks.get(b.task.id))?.state).toBe('failed');
    await pauseAutomatic('暂停', database); vi.mocked(hasPermission).mockResolvedValue(false); await expect(resumeWaiting('new-session', database)).rejects.toThrow('授权失效'); expect((await database.aiTasks.get(a.task.id))?.state).toBe('paused');
  });
  it('重启将中断运行标失败，未发送标暂停，有报告恢复完成而不重发', async () => {
    const a = await note(); const b = await note(); const c = await note(); await database.aiTasks.update(a.task.id, { state: 'running', attemptId: 'interrupted' }); await database.aiTasks.update(b.task.id, { state: 'running', attemptId: 'finished' }); await database.analyses.put({ id: 'finished', noteId: b.id, createdAt: 1, content: '已完成' });
    await recoverQueue('new-session', database); expect(await database.aiTasks.get(a.task.id)).toMatchObject({ state: 'failed', feeUnknown: true, errorCode: 'interrupted' }); expect(await database.aiTasks.get(b.task.id)).toMatchObject({ state: 'done', resultId: 'finished' }); expect((await database.aiTasks.get(c.task.id))?.state).toBe('paused');
  });
  it('失败必须新的手动预览与费用确认，重复执行不会自动重试', async () => {
    const saved = await note(); const e = executor(vi.fn(async () => new Response(null, { status: 500 }))); await e.service.execute(saved.task.id, 'session'); await e.service.execute(saved.task.id, 'session'); expect(e.fetcher).toHaveBeenCalledTimes(1);
    e.fetcher.mockResolvedValue(Response.json(mockCompletion())); const preview = await e.service.prepareRetry(saved.task.id); expect(e.fetcher).toHaveBeenCalledTimes(1); await e.service.execute(saved.task.id, 'session', preview); expect(e.fetcher).toHaveBeenCalledTimes(2); expect((await database.aiTasks.get(saved.task.id))?.state).toBe('done'); expect(await database.aiUsage.count()).toBe(2);
  });
  it('报告保存失败保留结果，重试保存不再次调用模型', async () => {
    const saved = await note(); const e = executor(); vi.spyOn(database.analyses, 'add').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError')); await e.service.execute(saved.task.id, 'session'); expect(e.service.unsaved.has(saved.task.id)).toBe(true); await e.service.retrySave(saved.task.id); expect((await database.aiTasks.get(saved.task.id))?.state).toBe('done'); expect(e.fetcher).toHaveBeenCalledTimes(1);
  });
  it('报告已保存但完成状态首次写入失败时，找到报告完成任务，绝不重复请求', async () => {
    const saved = await note(); let failOnce = true;
    database.aiTasks.hook('updating', modifications => { if (failOnce && (modifications as Partial<import('./model').AITask>).state === 'done') { failOnce = false; throw new DOMException('synthetic state-write failure', 'QuotaExceededError'); } });
    const e = executor(); await e.service.execute(saved.task.id, 'session'); expect(await database.analyses.count()).toBe(1); expect((await database.aiTasks.get(saved.task.id))?.state).toBe('done'); expect(e.fetcher).toHaveBeenCalledTimes(1);
  });
  it('取消/完成状态竞态留下的已有报告先关联，拒绝再次收费的手动预览', async () => {
    const saved = await note(); const e = executor(); await e.service.execute(saved.task.id, 'session'); await database.aiTasks.update(saved.task.id, { state: 'cancelled', resultId: null, feeUnknown: true }); await expect(e.service.prepareRetry(saved.task.id)).rejects.toThrow('已有'); expect(await database.aiTasks.get(saved.task.id)).toMatchObject({ state: 'done', feeUnknown: false }); expect(e.fetcher).toHaveBeenCalledTimes(1);
  });
  it('URL/正文敏感字段被改写时再次拦截，不使用旧快照上传', async () => { const saved = await note(); await database.notes.update(saved.id, { content: '密码：secret' }); await expect(assertSnapshot(saved.task, database)).rejects.toThrow('快照失效'); });
});

describe('schema v7 与备份兼容', () => {
  it('报告仍进入原备份，队列/自动授权/账本不导出，恢复前安全暂停并保留本地任务', async () => {
    const saved = await note(); const e = executor(); await e.service.execute(saved.task.id, 'session'); const waiting = await note(); const file = await exportBackup(database); const entries = await readZip(file); expect(entries.some(entry => /aiTasks|autoPolicy|aiUsage|aiConfig/.test(entry.name))).toBe(false);
    const prepared = await prepareBackup(file); try { await restoreBackup(prepared, 'replace', database, { confirmed: true }); expect(await database.analyses.count()).toBe(1); expect((await database.aiTasks.get(waiting.task.id))?.state).toBe('paused'); expect((await database.autoPolicy.get('general'))?.paused).toBe(true); expect(await database.aiUsage.count()).toBe(1); } finally { await discardBackup(prepared); }
  });
  it('schema6 升级7保留笔记、原图、分析、配置和账本，不自动授权', async () => {
    const old = new Dexie('automation-migrate-' + crypto.randomUUID()); await database.open(); const schema = Object.fromEntries(database.tables.filter(t => !['autoPolicy', 'aiTasks'].includes(t.name)).map(t => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map(i => i.src)].join(', ')])); old.version(6).stores(schema);
    await old.table('notes').put({ id: 'old', title: '旧笔记', body: '旧感悟' } as Note); await old.table('screenshots').put({ id: 'pic', blob: new Blob(['old-image']) }); await old.table('analyses').put({ id: 'report', noteId: 'old', createdAt: 1, content: '旧报告' }); await old.table('aiConfig').put(config); await old.table('aiUsage').put({ id: 'budget', reservedMicros: 100 }); old.close();
    const upgraded = new IdeaClipDB(old.name); try { await upgraded.open(); expect(upgraded.verno).toBe(7); expect((await upgraded.notes.get('old'))?.body).toBe('旧感悟'); expect(await (await upgraded.screenshots.get('pic'))!.blob.text()).toBe('old-image'); expect((await upgraded.analyses.get('report'))?.content).toBe('旧报告'); expect(await upgraded.aiConfig.count()).toBe(1); expect(await upgraded.aiUsage.count()).toBe(1); expect(await upgraded.autoPolicy.count()).toBe(0); expect(await upgraded.aiTasks.count()).toBe(0); } finally { await upgraded.delete(); }
  });
});
