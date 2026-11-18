import { db, type Note } from '../storage';
import { redact } from '../backup/model';

export interface Area { get(key: string): Promise<Record<string, unknown>>; set(value: Record<string, unknown>): Promise<void>; remove(key: string): Promise<void> }
export interface Transport { (base: string, path: string, body?: unknown, token?: string): Promise<any> }
export interface Pair { base: string; token: string; clientId: string }
export interface Preview { noteId: string; noteRevision: number; sourceUpdatedAt: string; title: string; url: string; summary: string; tags: string[]; notes: string; source: string; demo: boolean }
export interface Payload extends Preview { requestId: string; confirmed: true }
export interface Receipt { projectId: string; status: 'created' | 'duplicate'; replayed: boolean; openUrl: string }
export interface Outbox { payload: Payload; clientId: string; base: string; state: 'pending' | 'unknown' | 'saved'; receipt?: Receipt }
interface Dependencies { session: Area; local: Area; transport: Transport; extensionId: string; readNote(id: string): Promise<Note | undefined>; changed(id: string): Promise<boolean> }
export const PAIR = 'moneyradar.pair.session.v1', PENDING = 'moneyradar.pair.pending.v1', OUTBOX = 'moneyradar.outbox.v1';
export class BridgeError extends Error { constructor(public status: number, message: string) { super(message); } }
export function localBase(value: string) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || Number(u.port) < 1024 || u.pathname !== '/' || u.search || u.hash || u.username || u.password) throw new Error('仅允许 http://127.0.0.1:端口 的本机 MoneyRadar');
  return u.origin;
}
export function publicUrl(value: string) {
  const u = new URL(value.trim());
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port && !['80', '443'].includes(u.port) || !host.includes('.') || /^(?:\d+\.){3}\d+$/.test(host) || host.includes(':') || /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) || /\/(?:login|signin|account|inbox|admin|checkout)(?:\/|$)/i.test(u.pathname) || [...u.searchParams.keys()].some(k => /token|secret|password|api.?key|authorization|credential|signature/i.test(k))) throw new Error('仅可发送不含凭据的公开网页网址');
  u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k) || ['fbclid','gclid','msclkid'].includes(k.toLowerCase())) u.searchParams.delete(k);
  u.searchParams.sort(); return u.href;
}
export function safeText(s: string) { return redact(s).replace(/\b(?:mric_[\w-]{20,}|sk_[\w-]{16,}|apify_api_[\w-]{20,})\b/g, '[已移除凭据]'); }
export function projectUrl(base: string, value: string) {
  const u = new URL(value);
  if (u.origin !== localBase(base) || u.pathname !== '/' || u.search || !/^#project\/[a-f0-9-]{36}$/.test(u.hash)) throw new Error('MoneyRadar 返回了无效的项目链接');
  return u.href;
}
export function prepare(note: Note): Preview {
  if (note.saveState !== 'saved') throw new Error('请先提交保存当前收藏');
  return { noteId: note.id, noteRevision: note.revision, sourceUpdatedAt: new Date(note.updatedAt).toISOString(), title: safeText(note.title).slice(0,200), url: publicUrl(note.url), summary: safeText(note.content || '').slice(0,3000), tags: note.tags.slice(0,30).map(t => safeText(t).slice(0,60)).filter(Boolean), notes: '', source: note.platform || 'web', demo: false };
}
export class MoneyRadarSyncService {
  private busy = false;
  constructor(private d: Dependencies) {}
  async pair(): Promise<Pair | undefined> { return (await this.d.session.get(PAIR))[PAIR] as Pair | undefined; }
  async pending(): Promise<any> { return (await this.d.session.get(PENDING))[PENDING]; }
  async requestPair(base: string) {
    base = localBase(base);
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2,'0')).join('');
    const r = await this.d.transport(base, '/pair/request', { extensionId: this.d.extensionId, nonce });
    if (!/^[a-f0-9-]{36}$/.test(r.requestId) || !/^[A-F0-9]{8}$/.test(r.verificationCode) || r.approvalUrl !== base + '/#ideaclip-pair/' + r.requestId) throw new Error('配对响应无效');
    await this.d.session.set({ [PENDING]: { base, nonce, ...r } }); return r;
  }
  async claimPair() {
    const p = await this.pending(); if (!p) throw new Error('请先申请本地配对');
    const r = await this.d.transport(localBase(p.base), '/pair/claim', { requestId: p.requestId, nonce: p.nonce, extensionId: this.d.extensionId });
    if (!/^mric_[A-Za-z0-9_-]{43}$/.test(r.token) || !/^[a-f0-9-]{36}$/.test(r.clientId)) throw new Error('配对凭据无效');
    await this.d.session.set({ [PAIR]: { base: p.base, token: r.token, clientId: r.clientId } }); await this.d.session.remove(PENDING);
  }
  async disconnect() { await this.d.session.remove(PAIR); await this.d.session.remove(PENDING); }
  async outbox(noteId: string): Promise<Outbox | undefined> { return ((await this.d.local.get(OUTBOX))[OUTBOX] as Record<string,Outbox> | undefined)?.[noteId]; }
  private async write(outbox: Outbox) {
    const rows = (await this.d.local.get(OUTBOX))[OUTBOX] as Record<string,Outbox> || {};
    if (!rows[outbox.payload.noteId] && Object.keys(rows).length >= 50) throw new Error('已确认同步记录已达50条，请先清理已保存记录');
    await this.d.local.set({ [OUTBOX]: { ...rows, [outbox.payload.noteId]: outbox } });
  }
  async clearSaved() {
    const rows = (await this.d.local.get(OUTBOX))[OUTBOX] as Record<string,Outbox> || {};
    await this.d.local.set({ [OUTBOX]: Object.fromEntries(Object.entries(rows).filter(([,r]) => r.state !== 'saved')) });
  }
  async discard(noteId: string, acknowledged: boolean) {
    if (!acknowledged || this.busy) throw new Error('请先手动核对MoneyRadar中的旧结果');
    const rows = (await this.d.local.get(OUTBOX))[OUTBOX] as Record<string,Outbox> || {};
    delete rows[noteId]; await this.d.local.set({[OUTBOX]:rows});
  }
  async preview(noteId: string) {
    const note = await this.d.readNote(noteId);
    if (!note || await this.d.changed(noteId)) throw new Error('请先保存当前收藏的未提交编辑，再预览');
    return prepare(note);
  }
  private async unchanged(p: Preview) {
    const n = await this.d.readNote(p.noteId);
    if (!n || n.saveState !== 'saved' || n.revision !== p.noteRevision || new Date(n.updatedAt).toISOString() !== p.sourceUpdatedAt || await this.d.changed(p.noteId)) throw new Error('收藏已修改，请保存后重新预览；旧请求不会自动发送');
  }
  private receipt(r: any, pair: Pair): Receipt {
    if (!/^[a-f0-9-]{36}$/.test(r.projectId) || !['created','duplicate'].includes(r.status) || typeof r.replayed !== 'boolean' || r.openUrl !== pair.base + '/#project/' + r.projectId) throw new Error('保存结果无效，请手动重试查询');
    projectUrl(pair.base, r.openUrl); return { projectId: r.projectId, status: r.status, replayed: r.replayed, openUrl: r.openUrl };
  }
  async send(preview: Preview, confirmed: boolean): Promise<Receipt> {
    if (!confirmed) throw new Error('必须先逐条预览并确认');
    if (this.busy) throw new Error('同步处理中，请等待结果');
    this.busy = true;
    try {
      const pair = await this.pair(); if (!pair) throw new Error('请先完成本地配对');
      await this.unchanged(preview);
      const old = await this.outbox(preview.noteId);
      if (old && old.state !== 'saved') throw new Error('有状态未确认的同步，请先手动查询并重试旧请求');
      const payload: Payload = { requestId: crypto.randomUUID(), confirmed: true, noteId: preview.noteId, noteRevision: preview.noteRevision, sourceUpdatedAt: preview.sourceUpdatedAt, title: safeText(preview.title).slice(0,200), url: publicUrl(preview.url), summary: safeText(preview.summary).slice(0,3000), tags: preview.tags.slice(0,30).map(t => safeText(t).slice(0,60)).filter(Boolean), notes: safeText(preview.notes).slice(0,1000), source: safeText(preview.source).slice(0,100), demo: preview.demo === true };
      if (!payload.title.trim()) throw new Error('收藏标题不能为空');
      // Do not persist or transmit unreviewed sanitization changes.
      const { requestId: _id, confirmed: _confirmed, ...actual } = payload;
      if (JSON.stringify(actual) !== JSON.stringify(preview)) throw new Error('内容需脱敏或超出长度，请重新预览确认');
      const outbox: Outbox = { payload, clientId: pair.clientId, base: pair.base, state: 'pending' };
      await this.write(outbox); return await this.deliver(outbox, pair);
    } finally { this.busy = false; }
  }
  private async deliver(outbox: Outbox, pair: Pair) {
    try {
      const r = this.receipt(await this.d.transport(pair.base, '/import', outbox.payload, pair.token), pair);
      await this.write({ ...outbox, state: 'saved', receipt: r }); return r;
    } catch (error) { await this.write({ ...outbox, state: 'unknown' }); throw error; }
  }
  async retry(noteId: string, confirmed: boolean): Promise<Receipt> {
    if (!confirmed) throw new Error('请核对已确认的旧请求，再手动重试');
    if (this.busy) throw new Error('同步处理中，请等待结果');
    this.busy = true;
    try {
      const pair = await this.pair(), outbox = await this.outbox(noteId);
      if (!pair || !outbox || pair.clientId !== outbox.clientId || pair.base !== outbox.base) throw new Error('配对已改变，旧请求不会自动重发；请先在MoneyRadar核对结果');
      try {
        const r = this.receipt(await this.d.transport(pair.base, '/receipts/' + outbox.payload.requestId, undefined, pair.token), pair);
        await this.write({ ...outbox, state: 'saved', receipt: r }); return r;
      } catch (error) { if (!(error instanceof BridgeError) || error.status !== 404) throw error; }
      await this.unchanged(outbox.payload); return await this.deliver(outbox, pair);
    } finally { this.busy = false; }
  }
}
export function browserSync() {
  const extensionId = chrome.runtime.id;
  const transport: Transport = async (base, path, body, token) => {
    localBase(base);
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 6000);
    try {
      const r = await fetch(base + '/api/ideaclip' + path, { method: body ? 'POST' : 'GET', headers: { 'X-IdeaClip-Id': extensionId, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: abort.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
      if (!r.body) throw new Error();
      const reader = r.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const result = await reader.read(); if (result.done) break; size += result.value.length; if (size > 64000) { await reader.cancel(); throw new Error(); } chunks.push(result.value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
      const value = JSON.parse(new TextDecoder().decode(bytes));
      if (!r.ok) throw new BridgeError(r.status, ({401:'配对已失效，请重新配对',403:'连接被拒绝，请检查扩展配对',404:'本次同步尚无已保存结果',409:'请求内容冲突或尚未授权，请核对后重试',410:'配对已过期，请重新申请',429:'操作频繁，请稍后手动重试'} as Record<number,string>)[r.status] || 'MoneyRadar拒绝了请求，请核对公开内容和网址');
      return value;
    } catch (e) { if (e instanceof BridgeError) throw e; throw new Error('本地连接失败或结果未确认。请确认MoneyRadar已启动，再手动查询并重试；不会自动重发。'); }
    finally { clearTimeout(timeout); }
  };
  return new MoneyRadarSyncService({ session: chrome.storage.session, local: chrome.storage.local, transport, extensionId, readNote: id => db.notes.get(id), changed: async id => !!(await db.noteDrafts.get(id))?.hasChanges });
}
