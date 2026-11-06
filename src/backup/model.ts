import { noteDefaults } from '../inspiration/model';
import { httpUrl } from '../collection/model';

export const TABLES = ['notes', 'noteDrafts', 'screenshots', 'contentCaptures', 'settings', 'analyses', 'projects'] as const;
export type BackupTable = typeof TABLES[number];
export type Row = Record<string, unknown> & { id: string };
export interface Descriptor { name: string; size: number; sha256: string }
export interface Manifest { format: 'IdeaClip'; formatVersion: 1; databaseVersion: number; createdAt: string; counts: Record<BackupTable, number>; entries: Descriptor[] }
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
// Allowlist every field. Unknown configuration/credential fields never enter a backup or restored row.
export function portableRow(table: BackupTable, value: unknown): Row {
  const r = object(value); const key = id(r.id);
  const dates = () => ({ createdAt: timestamp(r.createdAt), updatedAt: timestamp(r.updatedAt) });
  switch (table) {
    case 'notes': return { id: key, ...fields(r), tags: texts(r.tags), saveState: enumeration(r.saveState ?? 'saved', ['saved', 'draft']), revision: number(r.revision ?? 0), sourceTabId: null, sourcePageUrl: url(r.sourcePageUrl ?? r.url ?? ''), ...dates() };
    case 'noteDrafts': {
      const input = object(r.input);
      if (!text(r.entryKey, 10000).trim()) throw new Error('草稿入口无效。');
      return { id: key, entryKey: txt(r.entryKey), input: { ...fields(input), tagsText: txt(input.tagsText) }, baseRevision: r.baseRevision == null ? null : number(r.baseRevision), sourceTabId: null, sourcePageUrl: url(r.sourcePageUrl ?? ''), pendingCaptureId: r.pendingCaptureId == null ? null : id(r.pendingCaptureId), hasChanges: bool(r.hasChanges), ...dates() };
    }
    case 'screenshots': return { id: key, kind: enumeration(r.kind, ['visible', 'region']), width: number(r.width), height: number(r.height), originalBytes: number(r.originalBytes), sourceTabId: 0, sourceUrl: url(r.sourceUrl), sourceTitle: txt(r.sourceTitle), createdAt: number(r.createdAt) };
    case 'contentCaptures': return { id: key, originalUrl: url(r.originalUrl ?? r.sourceUrl), sourceUrl: url(r.sourceUrl), platform: enumeration(r.platform, ['x', 'github', 'wechat', 'article', 'web']), siteName: txt(r.siteName), title: txt(r.title), author: nullable(r.author), publishedAt: nullable(r.publishedAt), text: txt(r.text), images: array(r.images).map(value => { const image = object(value); return { url: url(image.url), description: txt(image.description), kind: enumeration(image.kind, ['image', 'video-cover']) }; }), links: array(r.links).map(value => { const link = object(value); return { url: url(link.url), text: txt(link.text) }; }), githubLinks: array(r.githubLinks).map(value => url(value)), collectedAt: number(r.collectedAt), status: enumeration(r.status, ['readable', 'partial', 'unavailable']), warnings: texts(r.warnings), sourceTabId: null, screenshotIds: ids(r.screenshotIds), noteId: r.noteId == null ? null : id(r.noteId), updatedAt: number(r.updatedAt), textOrigin: enumeration(r.textOrigin, ['extracted', 'manual', 'edited', 'empty']) };
    case 'settings': if (key !== 'general') throw new Error('未知设置项，拒绝导出或恢复。'); return { id: 'general', aiEnabled: bool(r.aiEnabled) };
    case 'analyses': return { id: key, noteId: id(r.noteId), createdAt: number(r.createdAt), content: txt(r.content) };
    case 'projects': return { id: key, title: txt(r.title), noteIds: ids(r.noteIds), ...dates() };
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
  if (table === 'projects') add('notes', row.noteIds);
  return out;
}
export function parseManifest(value: unknown): Manifest {
  const r = object(value);
  if (r.format !== 'IdeaClip' || r.formatVersion !== 1 || typeof r.databaseVersion !== 'number' || !Number.isInteger(r.databaseVersion) || r.databaseVersion < 1 || r.databaseVersion > 5) throw new Error('备份格式或数据库版本不兼容，请使用支持该版本的 IdeaClip。');
  const createdAt = text(r.createdAt, 100); if (!Number.isFinite(Date.parse(createdAt))) throw new Error('备份创建时间无效。');
  const counts = emptyCounts(); const source = object(r.counts); let total = 0;
  for (const table of TABLES) { counts[table] = number(source[table]); total += counts[table]; }
  if (total > 100000) throw new Error('备份记录超过 10 万条安全上限。');
  const entries = array(r.entries).map(value => { const e = object(value); const hash = text(e.sha256, 64); if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('备份校验和无效。'); return { name: text(e.name, 96), size: number(e.size), sha256: hash }; });
  return { format: 'IdeaClip', formatVersion: 1, databaseVersion: r.databaseVersion, createdAt, counts, entries };
}
