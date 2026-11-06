import { BUSINESS_ID, skillSignature, skillSystem, renderInstructions, validateSkillReport, skillMarkdown, type Skill } from '../skills/model';
import { getSkill, preferences } from '../skills/repository';
import { liveQuery } from 'dexie';
import { db, getSettings, type Analysis, type IdeaClipDB } from '../storage';
import { redact } from '../backup/model';
import { digest } from '../backup/zip';
import { getCredential, hasPermission, validateConfig, type AIConfig } from './config';
import { markdown, validateReport } from './report';
import { chatTransport, RequestFailure, type AITransport, type Completion } from './transport';
import { authorizeAutomatic } from '../automation/policy';
import { QueueFailure, type AutomaticAuthority } from '../automation/model';

export interface AIUsage { id: string; noteId: string; day: string; createdAt: number; model: string; status: 'reserved' | 'succeeded' | 'failed' | 'cancelled'; reservedMicros: number; estimatedInput: number; maxOutput: number; inputTokens?: number; outputTokens?: number; errorCode?: string }
export interface Preview { id: string; noteId: string; createdAt: number; config: AIConfig; title: string; content: string; body: string; url: string; imageIds: string[]; inputTokensUpper: number; costMicros: number; inputDigest: string; revision: number; template: Skill; systemPrompt: string; requestText: string }
interface Prepared { preview: Preview; images: Blob[]; source: string; credentialVersion: string | null; templateSignature: string }
export interface AnalysisResult { analysis: Analysis; saved: boolean }
interface Dependencies { transport: AITransport; credential: typeof getCredential; permission: typeof hasPermission; lock: <T>(action: () => Promise<T>, signal: AbortSignal) => Promise<T>; now: () => number }
const dependencies = (): Dependencies => ({ transport: chatTransport(), credential: getCredential, permission: hasPermission, now: Date.now, lock: async (action, signal) => { if (!globalThis.navigator?.locks) throw new RequestFailure('lock', '此环境不支持安全请求队列，请在 Chrome / Edge 扩展中运行。'); return navigator.locks.request('ideaclip-manual-ai', { signal }, action); } });
function active(signal: AbortSignal) { if (signal.aborted) throw new RequestFailure('cancelled', 'AI 请求已取消；服务器可能已产生费用，本地预算预留不会自动退回。'); }
export class AIEngine {
  private readonly dependencies: Dependencies; private readonly previews = new Map<string, Prepared>(); private readonly pending = new Map<string, AbortController>();
  private readonly channel: BroadcastChannel | null; private readonly subscription; private closed = false;
  constructor(private readonly database: IdeaClipDB = db, overrides: Partial<Dependencies> = {}) {
    this.dependencies = { ...dependencies(), ...overrides };
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('ideaclip-ai-change');
    if (this.channel) this.channel.onmessage = () => this.cancelAll();
    this.subscription = liveQuery(() => getSettings(this.database)).subscribe({ next: settings => { if (!settings.aiEnabled) this.cancelAll(); }, error: () => this.cancelAll() });
  }
  cancelAll() { for (const controller of this.pending.values()) controller.abort(); this.previews.clear(); }
  close() { this.closed = true; this.cancelAll(); this.channel?.close(); this.subscription.unsubscribe(); }
  private async gate() { if (this.closed || !(await getSettings(this.database)).aiEnabled) throw new RequestFailure('disabled', 'AI 分析已关闭。'); }
  async preview(noteId: string, imageIds: string[], templateId?: string): Promise<Preview> {
    this.previews.clear();
    await this.gate();
    const template = await getSkill(templateId ?? (await preferences(this.database)).defaultId, this.database);
    const config = validateConfig((await this.database.aiConfig.get('manual')) ?? (() => { throw new RequestFailure('config', '请先在设置页配置并授权 AI 服务商。'); })());
    if (!(await this.dependencies.permission(config.endpoint))) throw new RequestFailure('permission', '尚未授权此服务商域名，请到设置页明确授权。');
    config.maxOutput = Math.min(config.maxOutput, template.maxOutput);
    const credential = await this.dependencies.credential(config.endpoint);
    if (config.auth === 'bearer' && !credential?.value) throw new RequestFailure('credential', '此端点没有可用 API Key，请到设置页填写。');
    if (imageIds.length > 3 || new Set(imageIds).size !== imageIds.length || (imageIds.length && !config.vision)) throw new RequestFailure('images', '仅已确认支持图像的模型可发送截图，最多选择 3 张。');
    const snapshot = await this.database.transaction('r', [this.database.notes, this.database.noteDrafts, this.database.screenshots], async () => {
      const note = await this.database.notes.get(noteId); if (!note || note.saveState !== 'saved') throw new RequestFailure('note', '请先保存灵感，再执行分析。');
      if ((await this.database.noteDrafts.get(noteId))?.hasChanges) throw new RequestFailure('note', '此笔记有未提交编辑，请先保存并核对内容。');
      const images: Blob[] = [];
      for (const id of imageIds) { if (!note.screenshotIds.includes(id)) throw new RequestFailure('images', '截图不属于当前笔记。'); const image = await this.database.screenshots.get(id); if (!image || image.blob.size > 2 * 1024 * 1024 || !['image/png', 'image/webp'].includes(image.blob.type)) throw new RequestFailure('images', '截图缺失、格式无效或超过 2 MiB。'); images.push(image.blob); }
      return { note, images };
    });
    const clean = (text: string) => { const safe = redact(text); return credential?.value ? safe.split(credential.value).join('[已移除凭据]') : safe; };
    const note = snapshot.note; const sourceUrl = note.url ? new URL(note.url) : null;
    if (sourceUrl) { sourceUrl.username = ''; sourceUrl.password = ''; for (const key of [...sourceUrl.searchParams.keys()]) if (/token|key|secret|password|credential|signature/i.test(key)) sourceUrl.searchParams.delete(key); }
    const input = { title: clean(note.title), content: clean(note.content), body: clean(note.body), url: clean(sourceUrl?.href ?? '') };
    const safeTemplate = JSON.parse(JSON.stringify(template), (_key, value) => typeof value === 'string' ? clean(value) : value) as Skill;
    const systemPrompt = skillSystem(safeTemplate);
    const source = JSON.stringify({ untrustedTemplatePreferences: { instructions: renderInstructions(safeTemplate, input), sections: safeTemplate.sections, scenario: safeTemplate.scenario, inputRequirements: safeTemplate.inputRequirements }, untrustedSource: input }); const bytes = new TextEncoder().encode(source).length;
    if (bytes > 200000) throw new RequestFailure('size', '待发送文本超过 200000 字节，请精简笔记后重新预览；未自动截断。');
    const inputTokensUpper = new TextEncoder().encode(systemPrompt + source).length + 4096 + imageIds.length * config.imageTokenAllowance;
    const costMicros = Math.max(1, Math.ceil(inputTokensUpper * config.inputUsdPerMillion + config.maxOutput * config.outputUsdPerMillion));
    const id = crypto.randomUUID(); const inputDigest = await digest(new Blob([source, ...snapshot.images]));
    const preview: Preview = { id, noteId, createdAt: this.dependencies.now(), config, ...input, imageIds: [...imageIds], inputTokensUpper, costMicros, inputDigest, revision: note.revision, template: safeTemplate, systemPrompt, requestText: source };
    this.previews.set(id, { preview: structuredClone(preview), images: snapshot.images, source, credentialVersion: credential?.version ?? null, templateSignature: skillSignature(template) });
    // Return a detached value: callers cannot change the internally confirmed payload.
    return structuredClone(preview);
  }
  async run(previewId: string, authority?: AutomaticAuthority): Promise<AnalysisResult> {
    const prepared = this.previews.get(previewId); this.previews.delete(previewId);
    if (!prepared) throw new RequestFailure('consent', '本次确认已使用或失效，请重新预览并确认费用。');
    const { preview, images, source } = prepared; const controller = new AbortController(); this.pending.set(previewId, controller);
    let usage: AIUsage | null = null; let reserved = false; let timer: ReturnType<typeof setTimeout> | undefined; let timedOut = false;
    const checkAuthority = async () => {
      let latestTemplate; try { latestTemplate = await getSkill(preview.template.id, this.database); } catch { throw new RequestFailure('template', '模板已删除或停用，请重新预览并确认。'); }
      if (skillSignature(latestTemplate) !== prepared.templateSignature) throw new RequestFailure('template', '模板版本已改变，本次授权失效；不会自动发送新版本。');
      if (!authority) return;
      if (!authority.manualRetry && prepared.credentialVersion !== authority.credentialVersion) throw new RequestFailure('consent', '自动授权的凭据已改变，请重新确认。');
      try { await authorizeAutomatic(preview, authority, this.database); }
      catch (error) { if (error instanceof QueueFailure) throw new RequestFailure(error.code, error.message); throw error; }
    };
    try {
      return await this.dependencies.lock(async () => {
        await this.gate(); active(controller.signal);
        await checkAuthority();
        const current = await this.database.aiConfig.get('manual');
        if (!current || current.version !== preview.config.version || this.dependencies.now() - preview.createdAt > 10 * 60000) throw new RequestFailure('stale', '配置已改变或确认超过 10 分钟，请重新预览。');
        const credential = await this.dependencies.credential(preview.config.endpoint);
        if ((credential?.version ?? null) !== prepared.credentialVersion || !(await this.dependencies.permission(preview.config.endpoint))) throw new RequestFailure('stale', '凭据或服务商授权已改变，请重新预览。');
        const note = await this.database.notes.get(preview.noteId);
        if (!note || note.revision !== preview.revision || (await this.database.noteDrafts.get(preview.noteId))?.hasChanges) throw new RequestFailure('stale', '笔记已改变，请重新核对发送内容。');
        const now = this.dependencies.now(); const day = new Date(now).toISOString().slice(0, 10);
        usage = { id: preview.id, noteId: preview.noteId, day, createdAt: now, model: preview.config.model, status: 'reserved', reservedMicros: preview.costMicros, estimatedInput: preview.inputTokensUpper, maxOutput: preview.config.maxOutput };
        await this.database.transaction('rw', [this.database.aiUsage, this.database.settings, this.database.aiConfig, this.database.aiTemplates, this.database.skillPreferences, ...(authority ? [this.database.autoPolicy, this.database.aiTasks, this.database.notes, this.database.noteDrafts, this.database.contentCaptures] : [])], async () => {
          await this.gate(); const latest = await this.database.aiConfig.get('manual'); if (latest?.version !== preview.config.version) throw new RequestFailure('stale', '配置已改变，请重新确认。');
          await checkAuthority();
          const rows = await this.database.aiUsage.where('day').equals(day).toArray(); const spent = rows.reduce((sum, row) => sum + row.reservedMicros, 0);
          if (spent + preview.costMicros > Math.floor(preview.config.dailyBudgetUsd * 1000000)) throw new RequestFailure('budget', '本次预留会超过每日预算，已阻止请求；请核对预算和单价。');
          await this.database.aiUsage.add(usage!);
        });
        reserved = true;
        await this.gate(); active(controller.signal);
        const parts: unknown[] = [{ type: 'text', text: source }];
        for (const image of images) { active(controller.signal); const bytes = new Uint8Array(await image.arrayBuffer()); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768)); parts.push({ type: 'image_url', image_url: { url: `data:${image.type};base64,${btoa(binary)}`, detail: 'low' } }); }
        await this.gate(); active(controller.signal);
        await checkAuthority();
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, preview.config.timeoutMs);
        const completion: Completion = await this.dependencies.transport.complete(preview.config, credential?.value ?? '', [{ role: 'system', content: preview.systemPrompt }, { role: 'user', content: images.length ? parts : source }], controller.signal);
        active(controller.signal); await this.gate();
        await checkAuthority();
        let parsed: unknown; try { parsed = JSON.parse(completion.text); } catch { throw new RequestFailure('schema', 'AI 内容不是有效 JSON；未保存报告。'); }
        let report; try { report = validateSkillReport(parsed, preview.template, [preview.title, preview.content, preview.body, preview.url].join('\n')); }
        catch { throw new RequestFailure('schema', '报告未通过 JSON Schema 或来源证据校验；未保存报告，请确认后手动重试。'); }
        if (credential?.value && Object.values(report.sections).some(claims => claims.some(claim => claim.text.includes(credential.value) || claim.evidence?.includes(credential.value)))) throw new RequestFailure('credential', '响应包含凭据，已丢弃，未保存或显示。');
        const createdAt = this.dependencies.now(); const analysis: Analysis = { id: preview.id, noteId: preview.noteId, createdAt, sourceUrl: preview.url, template: preview.template, ...(preview.template.id === BUSINESS_ID ? { content: markdown(validateReport(report), preview.config.model, createdAt), report: validateReport(report) } : { content: skillMarkdown(report, preview.template, preview.config.model, createdAt), skillReport: report }), model: preview.config.model, provider: preview.config.provider, endpointOrigin: new URL(preview.config.endpoint).origin, inputDigest: preview.inputDigest, inputRevision: preview.revision, imageCount: preview.imageIds.length };
        // A usage-log write failure must not discard a paid-for report. Its reservation remains.
        await this.database.aiUsage.update(preview.id, { status: 'succeeded', inputTokens: completion.inputTokens, outputTokens: completion.outputTokens }).catch(() => {});
        const saved = await this.save(analysis).then(() => true).catch(() => false); return { analysis, saved };
      }, controller.signal);
    } catch (error) {
      const code = timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : error instanceof RequestFailure ? error.code : 'validation';
      const existing: AIUsage | undefined | null = await this.database.aiUsage.get(preview.id).catch(() => undefined) ?? (reserved ? usage : null);
      const failure: AIUsage = { id: preview.id, noteId: preview.noteId, day: existing?.day ?? new Date(this.dependencies.now()).toISOString().slice(0, 10), createdAt: existing?.createdAt ?? this.dependencies.now(), model: preview.config.model, status: code === 'cancelled' ? 'cancelled' : 'failed', reservedMicros: existing?.reservedMicros ?? 0, estimatedInput: preview.inputTokensUpper, maxOutput: preview.config.maxOutput, errorCode: code };
      await this.database.aiUsage.put({ ...existing, ...failure }).catch(() => {});
      if (timedOut) throw new RequestFailure('timeout', 'AI 请求超时，客户端已取消；服务端可能仍产生费用，请确认后手动重试。');
      if (controller.signal.aborted) throw new RequestFailure('cancelled', 'AI 已关闭或请求已取消，等待任务已停止；已发送请求仍可能计费。');
      if (error instanceof RequestFailure) throw error;
      throw new RequestFailure('validation', '分析结果校验或本地处理失败，原笔记未更改；请核对配置和报告格式后手动重试。');
    } finally { if (timer) clearTimeout(timer); this.pending.delete(previewId); }
  }
  async save(analysis: Analysis) {
    if (analysis.skillReport && analysis.template) validateSkillReport(analysis.skillReport, analysis.template);
    else if (analysis.report) { validateReport(analysis.report); if (analysis.template) validateSkillReport(analysis.report, analysis.template); } else throw new Error('没有可保存的结构化报告。');
    await this.database.transaction('rw', [this.database.notes, this.database.analyses], async () => {
      if (!await this.database.notes.get(analysis.noteId)) throw new Error('原笔记已删除，无法保存报告，可复制或导出本页内容。');
      const previous = await this.database.analyses.get(analysis.id);
      if (previous) { if (JSON.stringify(previous) !== JSON.stringify(analysis)) throw new Error('报告 ID 冲突。'); return; }
      await this.database.analyses.add(analysis);
    });
  }
}
