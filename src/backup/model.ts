import { portableWorkflow } from '../research/workflow/model';
import { portableOnline } from '../research/online/backup';
import { FIELDS } from '../incubation/model';
import { validatePlan } from '../research/model';
import { validateProject } from '../incubation/repository';
import type { Project } from '../storage';
import { validateComparison, comparisonMarkdown, selectedIds, type Source } from '../comparison/model';
import { validateSkill, validateSkillReport, skillMarkdown, type Skill, type SkillReport } from '../skills/model';
import { noteDefaults } from '../inspiration/model';
import { httpUrl } from '../collection/model';
import { assessQuality, paragraphMap, type TextQuality } from '../collection/quality';
import { markdown, validateReport, type Report } from '../ai/report';

export const TABLES = ['notes', 'noteDrafts', 'screenshots', 'contentCaptures', 'settings', 'analyses', 'projects', 'aiTemplates', 'comparisonReports', 'researchPlans', 'researchSources', 'researchRuns', 'researchReports', 'researchWorkflows'] as const;
export type BackupTable = typeof TABLES[number];
export type Row = Record<string, unknown> & { id: string };
export interface Descriptor { name: string; size: number; sha256: string }
export interface Manifest { format: 'IdeaClip'; formatVersion: 1 | 2 | 3 | 4 | 5 | 6; databaseVersion: number; createdAt: string; counts: Record<BackupTable, number>; entries: Descriptor[] }
export interface Summary { createdAt: string; counts: Record<BackupTable, number>; bytes: number }
export const emptyCounts = () => Object.fromEntries(TABLES.map(table => [table, 0])) as Record<BackupTable, number>;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('元数据对象无效。');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 1_000_000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('元数据文本类型或长度无效。');
  return value;
}
export function redact(value: string) {
  return value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[已移除私钥]')
    .replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|AKIA[A-Z0-9]{16})\b/g, '[已移除凭据]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi, 'Bearer [已移除凭据]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password)\s*["']?\s*[=:]\s*["']?)[^\s"'&,;]+/gi, '$1[已移除凭据]');
}
const txt = (value: unknown, fallback = '') => redact(text(value ?? fallback));
function number(value: unknown) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('元数据数字无效。'); return value; }
function timestamp(value: unknown) { const result = number(value); if (!Number.isFinite(new Date(result).getTime())) throw new Error('记录时间超出有效范围。'); return result; }
function bool(value: unknown) { if (typeof value !== 'boolean') throw new Error('元数据布尔值无效。'); return value; }
function id(value: unknown) { const result = text(value, 500); if (!result || /[\u0000-\u001f]/.test(result)) throw new Error('记录 ID 无效。'); return result; }
function enumeration<T extends string>(value: unknown, values: readonly T[]): T { if (!values.includes(value as T)) throw new Error('元数据枚举值无效。'); return value as T; }
function array(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 10000) throw new Error('元数据数组无效。'); return value; }
function ids(value: unknown = []) { return array(value).map(id); }
function texts(value: unknown = []) { return array(value).map(item => txt(item)); }
function url(value: unknown = '') {
  const source = text(value, 10000); if (!source) return '';
  const safe = httpUrl(source); if (!safe) throw new Error('备份包含不安全的链接。');
  const parsed = new URL(safe);
  let changed = false;
  for (const key of [...parsed.searchParams.keys()]) if (/token|secret|password|api.?key|authorization|credential|signature/i.test(key)) { parsed.searchParams.delete(key); changed = true; }
  return changed ? parsed.href : source;
}
const nullable = (value: unknown) => value == null ? null : txt(value);
function fields(raw: Record<string, unknown>) {
  const d: Record<string, unknown> = { ...noteDefaults(typeof raw.url === 'string' ? raw.url : ''), ...raw };
  return { title: txt(d.title), url: url(d.url), platform: enumeration(d.platform, ['x', 'github', 'wechat', 'article', 'web']), author: nullable(d.author), publishedAt: nullable(d.publishedAt), content: txt(d.content), body: txt(d.body), researchQuestions: txt(d.researchQuestions), category: txt(d.category), screenshotIds: ids(d.screenshotIds), captureIds: ids(d.captureIds), favorite: bool(d.favorite), status: enumeration(d.status ?? 'inbox', ['inbox', 'incubating', 'archived']) };
}
function captureMetadata(raw: Record<string, unknown>, safeText: string, safeUrl: string) {
  if (raw.quality === undefined && raw.provenance === undefined) return {};
  const q = raw.quality === undefined ? null : object(raw.quality);
  if (q && (q.version !== 1 || !['complete', 'partial', 'unreadable'].includes(String(q.state)))) throw new Error('正文质量版本或状态无效。');
  const methods: TextQuality['method'][] = ['readability', 'semantic', 'x', 'github', 'wechat', 'manual'];
  const method = q ? enumeration(q.method, methods) : 'manual';
  const metrics = q ? object(q.metrics) : null;
  const density = metrics?.linkDensity ?? 0; const hidden = metrics?.hiddenRemoved ?? 0;
  if (typeof density !== 'number' || !Number.isFinite(density) || density < 0 || density > 1 || typeof hidden !== 'number' || !Number.isSafeInteger(hidden) || hidden < 0 || hidden > 50000) throw new Error('正文质量指标无效。');
  // Rebuild bounded, redacted snapshot positions; imported metadata never grants
  // permission to send automatically, and live DOM paths are not portable.
  if (raw.provenance !== undefined && object(raw.provenance).version !== 1) throw new Error('段落来源版本无效。');
  return { quality: assessQuality({ text: safeText, url: safeUrl, method, platform: enumeration(raw.platform, ['x', 'github', 'wechat', 'article', 'web'] as const), linkCharacters: density * safeText.length, hiddenRemoved: hidden, incomplete: q?.state !== 'complete' }), provenance: paragraphMap(safeText, safeUrl, 'backup') };
}
// Allowlist every field. Unknown configuration/credential fields never enter a backup or restored row.
export function portableRow(table: BackupTable, value: unknown): Row {
  const r = object(value); const key = id(r.id);
  const dates = () => ({ createdAt: timestamp(r.createdAt), updatedAt: timestamp(r.updatedAt) });
  switch (table) {
    case 'researchWorkflows': return portableWorkflow(r,redact) as unknown as Row;
    case 'researchSources': case 'researchRuns': case 'researchReports': return portableOnline(table,r,redact,url);
    case 'researchPlans': {
      const p=validatePlan(r);
      const versions=p.versions.map(v=>({...v,data:{...v.data,title:redact(v.data.title),objective:redact(v.data.objective),notes:redact(v.data.notes),sections:Object.fromEntries(Object.entries(v.data.sections).map(([k,s])=>[k,redact(s)])),refs:v.data.refs.map(ref=>({...ref,title:redact(ref.title)})),sources:v.data.sources.map(s=>({...s,title:redact(s.title),url:url(s.url),excerpt:redact(s.excerpt),evidence:redact(s.evidence),notes:redact(s.notes)}))}}));
      return validatePlan({...p,title:versions.at(-1)!.data.title,versions}) as unknown as Row;
    }
    case 'comparisonReports': {
      const sources = array(r.sources).map(value => {const x=object(value);const hash=text(x.hash,64);if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('来源摘要无效。'); return {id:id(x.id),revision:number(x.revision),updatedAt:timestamp(x.updatedAt),hash,title:txt(x.title),url:url(x.url),content:txt(x.content),body:txt(x.body),quality:txt(x.quality)};});
      selectedIds(sources.map(s=>s.id)); if(new Set(sources.map(s=>s.id)).size!==sources.length)throw new Error('来源重复。');
      const report=validateComparison(JSON.parse(JSON.stringify(r.comparison),(_k,v)=>typeof v==='string'?redact(v):v),sources as Source[]);
      return {id:key,noteId:sources[0].id,createdAt:timestamp(r.createdAt),model:txt(r.model),sources,comparison:report,content:comparisonMarkdown(report,sources)};
    }
    case 'aiTemplates': {
      const skill = validateSkill(r);
      const safe = JSON.parse(JSON.stringify(skill), (_key, value) => typeof value === 'string' ? redact(value) : value);
      return { ...validateSkill(safe), enabled: false };
    }
    case 'notes': return { id: key, ...fields(r), tags: texts(r.tags), saveState: enumeration(r.saveState ?? 'saved', ['saved', 'draft']), revision: number(r.revision ?? 0), sourceTabId: null, sourcePageUrl: url(r.sourcePageUrl ?? r.url ?? ''), ...dates() };
    case 'noteDrafts': {
      const input = object(r.input);
      if (!text(r.entryKey, 10000).trim()) throw new Error('草稿入口无效。');
      return { id: key, entryKey: txt(r.entryKey), input: { ...fields(input), tagsText: txt(input.tagsText) }, baseRevision: r.baseRevision == null ? null : number(r.baseRevision), sourceTabId: null, sourcePageUrl: url(r.sourcePageUrl ?? ''), pendingCaptureId: r.pendingCaptureId == null ? null : id(r.pendingCaptureId), hasChanges: bool(r.hasChanges), ...dates() };
    }
    case 'screenshots': return { id: key, kind: enumeration(r.kind, ['visible', 'region']), width: number(r.width), height: number(r.height), originalBytes: number(r.originalBytes), sourceTabId: 0, sourceUrl: url(r.sourceUrl), sourceTitle: txt(r.sourceTitle), createdAt: number(r.createdAt) };
    case 'contentCaptures': { const capture = { id: key, originalUrl: url(r.originalUrl ?? r.sourceUrl), sourceUrl: url(r.sourceUrl), platform: enumeration(r.platform, ['x', 'github', 'wechat', 'article', 'web']), siteName: txt(r.siteName), title: txt(r.title), author: nullable(r.author), publishedAt: nullable(r.publishedAt), text: txt(r.text), images: array(r.images).map(value => { const image = object(value); return { url: url(image.url), description: txt(image.description), kind: enumeration(image.kind, ['image', 'video-cover']) }; }), links: array(r.links).map(value => { const link = object(value); return { url: url(link.url), text: txt(link.text) }; }), githubLinks: array(r.githubLinks).map(value => url(value)), collectedAt: number(r.collectedAt), status: enumeration(r.status, ['readable', 'partial', 'unavailable']), warnings: texts(r.warnings), sourceTabId: null, screenshotIds: ids(r.screenshotIds), noteId: r.noteId == null ? null : id(r.noteId), updatedAt: number(r.updatedAt), textOrigin: enumeration(r.textOrigin, ['extracted', 'manual', 'edited', 'empty']) }; return { ...capture, ...captureMetadata(r, capture.text, capture.sourceUrl) }; }
    case 'settings': if (key !== 'general') throw new Error('未知设置项，拒绝导出或恢复。'); return { id: 'general', aiEnabled: bool(r.aiEnabled) };
    case 'analyses': {
      const result: Row = { id: key, noteId: id(r.noteId), createdAt: timestamp(r.createdAt), content: txt(r.content) };
      if (r.template !== undefined) result.template = validateSkill(JSON.parse(JSON.stringify(validateSkill(r.template)), (_key, value) => typeof value === 'string' ? redact(value) : value));
      if (r.skillReport !== undefined) {
        if (!result.template || r.report !== undefined) throw new Error('模板报告缺少定义或同时含冲突的报告结构。');
        const report = structuredClone(validateSkillReport(r.skillReport, result.template as Skill));
        for (const claims of Object.values(report.sections)) for (const c of claims) { c.text = redact(c.text); if (c.evidence) c.evidence = redact(c.evidence); }
        result.skillReport = validateSkillReport(report, result.template as Skill);
      }
      if (r.report !== undefined) {
        if (result.template && (result.template as Skill).id !== 'builtin-business') throw new Error('旧报告结构与模板身份不一致。');
        const report = validateReport(r.report);
        const portable = structuredClone(report);
        for (const claims of Object.values(portable.sections)) for (const claim of claims) { claim.text = redact(claim.text); if (claim.evidence) claim.evidence = redact(claim.evidence); }
        result.report = validateReport(portable);
      }
      if (r.sourceUrl !== undefined) result.sourceUrl = url(r.sourceUrl);
      if (r.model !== undefined) result.model = redact(text(r.model, 150));
      if (r.provider !== undefined) result.provider = enumeration(r.provider, ['openai', 'deepseek', 'custom']);
      if (r.endpointOrigin !== undefined) result.endpointOrigin = new URL(url(r.endpointOrigin)).origin;
      if (r.inputDigest !== undefined) { if (!/^[a-f0-9]{64}$/.test(text(r.inputDigest, 64))) throw new Error('分析输入摘要无效。'); result.inputDigest = r.inputDigest; }
      if (r.inputRevision !== undefined) result.inputRevision = number(r.inputRevision);
      if (r.imageCount !== undefined) { result.imageCount = number(r.imageCount); if ((result.imageCount as number) > 3) throw new Error('报告图像数量无效。'); }
      // Regenerate Markdown from redacted structured fields so escaping cannot hide credentials.
      if (result.report) result.content = markdown(result.report as Report, result.model as string || '模型未记录', result.createdAt as number);
      if (result.skillReport) result.content = skillMarkdown(result.skillReport as SkillReport, result.template as Skill, result.model as string || '模型未记录', result.createdAt as number);
      return result;
    }
    case 'projects': {
      const base={id:key,title:txt(r.title),noteIds:ids(r.noteIds),...dates()};
      if(r.revision===undefined)return base;
      const project={...base,...Object.fromEntries(Object.keys(FIELDS).map(k=>[k,txt(r[k])])),stage:r.stage,revision:r.revision,
        ...(r.researchRisks!==undefined?{researchRisks:txt(r.researchRisks)}:{}),...(r.researchOrigin?{researchOrigin:{studyId:id(object(r.researchOrigin).studyId),reportId:id(object(r.researchOrigin).reportId),reportHash:text(object(r.researchOrigin).reportHash,64)}}:{}),refs:array(r.refs).map(x=>{const a=object(x);return {kind:a.kind,id:id(a.id),title:txt(a.title)};}),
        history:array(r.history).map(x=>{const a=object(x);return {id:id(a.id),from:a.from,to:a.to,at:timestamp(a.at)};}),
        tasks:array(r.tasks).map(x=>{const a=object(x);return {id:id(a.id),title:txt(a.title),priority:a.priority,status:a.status,due:text(a.due,10),notes:txt(a.notes),noteIds:ids(a.noteIds),milestone:txt(a.milestone),acceptance:txt(a.acceptance),reviewed:bool(a.reviewed),...(a.importKey?{importKey:id(a.importKey)}:{})};}),
        plans:array(r.plans).map(x=>{const a=object(x);const report=object(a.report);const sections=object(report.sections);const safeSections=Object.fromEntries(Object.entries(sections).map(([k,items])=>[k,array(items).map(x=>{const c=object(x);return {kind:c.kind,text:txt(c.text),evidence:c.evidence===null?null:txt(c.evidence)};})]));return {id:id(a.id),createdAt:timestamp(a.createdAt),model:txt(a.model),report:{schemaVersion:report.schemaVersion,sections:safeSections},imported:ids(a.imported),...(a.templateId!==undefined?{templateId:text(a.templateId,100),templateVersion:txt(a.templateVersion),projectRevision:number(a.projectRevision)}:{}),...(a.sources!==undefined?{sources:array(a.sources).map(x=>{const s=object(x);return {id:id(s.id),title:txt(s.title),revision:number(s.revision),hash:text(s.hash,64)};})}:{})};})};
      return validateProject(project as unknown as Project) as unknown as Row;
    }
  }
}
export function references(table: BackupTable, row: Row): [BackupTable, string][] {
  const out: [BackupTable, string][] = [];
  const add = (target: BackupTable, values: unknown) => { for (const value of (values ?? []) as string[]) out.push([target, value]); };
  if (table === 'notes' || table === 'noteDrafts') {
    const input = table === 'notes' ? row : object(row.input);
    add('screenshots', input.screenshotIds); add('contentCaptures', input.captureIds);
    if (table === 'noteDrafts' && row.pendingCaptureId) out.push(['contentCaptures', row.pendingCaptureId as string]);
  }
  if (table === 'contentCaptures') { add('screenshots', row.screenshotIds); if (row.noteId) out.push(['notes', row.noteId as string]); }
  if (table === 'analyses') out.push(['notes', row.noteId as string]);
  // Project sources are soft references: missing notes must not block backup.
  return out;
}
export function parseManifest(value: unknown): Manifest {
  const r = object(value);
  if (r.format !== 'IdeaClip' || ![1, 2, 3, 4, 5, 6].includes(r.formatVersion as number) || typeof r.databaseVersion !== 'number' || !Number.isInteger(r.databaseVersion) || r.databaseVersion < 1 || r.databaseVersion > 14) throw new Error('备份格式或数据库版本不兼容，请使用支持该版本的 IdeaClip。');
  const createdAt = text(r.createdAt, 100); if (!Number.isFinite(Date.parse(createdAt))) throw new Error('备份创建时间无效。');
  const counts = emptyCounts(); const source = object(r.counts); let total = 0;
  for (const table of TABLES) { counts[table] = table==='researchWorkflows'&&Number(r.formatVersion)<=5&&r.databaseVersion<=13&&source[table]===undefined?0:['researchSources','researchRuns','researchReports'].includes(table) && Number(r.formatVersion)<=4 && r.databaseVersion<=12 && source[table]===undefined ? 0 : table === 'researchPlans' && Number(r.formatVersion) <= 3 && r.databaseVersion <= 11 && source[table] === undefined ? 0 : table === 'comparisonReports' && Number(r.formatVersion) <= 2 && r.databaseVersion <= 9 && source[table] === undefined ? 0 : table === 'aiTemplates' && r.formatVersion === 1 && r.databaseVersion <= 8 && source[table] === undefined ? 0 : number(source[table]); total += counts[table]; }
  if (counts.aiTemplates > 105) throw new Error('备份模板数量超过安全上限。');
  if (total > 100000) throw new Error('备份记录超过 10 万条安全上限。');
  const entries = array(r.entries).map(value => { const e = object(value); const hash = text(e.sha256, 64); if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('备份校验和无效。'); return { name: text(e.name, 96), size: number(e.size), sha256: hash }; });
  return { format: 'IdeaClip', formatVersion: r.formatVersion as 1 | 2 | 3 | 4 | 5 | 6, databaseVersion: r.databaseVersion, createdAt, counts, entries };
}
