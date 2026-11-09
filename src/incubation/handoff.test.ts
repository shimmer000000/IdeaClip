import {it,expect,vi} from 'vitest';
import {IdeaClipDB} from '../storage';
import {createProject,full,saveProject} from './repository';
import {previewTaskPackage,confirmPackageExport,markPackageHandedOff} from './task-package';
import {handoffRows,filterHandoffs,handoffEvidence,directoryFiles,scanInbox,confirmInbox,INBOX_BYTES,type InboxFile,type InboxDirectory} from './handoff';
import {exportBackup,prepareBackup,restoreBackup,discardBackup} from '../backup/service';
import type {Task} from './model';

const repo='https://github.com/shimmer000000/IdeaClip';
async function fixture(){
 const d=new IdeaClipDB('handoff-'+crypto.randomUUID()),pid=await createProject('manual','',d),p=full((await d.projects.get(pid))!);
 const bound=await saveProject({...p,projectPurpose:'development',workspace:{repository:repo,directory:'D:/Synthetic/IdeaClip',scope:['docs']}},p.revision,d);
 const t:Task={id:crypto.randomUUID(),kind:'development',title:'本地数据交接测试',notes:'合成Mock',priority:'normal',status:'todo',due:'',noteIds:[],milestone:'research',acceptance:'只校验交付数据，不执行产品开发',reviewed:true};
 await saveProject({...bound,tasks:[t]},bound.revision,d);const pack=await previewTaskPackage(pid,t.id,d);await confirmPackageExport(pid,t.id,pack,true,d);
 const report={format:'IdeaClipCodexDelivery',schemaVersion:2,taskPackage:{packageId:pack.packageId,contentSha256:pack.contentSha256},reportId:crypto.randomUUID(),projectId:pid,taskId:t.id,repository:repo,commitSha:'a'.repeat(40),summary:'合成Mock；未执行开发与测试',files:['docs/mock.md'],tests:[],notRun:[{command:'产品开发',reason:'只验收文件交接，不执行'}],risks:['未核验'],generatedAt:new Date().toISOString(),localRecordId:null};
 return {d,pid,tid:t.id,pack,report,get:async()=>full((await d.projects.get(pid))!)};
}
const file=(value:unknown,name='report.json'):InboxFile=>{const b=new TextEncoder().encode(JSON.stringify(value));return {name,size:b.byteLength,arrayBuffer:async()=>b.buffer};};
it('扫描仅预览零请求零写入，明确确认后关联、重复跳过且不自动验收/完成',async()=>{
 const f=await fixture(),net=vi.spyOn(globalThis,'fetch');try{
  const before=await f.get(),rows=await scanInbox([file(f.report)],f.d);expect(rows[0].state).toBe('valid');expect(await f.get()).toEqual(before);
  await expect(confirmInbox(rows,[0],false,f.d)).rejects.toThrow('确认');expect((await f.get()).tasks[0].localDeliveries).toBeUndefined();
  expect((await confirmInbox(rows,[0],true,f.d))[0].state).toBe('imported');expect((await confirmInbox(rows,[0],true,f.d))[0].state).toBe('skipped');
  const p=await f.get();expect(p.tasks[0].localDeliveries).toHaveLength(1);expect(p.tasks[0].status).toBe('todo');expect(p.tasks[0].acceptanceReview).toBeUndefined();
  expect((await scanInbox([file(f.report)],f.d))[0].state).toBe('duplicate');expect(await f.d.aiUsage.count()).toBe(0);expect(await f.d.researchUsage.count()).toBe(0);expect(net).not.toHaveBeenCalled();
 }finally{net.mockRestore();await f.d.delete();}
});
it.each(['project','task','repository','package-id','package-hash','scope','version','extra','unknown-format'])('候选拒绝错误 %s，不更改旧数据',async kind=>{
 const f=await fixture();try{const r:any=structuredClone(f.report);if(kind==='project')r.projectId=crypto.randomUUID();if(kind==='task')r.taskId=crypto.randomUUID();if(kind==='repository')r.repository='https://github.com/other/repo';if(kind==='package-id')r.taskPackage.packageId=crypto.randomUUID();if(kind==='package-hash')r.taskPackage.contentSha256='b'.repeat(64);if(kind==='scope')r.files=['src/outside.ts'];if(kind==='version'){r.schemaVersion=1;delete r.taskPackage;}if(kind==='extra')r.command='never execute';if(kind==='unknown-format')r.format='Other';expect((await scanInbox([file(r)],f.d))[0].state).toBe('rejected');expect((await f.get()).tasks[0].localDeliveries).toBeUndefined();}finally{await f.d.delete();}
});
it('批内相同报告去重，同ID不同内容整组拒绝',async()=>{const f=await fixture();try{
 const same=await scanInbox([file(f.report,'one.json'),file(f.report,'two.json')],f.d);expect(same.map(x=>x.state)).toEqual(['valid','duplicate']);
 const bad=await scanInbox([file(f.report),file({...f.report,summary:'changed'},'other.json')],f.d);expect(bad.map(x=>x.state)).toEqual(['rejected','rejected']);expect(bad[0].text).toBeUndefined();
}finally{await f.d.delete();}});
it('文件数量、总量、单份、嵌套路径、文件名和UTF-8限制',async()=>{const f=await fixture();try{
 const read=vi.fn(async()=>new ArrayBuffer(0));await expect(scanInbox(Array.from({length:21},()=>({name:'a.json',size:0,arrayBuffer:read})),f.d)).rejects.toThrow('20');
 await expect(scanInbox([{name:'a.json',size:INBOX_BYTES+1,arrayBuffer:read}],f.d)).rejects.toThrow('2MiB');
 for(const item of [{name:'big.json',size:131073,arrayBuffer:read},{...file(f.report),webkitRelativePath:'folder/sub/a.json'},{...file(f.report),name:'../a.json'},{name:'utf8.json',size:1,arrayBuffer:async()=>new Uint8Array([255]).buffer}])expect((await scanInbox([item],f.d))[0].state).toBe('rejected');
 expect(read).not.toHaveBeenCalled();
}finally{await f.d.delete();}});
it('目录仅第一层，忽略子目录/非JSON；超过枚举或JSON数量限制时不取文件',async()=>{
 const nested=vi.fn(),get=vi.fn(async()=>file({}));const make=(entries:any[]):InboxDirectory=>({kind:'directory',name:'Inbox',async *values(){yield* entries;}});
 const selected=await directoryFiles(make([{kind:'directory',name:'sub',values:nested},{kind:'file',name:'a.txt',getFile:get},{kind:'file',name:'a.json',getFile:get}]));expect(selected).toHaveLength(1);expect(get).toHaveBeenCalledTimes(1);expect(nested).not.toHaveBeenCalled();get.mockClear();
 await expect(directoryFiles(make(Array.from({length:101},()=>({kind:'directory',name:'sub',values:nested}))))).rejects.toThrow('100');
 await expect(directoryFiles(make(Array.from({length:21},(_,i)=>({kind:'file',name:i+'.json',getFile:get}))))).rejects.toThrow('20');expect(get).not.toHaveBeenCalled();
});
it('候选超过10分钟失效；确认前绑定变化失败，其他有效报告可独立成功',async()=>{
 const f=await fixture();try{const rows=await scanInbox([file(f.report)],f.d);await expect(confirmInbox([{...rows[0],checkedAt:Date.now()-600001}],[0],true,f.d)).rejects.toThrow('10分钟');
 const p=await f.get();p.tasks[0].notes='人工修改输入';await f.d.projects.put(p);expect((await confirmInbox(rows,[0],true,f.d))[0].state).toBe('failed');expect((await f.get()).tasks[0].localDeliveries).toBeUndefined();
}finally{await f.d.delete();}});
it('跨项目分别关联，单项失效不合并其他仓库或回滚已成功项',async()=>{
 const f=await fixture();try{const pid=await createProject('manual','',f.d),p=full((await f.d.projects.get(pid))!),bound=await saveProject({...p,projectPurpose:'development',workspace:{repository:'https://github.com/example/Second',directory:'D:/Synthetic/Second',scope:['docs']}},p.revision,f.d),task={...(await f.get()).tasks[0],id:crypto.randomUUID(),taskPackages:undefined};await saveProject({...bound,tasks:[task]},bound.revision,f.d);const pack=await previewTaskPackage(pid,task.id,f.d);await confirmPackageExport(pid,task.id,pack,true,f.d);
 const second={...f.report,projectId:pid,taskId:task.id,repository:pack.task.repository,taskPackage:{packageId:pack.packageId,contentSha256:pack.contentSha256},reportId:crypto.randomUUID(),generatedAt:new Date().toISOString()};
 const rows=await scanInbox([file(f.report),file(second,'second.json')],f.d),changed=await f.get();changed.tasks[0].reviewed=false;await f.d.projects.put(changed);
 expect((await confirmInbox(rows,[0,1],true,f.d)).map(x=>x.state)).toEqual(['failed','imported']);expect((await f.d.projects.get(pid))!.tasks![0].localDeliveries![0].report.repository).toBe('https://github.com/example/Second');expect((await f.get()).tasks[0].localDeliveries).toBeUndefined();
}finally{await f.d.delete();}});
it('交接/报告状态、项目/日期组合筛选与旧历史仓库兼容',async()=>{const f=await fixture();try{
 let rows=await handoffRows([await f.get()]);expect(rows[0].state).toBe('waiting');expect(rows[0].history.repository).toBe(repo);expect(rows[0].warning).toBe('');
 await markPackageHandedOff(f.pid,f.tid,f.pack.packageId,true,f.d);expect((await handoffRows([await f.get()]))[0].state).toBe('handed');await confirmInbox(await scanInbox([file(f.report)],f.d),[0],true,f.d);
 rows=await handoffRows([await f.get()]);expect(rows[0].awaitingReview).toBe(true);expect(filterHandoffs(rows,f.pid,'review','','')).toHaveLength(1);expect(filterHandoffs(rows,'unknown','','','')).toHaveLength(0);expect(filterHandoffs(rows,'','','2099-01-01','')).toHaveLength(0);expect(()=>filterHandoffs(rows,'','','2026-12-02','2026-01-01')).toThrow();
 const old=await f.get();delete old.tasks[0].taskPackages![0].repository;expect((await handoffRows([old]))[0].warning).toBe('');old.tasks[0].notes='变更';expect((await handoffRows([old]))[0].warning).toContain('变更');
 const changed=await f.get();changed.workspace!.repository='https://github.com/other/repo';expect((await handoffRows([changed]))[0].warning).toContain('仓库绑定不一致');
}finally{await f.d.delete();}});
it('ZIP保留交接仓库/报告关系并强制历史，旧数据库不新增表或执行授权',async()=>{const f=await fixture(),other=new IdeaClipDB('handoff-restore-'+crypto.randomUUID());try{
 await confirmInbox(await scanInbox([file(f.report)],f.d),[0],true,f.d);const prepared=await prepareBackup(await exportBackup(f.d));try{await restoreBackup(prepared,'merge',other);const p=full((await other.projects.get(f.pid))!);expect(p.tasks[0].taskPackages![0].repository).toBe(repo);expect((await handoffRows([p]))[0].warning).toContain('历史');expect(p.tasks[0].status).toBe('todo');expect(p.workspace).toBeUndefined();expect(other.verno).toBe(14);}finally{await discardBackup(prepared);}
}finally{await f.d.delete();await other.delete();}});
it('证据缺口明确区分声明、本地核对、远程、CI、范围和人工验收',async()=>{const f=await fixture();try{const p=await f.get(),e=handoffEvidence(p,p.tasks[0]);expect(e.codex).toContain('缺少');expect(e.ci).toContain('缺少');expect(e.scope).toContain('尚未');expect(e.missing).toContain('缺少人工验收通过记录');}finally{await f.d.delete();}});
it('旧项目新的交接/结果更新最近时间，能够进入中心最近项目分页',async()=>{const f=await fixture();try{
 let p=await f.get();p.updatedAt=1;await f.d.projects.put(p);await markPackageHandedOff(f.pid,f.tid,f.pack.packageId,true,f.d);expect((await f.get()).updatedAt).toBeGreaterThan(1);
 p=await f.get();p.updatedAt=1;await f.d.projects.put(p);await confirmInbox(await scanInbox([file(f.report)],f.d),[0],true,f.d);expect((await f.get()).updatedAt).toBeGreaterThan(1);
}finally{await f.d.delete();}});
