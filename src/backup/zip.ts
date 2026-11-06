// A deliberately small ZIP32/STORE profile. No decompressor, executable entries or filesystem paths.
export const MAX_ARCHIVE = 512 * 1024 * 1024;
export const MAX_ENTRY = 8 * 1024 * 1024;
export const MAX_ENTRIES = 10000;
export interface ZipEntry { name: string; blob: Blob }
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
export async function digest(blob: Blob) {
  const bytes = await blob.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
function header(length: number) { const bytes = new Uint8Array(length); return { bytes, view: new DataView(bytes.buffer) }; }
function safeName(name: string) {
  if (!/^(manifest\.json|data\/(notes|noteDrafts|screenshots|contentCaptures|settings|analyses|projects|aiTemplates)\/\d{6}\.json|images\/\d{6}\.(png|webp))$/.test(name)) throw new Error('ZIP 包含非法路径或未知文件。');
}
export async function writeZip(entries: ZipEntry[], progress?: (completed: number) => void): Promise<Blob> {
  if (entries.length > MAX_ENTRIES) throw new Error('备份文件数量超过安全上限。');
  const parts: BlobPart[] = []; const central: BlobPart[] = []; let offset = 0; let centralSize = 0;
  const names = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    safeName(entry.name); if (names.has(entry.name)) throw new Error('ZIP 文件重名。'); names.add(entry.name);
    if (entry.blob.size > MAX_ENTRY) throw new Error('单项数据超过 8 MiB 安全上限。');
    const name = encoder.encode(entry.name); const crc = crc32(new Uint8Array(await entry.blob.arrayBuffer()));
    const local = header(30); const v = local.view;
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true);
    v.setUint16(12, 0x21, true); // Valid DOS date: 1980-01-01; real backup time is in the manifest.
    v.setUint32(14, crc, true); v.setUint32(18, entry.blob.size, true); v.setUint32(22, entry.blob.size, true); v.setUint16(26, name.length, true);
    parts.push(local.bytes, name, entry.blob);
    const directory = header(46); const d = directory.view;
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true);
    d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true); d.setUint32(20, entry.blob.size, true); d.setUint32(24, entry.blob.size, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
    central.push(directory.bytes, name); centralSize += 46 + name.length; offset += 30 + name.length + entry.blob.size;
    if (offset + centralSize + 22 > MAX_ARCHIVE) throw new Error('备份超过 512 MiB 安全上限，请减少数据后重试。');
    progress?.(index + 1);
  }
  const end = header(22); const v = end.view;
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true); v.setUint32(12, centralSize, true); v.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.bytes], { type: 'application/zip' });
}
export interface ReadEntry { name: string; blob: Blob; crc: number }
export async function readZip(file: Blob): Promise<ReadEntry[]> {
  if (file.size < 22 || file.size > MAX_ARCHIVE) throw new Error('备份大小无效，最大支持 512 MiB。');
  const end = new DataView(await file.slice(-22).arrayBuffer());
  if (end.getUint32(0, true) !== 0x06054b50 || end.getUint32(4, true) !== 0 || end.getUint16(20, true) !== 0) throw new Error('ZIP 结束记录无效，不支持分卷或注释。');
  const count = end.getUint16(10, true); const size = end.getUint32(12, true); const start = end.getUint32(16, true);
  if (!count || count > MAX_ENTRIES || end.getUint16(8, true) !== count || start + size !== file.size - 22 || size > MAX_ENTRIES * 160) throw new Error('ZIP 目录大小或条目数量无效。');
  const directory = new DataView(await file.slice(start, start + size).arrayBuffer());
  let cursor = 0; let expectedOffset = 0; const entries: ReadEntry[] = []; const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > size || directory.getUint32(cursor, true) !== 0x02014b50) throw new Error('ZIP 目录损坏。');
    const flags = directory.getUint16(cursor + 8, true); const method = directory.getUint16(cursor + 10, true);
    const crc = directory.getUint32(cursor + 16, true); const packed = directory.getUint32(cursor + 20, true); const unpacked = directory.getUint32(cursor + 24, true);
    const nameSize = directory.getUint16(cursor + 28, true); const extra = directory.getUint16(cursor + 30, true); const comment = directory.getUint16(cursor + 32, true); const offset = directory.getUint32(cursor + 42, true);
    if (flags !== 0x800 || method !== 0 || packed !== unpacked || packed > MAX_ENTRY || extra || comment || directory.getUint16(cursor + 34, true) || cursor + 46 + nameSize > size || nameSize > 96 || offset !== expectedOffset) throw new Error('ZIP 不符合安全格式：仅支持 IdeaClip 无压缩、无加密、非重叠条目。');
    const name = decoder.decode(new Uint8Array(directory.buffer, cursor + 46, nameSize)); safeName(name);
    if (names.has(name)) throw new Error('ZIP 条目重复。'); names.add(name);
    const local = new DataView(await file.slice(offset, offset + 30 + nameSize).arrayBuffer());
    if (local.byteLength !== 30 + nameSize || local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) !== flags || local.getUint16(8, true) !== 0 || local.getUint32(14, true) !== crc || local.getUint32(18, true) !== packed || local.getUint32(22, true) !== unpacked || local.getUint16(26, true) !== nameSize || local.getUint16(28, true) !== 0 || decoder.decode(new Uint8Array(local.buffer, 30)) !== name) throw new Error('ZIP 本地记录与目录不一致。');
    const dataStart = offset + 30 + nameSize; expectedOffset = dataStart + packed;
    if (expectedOffset > start) throw new Error('ZIP 条目越界。');
    entries.push({ name, blob: file.slice(dataStart, expectedOffset), crc }); cursor += 46 + nameSize;
  }
  if (cursor !== size || expectedOffset !== start) throw new Error('ZIP 存在未声明的数据。');
  return entries;
}
