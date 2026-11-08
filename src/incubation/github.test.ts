import {expect,it} from 'vitest';
import {githubRepository,normalizeGitHub} from './github';
import {createProject,full,saveProject,codexInstruction} from './repository';
import type {Task,GitHubReference} from './model';
import {IdeaClipDB} from '../storage';
import {exportBackup,prepareBackup,restoreBackup,discardBackup} from '../backup/service';
import {readZip} from '../backup/zip';
const repo='https://github.com/example/synthetic';
const github=():GitHubReference=>({repository:repo,issueNumber:12,prNumber:34,commitSha:'a'.repeat(40),linkedAt:1});
const task=():Task=>({id:'task',title:'验收保存提示',kind:'validation',status:'doing',priority:'normal',due:'',notes:'只做当前任务',noteIds:[],milestone:'testing',acceptance:'显示明确保存结果',reviewed:true});
async function fixture(run:(db:IdeaClipDB,p:ReturnType<typeof full>)=>Promise<void>){const db=new IdeaClipDB('github-task-'+crypto.randomUUID());try{const id=await createProject('manual','',db);await run(db,full((await db.projects.get(id))!));}finally{await db.delete();}}
it('GitHub仓库规范化、编号生成链接、URL反推编号与SHA，只核对格式',()=>{expect(githubRepository(repo+'.git')).toBe(repo);expect(normalizeGitHub(github())).toMatchObject({issueUrl:repo+'/issues/12',prUrl:repo+'/pull/34',commitUrl:repo+'/commit/'+'a'.repeat(40)});expect(normalizeGitHub({repository:repo,linkedAt:0,issueUrl:repo+'/issues/5',prUrl:repo+'/pull/6',commitUrl:repo+'/commit/ABC1234'})).toMatchObject({issueNumber:5,prNumber:6,commitSha:'abc1234'});});
it.each(['http://github.com/a/b','https://user:secret@github.com/a/b','https://github.com.evil.test/a/b','https://gitlab.com/a/b','https://github.com/a/b?token=x','https://github.com/a/b#x','https://github.com/a/../b','https://github.com:443/a/b','https://github.com/a/b\n','javascript:alert(1)'])('非法仓库拒绝 %s',url=>expect(()=>githubRepository(url)).toThrow());
it.each([{issueNumber:0},{prNumber:-1},{issueNumber:1.5},{prNumber:Number.MAX_SAFE_INTEGER+1},{commitSha:'abcdef'},{commitSha:'g'.repeat(40)},{issueNumber:3,issueUrl:repo+'/issues/4'},{issueUrl:repo+'/pull/12'},{prUrl:'https://github.com/other/synthetic/pull/34'},{commitUrl:'https://github.com/example/other/commit/abcdef1'},{commitSha:'abcdef1',commitUrl:repo+'/commit/abcdef2'},{issueUrl:repo+'/issues/12?token=x'},{prUrl:repo+'/pull/34\n'},{linkedAt:-1}])('非法编号/SHA/交叉仓库/URL拒绝 %#',patch=>expect(()=>normalizeGitHub({...github(),...patch})).toThrow());
it('关联保存、重开、修改和删除；状态独立且有真实关联时间',()=>fixture(async(db,p)=>{
 p=await saveProject({...p,tasks:[{...task(),github:github(),codexSummary:'Mock交付',acceptanceReview:{state:'awaiting',notes:'',tests:''}}]},p.revision,db);
 const first=p.tasks[0].github!;expect(first.linkedAt).toBeGreaterThan(1);expect(p.tasks[0].status).toBe('doing');db.close();await db.open();expect(full((await db.projects.get(p.id))!).tasks[0].github).toEqual(first);
 p=await saveProject({...p,tasks:[{...p.tasks[0],github:{...first,prNumber:35,prUrl:repo+'/pull/35'}}]},p.revision,db);expect(p.tasks[0].github?.prNumber).toBe(35);
 p=await saveProject({...p,tasks:[{...p.tasks[0],github:undefined}]},p.revision,db);expect(p.tasks[0].github).toBeUndefined();expect(p.tasks[0].codexSummary).toBe('Mock交付');
}));
it('旧项目和旧完成任务可编辑，不要求GitHub关联；新完成必须人工验收',()=>fixture(async(db,p)=>{
 await db.projects.put({...p,tasks:[{...task(),status:'done'}]});p=full((await db.projects.get(p.id))!);p=await saveProject({...p,title:'旧项目保留'},p.revision,db);expect(p.tasks[0].status).toBe('done');
 p=await saveProject({...p,tasks:[{...p.tasks[0],status:'doing'}]},p.revision,db);await expect(saveProject({...p,tasks:[{...p.tasks[0],status:'done'}]},p.revision,db)).rejects.toThrow('人工验收');
}));
it('验收失败/通过均须人工确认；通过不自动完成，完成须独立显式操作',()=>fixture(async(db,p)=>{
 p=await saveProject({...p,tasks:[task()]},p.revision,db);
 const reviewed=(state:'failed'|'passed')=>({...p,tasks:[{...p.tasks[0],acceptanceReview:{state,notes:'人工检查当前结果',tests:'Mock通过；真实服务未测试'}}]});
 await expect(saveProject(reviewed('failed'),p.revision,db)).rejects.toThrow('人工勾选');
 p=await saveProject(reviewed('failed'),p.revision,db,{reviewTaskId:'task'});expect(p.tasks[0].acceptanceReview?.state).toBe('failed');
 p=await saveProject(reviewed('passed'),p.revision,db,{reviewTaskId:'task'});expect(p.tasks[0].status).toBe('doing');
 await expect(saveProject({...p,tasks:[{...p.tasks[0],status:'done'}]},p.revision,db)).rejects.toThrow('明确点击');
 p=await saveProject({...p,tasks:[{...p.tasks[0],status:'done'}]},p.revision,db,{completeTaskId:'task'});expect(p.tasks[0].status).toBe('done');
 await expect(saveProject({...p,tasks:[{...p.tasks[0],codexSummary:'新的结果'}]},p.revision,db)).rejects.toThrow('先将看板状态');
}));
it('结果或任务内容改变不能沿用通过结论；过期编辑不覆盖',()=>fixture(async(db,p)=>{
 p=await saveProject({...p,tasks:[task()]},p.revision,db);p=await saveProject({...p,tasks:[{...p.tasks[0],acceptanceReview:{state:'passed',notes:'人工审核',tests:'Mock通过'}}]},p.revision,db,{reviewTaskId:'task'});
 const stale=p;p=await saveProject({...p,tasks:[{...p.tasks[0],github:github(),codexSummary:'新提交'}]},p.revision,db);expect(p.tasks[0].acceptanceReview?.state).toBe('awaiting');expect(p.tasks[0].reviewed).toBe(false);
 await expect(saveProject(stale,stale.revision,db)).rejects.toThrow('已改变');
 await expect(saveProject({...p,tasks:[{...p.tasks[0],notes:'新范围',acceptanceReview:{state:'passed',notes:'人工审核',tests:'通过'}}]},p.revision,db,{reviewTaskId:'task'})).rejects.toThrow('先保存');
}));
it('开发绑定与GitHub仓库一致，指令仅当前Issue及任务范围，无远程执行',()=>fixture(async(db,p)=>{
 const workspace={repository:repo,directory:'D:\\Synthetic\\App',scope:['src/only']};p=await saveProject({...p,projectPurpose:'development',workspace,tasks:[{...task(),kind:'development',github:github()}]},p.revision,db);
 const text=codexInstruction(p,{...p.tasks[0],reviewed:true});for(const part of [repo,'"issueNumber": 12','src/only','Commit SHA','PR','禁止强制推送']){expect(text).toContain(part);}expect(text).not.toContain('prNumber');
 await expect(saveProject({...p,tasks:[{...p.tasks[0],github:{...github(),repository:'https://github.com/other/synthetic'}}]},p.revision,db)).rejects.toThrow('绑定不一致');
}));
it('ZIP真实往返保留引用/验收/看板，排除本机路径与执行审核，合并去重',()=>fixture(async(db,p)=>{
 p=await saveProject({...p,projectPurpose:'development',workspace:{repository:repo,directory:'D:\\PrivateWorkspace\\App',scope:['src']},tasks:[{...task(),github:github(),codexSummary:'合成交付',reviewed:true}]},p.revision,db);
 p=await saveProject({...p,tasks:[{...p.tasks[0],reviewed:true,acceptanceReview:{state:'passed',notes:'人工验收记录',tests:'Mock检查通过'}}]},p.revision,db,{reviewTaskId:'task'});
 const zip=await exportBackup(db);const payload=(await Promise.all((await readZip(zip)).filter(e=>e.name.startsWith('data/projects')).map(e=>e.blob.text()))).join('');expect(payload).not.toContain('PrivateWorkspace');expect(payload).not.toContain('workspace');
 const prepared=await prepareBackup(zip),target=new IdeaClipDB('github-restore-'+crypto.randomUUID());try{await restoreBackup(prepared,'merge',target);const t=full((await target.projects.get(p.id))!).tasks[0];expect(t.github).toEqual(p.tasks[0].github);expect(t.acceptanceReview).toEqual(p.tasks[0].acceptanceReview);expect(t.status).toBe('doing');expect(t.reviewed).toBe(false);expect((await restoreBackup(prepared,'merge',target)).duplicates).toBe(1);}finally{await discardBackup(prepared);await target.delete();}
}));
