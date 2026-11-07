import Dexie from 'dexie';
import { announceAIChange } from '../ai/events';
import { pauseAutomatic } from '../automation/policy';
import { db, type IdeaClipDB, type Note } from '../storage';
import type { NoteDraft } from '../inspiration/model';
import { cardOf, searchOf, draftCardOf } from '../library/projections';
import { TABLES, emptyCounts, object, portableRow, parseManifest, references, type BackupTable, type Row, type Manifest, type Summary } from './model';
import { readZip, writeZip, digest, crc32, MAX_ENTRY, MAX_ARCHIVE, MAX_ENTRIES, type ZipEntry } from './zip';

export interface OperationOptions { signal?: AbortSignal; progress?: (message: string) => void }
const check = (options: OperationOptions) => { if (options.signal?.aborted) throw new Error('操作已取消；原数据库未更改。'); };
export function friendlyError(error: unknown) {
  if (error instanceof Error && /Quota|空间|storage.*full/i.test(error.name + error.message)) return '本地存储空间不足。请释放浏览器或磁盘空间后重试，原数据库未更改。';
  return error instanceof Error ? error.message : '本地备份操作失败，请重试。';
}
function chunks(rows: Row[], table: BackupTable, entries: ZipEntry[], sequence: { value: number }) {
  const blob = new Blob([JSON.stringify(rows)], { type: 'application/json' });
  if (blob.size > MAX_ENTRY) {
    if (rows.length < 2) throw new Error('单条记录超过 8 MiB 安全上限。');
    const middle = Math.floor(rows.length / 2); chunks(rows.slice(0, middle), table, entries, sequence); chunks(rows.slice(middle), table, entries, sequence); return;
  }
  entries.push({ name: `data/${table}/${String(sequence.value++).padStart(6, '0')}.json`, blob });
}
export async function exportBackup(database = db, options: OperationOptions = {}): Promise<Blob> {
  const entries: ZipEntry[] = []; const counts = emptyCounts(); let imageIndex = 0; let totalBytes = 0;
  const keys = new Set<string>(); const linked: string[] = [];
  // All authoritative stores are locked together: metadata and Blob handles describe one snapshot.
  await database.transaction('r', TABLES.map(name => database.table(name)), async () => {
    for (const table of TABLES) {
      let last: string | undefined; const sequence = { value: 0 };
      for (;;) {
        check(options); const source = database.table<Row>(table);
        const rows: Row[] = await (last ? source.where('id').above(last) : source.toCollection()).limit(16).toArray();
        if (!rows.length) break;
        const previousEntryCount = entries.length;
        const portable = rows.map(row => {
          const result = portableRow(table, row);
          keys.add(`${table}:${row.id}`);
          for (const [target, id] of references(table, result)) linked.push(`${target}:${id}`);
          if (keys.size > 100000 || linked.length > 500000) throw new Error('备份超过 10 万条记录或 50 万条关联安全上限。');
          if (table === 'screenshots') {
            const blob = row.blob as Blob;
            if (!(blob instanceof Blob) || !blob.size || !['image/png', 'image/webp'].includes(blob.type)) throw new Error('存在无效截图，备份已停止。');
            const name = `images/${String(imageIndex++).padStart(6, '0')}.${blob.type === 'image/png' ? 'png' : 'webp'}`;
            entries.push({ name, blob }); result.image = name;
          }
          return result;
        });
        chunks(portable, table, entries, sequence); counts[table] += rows.length; last = rows.at(-1)!.id;
        for (const entry of entries.slice(previousEntryCount)) { totalBytes += entry.blob.size; if (entry.blob.size > MAX_ENTRY) throw new Error('单项数据超过 8 MiB 安全上限。'); }
        if (totalBytes > MAX_ARCHIVE || entries.length >= MAX_ENTRIES) throw new Error('备份超过 512 MiB 或 10000 个文件安全上限。');
      }
    }
  });
  if (linked.some(key => !keys.has(key))) throw new Error('当前数据存在缺失的笔记、采集或截图关联，无法生成可完整恢复的备份。原数据未更改。');
  if (Object.values(counts).reduce((a, b) => a + b, 0) > 100000) throw new Error('备份超过 10 万条记录安全上限。');
  const manifest: Manifest = { format: 'IdeaClip', formatVersion: 3, databaseVersion: database.verno, createdAt: new Date().toISOString(), counts, entries: [] };
  for (const [index, entry] of entries.entries()) { check(options); options.progress?.(`正在校验备份 ${index + 1}/${entries.length}`); manifest.entries.push({ name: entry.name, size: entry.blob.size, sha256: await digest(entry.blob) }); }
  entries.push({ name: 'manifest.json', blob: new Blob([JSON.stringify(manifest)]) });
  return writeZip(entries, completed => { check(options); options.progress?.(`正在封装 ZIP ${completed}/${entries.length}`); });
}

const STAGE_PREFIX = 'ideaclip-restore-stage-';
export class PreparedBackup {
  private consumed = false;
  constructor(readonly summary: Summary, readonly stage: Dexie) {}
  assertUsable() { if (this.consumed) throw new Error('此预览已失效，请重新选择备份。'); }
  async dispose() { this.consumed = true; await this.stage.delete(); }
}
// Only remove inactive staging databases. Web Locks keep other settings tabs' previews intact.
export async function cleanAbandonedStages() {
  if (!globalThis.navigator?.locks) return;
  for (const name of await Dexie.getDatabaseNames()) if (name.startsWith(STAGE_PREFIX)) {
    await navigator.locks.request(name, { ifAvailable: true }, async lock => { if (lock) await Dexie.delete(name); });
  }
}
const releases = new WeakMap<PreparedBackup, () => void>();
async function pinStage(name: string) {
  if (!globalThis.navigator?.locks) return () => {};
  let release!: () => void; let ready!: () => void; const entered = new Promise<void>(resolve => { ready = resolve; });
  void navigator.locks.request(name, async () => { ready(); await new Promise<void>(resolve => { release = resolve; }); });
  await entered; return () => release();
}
export async function discardBackup(prepared: PreparedBackup) { releases.get(prepared)?.(); releases.delete(prepared); await prepared.dispose(); }
async function imageCheck(blob: Blob, name: string) {
  const b = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const png = name.endsWith('.png');
  if (png ? b.length < 24 || ![137,80,78,71,13,10,26,10].every((n, i) => b[i] === n) : b.length < 12 || String.fromCharCode(...b.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...b.slice(8, 12)) !== 'WEBP') throw new Error('截图文件签名无效。');
  const view = new DataView(b.buffer); let width = 0; let height = 0;
  if (png && String.fromCharCode(...b.slice(12, 16)) === 'IHDR') { width = view.getUint32(16); height = view.getUint32(20); }
  if (!png && b.length >= 30 && view.getUint32(4, true) + 8 === blob.size) {
    const kind = String.fromCharCode(...b.slice(12, 16));
    if (kind === 'VP8X') { width = 1 + b[24] + (b[25] << 8) + (b[26] << 16); height = 1 + b[27] + (b[28] << 8) + (b[29] << 16); }
    if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
    if (kind === 'VP8L' && b[20] === 0x2f) { const bits = view.getUint32(21, true); width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff); }
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) throw new Error('截图尺寸超过安全上限或图片头损坏。');
  const image = new Blob([blob], { type: png ? 'image/png' : 'image/webp' });
  if (typeof createImageBitmap === 'function') { const bitmap = await createImageBitmap(image); try { if (bitmap.width !== width || bitmap.height !== height) throw new Error('图片解码尺寸不一致。'); } finally { bitmap.close(); } }
  return { image, width, height };
}
export async function prepareBackup(file: Blob, options: OperationOptions = {}): Promise<PreparedBackup> {
  const stage = new Dexie(STAGE_PREFIX + crypto.randomUUID());
  stage.version(1).stores(Object.fromEntries(TABLES.map(table => [table, table === 'noteDrafts' ? 'id, &entryKey' : 'id'])));
  const release = await pinStage(stage.name);
  try {
    const entries = await readZip(file); const byName = new Map(entries.map(entry => [entry.name, entry]));
    const manifestEntry = byName.get('manifest.json'); if (!manifestEntry) throw new Error('缺少备份清单。');
    if (crc32(new Uint8Array(await manifestEntry.blob.arrayBuffer())) !== manifestEntry.crc) throw new Error('备份清单损坏。');
    const manifest = parseManifest(JSON.parse(await manifestEntry.blob.text()));
    if (manifest.entries.length + 1 !== entries.length || new Set(manifest.entries.map(entry => entry.name)).size !== manifest.entries.length) throw new Error('备份文件列表不完整或重复。');
    const imageUses = new Set<string>(); const counts = emptyCounts(); const keys = new Set<string>(); let completed = 0;
    await stage.open();
    for (const descriptor of manifest.entries) {
      check(options); options.progress?.(`正在校验文件 ${++completed}/${manifest.entries.length}`);
      const entry = byName.get(descriptor.name);
      if (!entry || descriptor.name === 'manifest.json' || entry.blob.size !== descriptor.size || crc32(new Uint8Array(await entry.blob.arrayBuffer())) !== entry.crc || await digest(entry.blob) !== descriptor.sha256) throw new Error('备份内容损坏或校验和不一致。');
    }
    for (const entry of entries) {
      if (!entry.name.startsWith('data/')) continue;
      check(options); const table = entry.name.split('/')[1] as BackupTable;
      const values: unknown = JSON.parse(await entry.blob.text()); if (!Array.isArray(values) || values.length > 10000) throw new Error('元数据记录格式无效。');
      for (const value of values) {
        check(options); const row = portableRow(table, value);
        if (table === 'screenshots') {
          const name = object(value).image; if (typeof name !== 'string' || !/^images\/\d{6}\.(png|webp)$/.test(name) || imageUses.has(name)) throw new Error('图片关联无效或重复。');
          const image = byName.get(name); if (!image) throw new Error('备份缺少关联截图。'); imageUses.add(name);
          const checked = await imageCheck(image.blob, name);
          if (checked.width !== row.width || checked.height !== row.height) throw new Error('图片尺寸与元数据不一致。');
          row.blob = checked.image;
        }
        const key = `${table}:${row.id}`; if (keys.has(key)) throw new Error('备份包含重复记录 ID。'); keys.add(key);
        await stage.table(table).add(row); counts[table]++;
        if (keys.size > 100000) throw new Error('备份超过记录安全上限。');
      }
    }
    if (imageUses.size !== entries.filter(entry => entry.name.startsWith('images/')).length || TABLES.some(table => counts[table] !== manifest.counts[table])) throw new Error('备份记录数或图片数量不一致。');
    let referenceCount = 0;
    for (const table of TABLES) await eachStage(stage, table, async rows => {
      check(options);
      for (const row of rows) for (const [target, id] of references(table, row)) {
        if (++referenceCount > 500000) throw new Error('备份关联超过 50 万条安全上限。');
        if (!keys.has(`${target}:${id}`)) throw new Error('备份存在缺失的笔记、采集或截图关联。');
      }
    });
    check(options);
    const prepared = new PreparedBackup({ createdAt: manifest.createdAt, counts, bytes: file.size }, stage); releases.set(prepared, release); return prepared;
  } catch (error) { await stage.delete().catch(() => {}); release(); throw new Error(friendlyError(error)); }
}
async function stageChunk(stage: Dexie, table: BackupTable, last?: string): Promise<Row[]> {
  // Foreign-database work must not accidentally join the destination's atomic transaction.
  return Dexie.ignoreTransaction(() => stage.transaction('r', stage.table(table), () => (last ? stage.table<Row>(table).where('id').above(last) : stage.table<Row>(table).toCollection()).limit(16).toArray()));
}
async function eachStage(stage: Dexie, table: BackupTable, action: (rows: Row[]) => Promise<void>, keepAlive = false): Promise<void> {
  let last: string | undefined;
  for (;;) { const pending = stageChunk(stage, table, last); const rows = await (keepAlive ? Dexie.waitFor(pending) : pending); if (!rows.length) break; await action(rows); last = rows.at(-1)!.id; }
}
function node(table: BackupTable, id: string) { return `${table === 'notes' || table === 'noteDrafts' ? 'note' : table}:${id}`; }
export interface RestoreResult { succeeded: number; skipped: number; failed: number; duplicates: number; conflicts: number }
export async function restoreBackup(prepared: PreparedBackup, mode: 'merge' | 'replace', database: IdeaClipDB = db, options: OperationOptions & { confirmed?: boolean } = {}): Promise<RestoreResult> {
  prepared.assertUsable();
  if (mode !== 'merge' && mode !== 'replace') throw new Error('恢复方式无效。');
  if (mode === 'replace' && !options.confirmed) throw new Error('完整替换必须二次确认。');
  await pauseAutomatic('恢复数据库前暂停自动队列，请在恢复后核对快照并人工恢复。', database);
  announceAIChange();
  const result: RestoreResult = { succeeded: 0, skipped: 0, failed: 0, duplicates: 0, conflicts: 0 };
  try {
    await database.transaction('rw', database.tables, async () => {
      const revision = (await database.libraryState.get('notes'))?.revision ?? 0;
      const duplicate = new Set<string>(); const blocked = new Set<string>(); const edges = new Map<string, Set<string>>();
      if (mode === 'merge') {
        options.progress?.('正在检查稳定 ID 与关联冲突…');
        for (const table of TABLES) await eachStage(prepared.stage, table, async rows => {
          check(options);
          for (const row of rows) {
            const own = node(table, row.id); if (!edges.has(own)) edges.set(own, new Set());
            for (const [target, id] of references(table, row)) { const other = node(target, id); edges.get(own)!.add(other); if (!edges.has(other)) edges.set(other, new Set()); edges.get(other)!.add(own); }
            const local = await database.table<Row>(table).get(row.id);
            // Notes and their editor snapshots share one logical ID, even when only one side exists.
            if (!local && (table === 'notes' || table === 'noteDrafts')) {
              const sibling = table === 'notes' ? 'noteDrafts' : 'notes';
              if (await database.table(sibling).get(row.id)) {
                const incomingSibling = await Dexie.waitFor(Dexie.ignoreTransaction(() => prepared.stage.table(sibling).get(row.id)));
                if (!incomingSibling) blocked.add(own);
              }
            }
            if (local) {
              let same = JSON.stringify(portableRow(table, local)) === JSON.stringify(portableRow(table, row));
              if (same && table === 'screenshots') same = await Dexie.waitFor(digest(local.blob as Blob)) === await Dexie.waitFor(digest(row.blob as Blob));
              if (same) duplicate.add(`${table}:${row.id}`); else blocked.add(own);
            }
            if (table === 'noteDrafts') { const localEntry = await database.noteDrafts.where('entryKey').equals(row.entryKey as string).first(); if (localEntry && localEntry.id !== row.id) blocked.add(own); }
          }
        }, true);
        const queue = [...blocked]; for (let index = 0; index < queue.length; index++) for (const neighbor of edges.get(queue[index]) ?? []) if (!blocked.has(neighbor)) { blocked.add(neighbor); queue.push(neighbor); }
      } else {
        check(options); options.progress?.('正在事务中替换数据，失败会整体回滚…');
        for (const table of TABLES) await database.table(table).clear();
        for (const table of ['noteCatalog', 'noteSearch', 'draftCatalog', 'screenshotThumbs']) await database.table(table).clear();
      }
      for (const table of TABLES) await eachStage(prepared.stage, table, async rows => {
        check(options); const accepted: Row[] = [];
        for (const row of rows) {
          if (duplicate.has(`${table}:${row.id}`)) { result.skipped++; result.duplicates++; }
          else if (blocked.has(node(table, row.id))) { result.skipped++; result.conflicts++; }
          else accepted.push(row);
        }
        if (accepted.length) {
          await database.table(table).bulkAdd(accepted);
          if (table === 'notes') { const notes = accepted as unknown as Note[]; await database.noteCatalog.bulkPut(notes.map(cardOf)); await database.noteSearch.bulkPut(notes.map(searchOf)); }
          if (table === 'noteDrafts') await database.draftCatalog.bulkPut((accepted as unknown as NoteDraft[]).map(draftCardOf));
          result.succeeded += accepted.length;
        }
        options.progress?.(`正在恢复：写入 ${result.succeeded}，跳过 ${result.skipped}`);
      }, true);
      const pref = await database.skillPreferences.get('general');
      await database.skillPreferences.put({ id: 'general', defaultId: pref?.defaultId ?? 'builtin-business', version: crypto.randomUUID() });
      check(options); await database.libraryState.put({ id: 'notes', revision: revision + 1 });
    });
  } catch (error) { throw new Error(`恢复失败，成功 0 条，失败 ${Object.values(prepared.summary.counts).reduce((a, b) => a + b, 0)} 条；全部写入已回滚，原数据库未更改。${friendlyError(error)}`); }
  if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('ideaclip-restored'); channel.postMessage('refresh'); channel.close(); }
  return result;
}
