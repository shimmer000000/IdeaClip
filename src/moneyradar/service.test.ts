import { describe, it, expect, vi } from 'vitest';
import { noteDefaults } from '../inspiration/model';
import type { Note } from '../storage';
import { MoneyRadarSyncService, BridgeError, PAIR, OUTBOX, prepare, localBase, publicUrl, projectUrl, type Area, type Transport } from './service';

const memory = (): Area & { rows: Record<string,unknown> } => { const rows: Record<string,unknown>={};return {rows,async get(key){return structuredClone({[key]:rows[key]});},async set(v){Object.assign(rows,structuredClone(v));},async remove(k){delete rows[k];}}; };
const note = (): Note => ({...noteDefaults('https://example.com/demo'),id:'演示收藏',title:'演示 · 中文SaaS',url:'https://example.com/demo?utm_source=synthetic',content:'合成公开正文，不含营业额',body:'私密感悟不得发送',tags:['演示','中文'],status:'inbox',createdAt:1,updatedAt:2,screenshotIds:['private-screen'],revision:1});
async function fixture(transport?:Transport) {
  const session=memory(),local=memory(),n=note();let changed=false;
  const p={base:'http://127.0.0.1:47831',token:'mric_'+'a'.repeat(43),clientId:'12345678-1234-4123-8123-123456789012'};
  await session.set({[PAIR]:p});
  const result={projectId:crypto.randomUUID(),status:'created',replayed:false,openUrl:''};result.openUrl=p.base+'/#project/'+result.projectId;
  const request=vi.fn<Transport>(transport ?? (async()=>result));
  const service=new MoneyRadarSyncService({session,local,transport:request,extensionId:'a'.repeat(32),readNote:async()=>n,changed:async()=>changed});
  return {session,local,n,p,result,request,service,setChanged:()=>{changed=true;}};
}
describe('MoneyRadar 单向同步（全部合成Mock，无收费请求）',()=>{
  it('白名单只含已保存公开数据，不含私人感悟、截图、报告；默认备注空白',()=>{
    const n=note(),p=prepare(n),encoded=JSON.stringify(p);expect(p.notes).toBe('');expect(p.demo).toBe(false);expect(p.tags).toEqual(['演示','中文']);expect(encoded).not.toContain(n.body);expect(encoded).not.toContain('private-screen');expect(encoded).not.toMatch(/analys|screenshot|captureIds|body/);expect(p.url).not.toContain('utm_');
  });
  it('未确认绝不请求、不写同步记录',async()=>{const f=await fixture();await expect(f.service.send(await f.service.preview(f.n.id),false)).rejects.toThrow('确认');expect(f.request).not.toHaveBeenCalled();expect(f.local.rows).toEqual({});});
  it('无配对绝不发送',async()=>{const f=await fixture();await f.service.disconnect();await expect(f.service.send(prepare(f.n),true)).rejects.toThrow('配对');expect(f.request).not.toHaveBeenCalled();});
  it('新收藏确认后发送，凭据只在session，不进入本地outbox',async()=>{const f=await fixture();const r=await f.service.send(prepare(f.n),true);expect(r.projectId).toBe(f.result.projectId);expect(f.request).toHaveBeenCalledTimes(1);const o=await f.service.outbox(f.n.id);expect(o?.state).toBe('saved');expect(JSON.stringify(f.local.rows)).not.toContain(f.p.token);expect(JSON.stringify(f.local.rows)).not.toContain(f.n.body);});
  it('公开摘要截断并脱敏，禁止将后续脱敏变更未经复核发送',async()=>{
    const f=await fixture();f.n.content='a'.repeat(3100);expect(prepare(f.n).summary).toHaveLength(3000);
    const p=prepare(f.n);p.notes='Bearer '+'a'.repeat(20);await expect(f.service.send(p,true)).rejects.toThrow('重新预览确认');expect(f.request).not.toHaveBeenCalled();
  });
  it('预览后改动/未提交草稿不能发送或创建outbox',async()=>{const f=await fixture(),p=prepare(f.n);f.n.revision++;await expect(f.service.send(p,true)).rejects.toThrow('修改');f.setChanged();await expect(f.service.preview(f.n.id)).rejects.toThrow('保存');expect(f.request).not.toHaveBeenCalled();expect(f.local.rows).toEqual({});});
  it('服务关闭不自动重发，重试先查回执404再发同一requestId',async()=>{
    const f=await fixture();f.request.mockRejectedValueOnce(new Error('服务关闭'));
    const p=prepare(f.n);await expect(f.service.send(p,true)).rejects.toThrow('服务关闭');const first=await f.service.outbox(f.n.id);expect(first?.state).toBe('unknown');expect(f.request).toHaveBeenCalledTimes(1);
    f.request.mockRejectedValueOnce(new BridgeError(404,'无结果')).mockResolvedValueOnce(f.result);
    await f.service.retry(f.n.id,true);expect(f.request).toHaveBeenCalledTimes(3);expect(f.request.mock.calls[1][1]).toBe('/receipts/'+first?.payload.requestId);expect((f.request.mock.calls[2][2] as any).requestId).toBe(first?.payload.requestId);
  });
  it('服务已保存但响应丢失时，只查回执，不二次POST',async()=>{
    const f=await fixture();f.request.mockRejectedValueOnce(new Error('响应丢失'));await expect(f.service.send(prepare(f.n),true)).rejects.toThrow();
    f.request.mockResolvedValueOnce({...f.result,replayed:true});const r=await f.service.retry(f.n.id,true);expect(r.replayed).toBe(true);expect(f.request.mock.calls.map(c=>c[1])).toEqual(['/import','/receipts/'+(await f.service.outbox(f.n.id))?.payload.requestId]);
  });
  it('查回执网络失败或401不得继续POST，重新配对不能误重放',async()=>{
    const f=await fixture();f.request.mockRejectedValueOnce(new Error('失败'));await expect(f.service.send(prepare(f.n),true)).rejects.toThrow();
    f.request.mockRejectedValueOnce(new BridgeError(401,'失效'));await expect(f.service.retry(f.n.id,true)).rejects.toThrow('失效');expect(f.request).toHaveBeenCalledTimes(2);
    await f.session.set({[PAIR]:{...f.p,clientId:crypto.randomUUID()}});await expect(f.service.retry(f.n.id,true)).rejects.toThrow('配对已改变');expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('失败后的内容变化不重发旧快照，无确认不查回执',async()=>{
    const f=await fixture();f.request.mockRejectedValueOnce(new Error('失败'));await expect(f.service.send(prepare(f.n),true)).rejects.toThrow();
    await expect(f.service.retry(f.n.id,false)).rejects.toThrow('确认');expect(f.request).toHaveBeenCalledTimes(1);
    f.n.updatedAt++;f.request.mockRejectedValueOnce(new BridgeError(404,'无结果'));await expect(f.service.retry(f.n.id,true)).rejects.toThrow('修改');expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('未确认旧请求阻止新请求；清理只移除已保存outbox，不影响笔记',async()=>{
    const f=await fixture();f.request.mockRejectedValueOnce(new Error('失败'));await expect(f.service.send(prepare(f.n),true)).rejects.toThrow();await expect(f.service.send(prepare(f.n),true)).rejects.toThrow('旧请求');
    await f.service.clearSaved();expect(await f.service.outbox(f.n.id)).toBeTruthy();expect(f.n.body).toContain('私密');
  });
  it('配对经nonce领取，仅session存储，浏览器会话丢失不能再发送',async()=>{
    const f=await fixture();await f.service.disconnect();const id=crypto.randomUUID();f.request.mockResolvedValueOnce({requestId:id,verificationCode:'A1B2C3D4',approvalUrl:f.p.base+'/#ideaclip-pair/'+id});await f.service.requestPair(f.p.base);
    expect(f.local.rows).toEqual({});f.request.mockResolvedValueOnce(f.p);await f.service.claimPair();expect(await f.service.pair()).toEqual(f.p);expect(JSON.stringify(f.local.rows)).not.toContain(f.p.token);await f.session.remove(PAIR);await expect(f.service.send(prepare(f.n),true)).rejects.toThrow('配对');
  });
  it('远程端点、带凭据URL、内网字面地址和恶意结果链接被拒绝',()=>{
    for(const u of ['https://evil.example.com','http://localhost:47831','http://127.0.0.1:47831/foo','http://127.0.0.1:47831/?token=x'])expect(()=>localBase(u)).toThrow();
    for(const u of ['http://127.0.0.1/x','https://user:pass@example.com','https://example.com/?token=private','https://example.com/account','file:///x','http://192.168.1.2/x'])expect(()=>publicUrl(u)).toThrow();
    expect(()=>projectUrl('http://127.0.0.1:47831','https://evil.example.com/#project/'+crypto.randomUUID())).toThrow();
  });
  it('并发点击只发一次POST，浏览器存储失败不发送',async()=>{
    const f=await fixture();let release:(v:any)=>void=()=>{};f.request.mockImplementationOnce(()=>new Promise(r=>{release=r;}));const pending=f.service.send(prepare(f.n),true);await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(1));await expect(f.service.send(prepare(f.n),true)).rejects.toThrow('处理中');release(f.result);await pending;
    const g=await fixture();g.local.set=async()=>{throw new Error('存储已满');};await expect(g.service.send(prepare(g.n),true)).rejects.toThrow('存储已满');expect(g.request).not.toHaveBeenCalled();
  });
  it('本地已确认outbox有数量上限，不截断未确认记录',async()=>{
    const f=await fixture();await f.local.set({[OUTBOX]:Object.fromEntries(Array.from({length:50},(_,i)=>['old-'+i,{state:'unknown'}]))});await expect(f.service.send(prepare(f.n),true)).rejects.toThrow('50');expect(f.request).not.toHaveBeenCalled();
  });
  it('放弃旧请求必须单独确认，只清除重试快照，不请求或改动原笔记',async()=>{
    const f=await fixture();f.request.mockRejectedValueOnce(new Error('失败'));await expect(f.service.send(prepare(f.n),true)).rejects.toThrow();await expect(f.service.discard(f.n.id,false)).rejects.toThrow('核对');expect(await f.service.outbox(f.n.id)).toBeTruthy();await f.service.discard(f.n.id,true);expect(await f.service.outbox(f.n.id)).toBeUndefined();expect(f.request).toHaveBeenCalledTimes(1);expect(f.n.body).toContain('私密');
  });
});
