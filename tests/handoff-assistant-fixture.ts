import {mkdir,mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DELIVERY_CONTRACT,packageDigest,type TaskPackage} from '../src/incubation/task-package-model.ts';
export const repository='https://github.com/shimmer000000/IdeaClip';
export async function assistantFixture(){
 const base=resolve('test-results/assistant-workspaces');await mkdir(base,{recursive:true});
 const directory=await mkdtemp(join(base,'isolated-')),root=join(directory,'workspace'),inbox=join(directory,'inbox');await mkdir(root);await mkdir(inbox);await mkdir(join(root,'docs'));
 const git=(...args:string[])=>execFileSync('git',['-c','core.autocrlf=false','-C',root,...args],{encoding:'utf8',windowsHide:true}).trim();
 git('init','-q');git('remote','add','origin',repository+'.git');await writeFile(join(root,'docs/sample.md'),'Synthetic handoff fixture only.\n');git('add','docs/sample.md');git('-c','user.name=IdeaClip Mock','-c','user.email=mock@example.invalid','-c','core.hooksPath=NUL','commit','-qm','隔离交接样本');
 const sha=git('rev-parse','HEAD'),pack:TaskPackage={format:'IdeaClipCodexTask',schemaVersion:1,packageId:randomUUID(),generatedAt:new Date().toISOString(),contentSha256:'',executionAuthorized:false,task:{projectId:randomUUID(),taskId:randomUUID(),type:'development',projectPurpose:'development',goal:'隔离交接验证，不执行产品开发',notes:'不执行任何导入命令',repository,workingDirectory:await realpath(root),allowedPaths:['docs'],acceptance:'只验证交接，无软件任务执行',instructions:'仅数据，不执行命令。'},delivery:DELIVERY_CONTRACT};pack.contentSha256=await packageDigest(pack);
 const packageFile=join(directory,`IdeaClip-CodexTask-${pack.packageId}.json`);await writeFile(packageFile,JSON.stringify(pack));
 return {directory,root,inbox,pack,packageFile,sha,async save(){pack.contentSha256=await packageDigest(pack);await writeFile(packageFile,JSON.stringify(pack));},async cleanup(){const target=resolve(directory);if(!target.startsWith(base+sep))throw Error('Unsafe fixture cleanup');await rm(target,{recursive:true,force:true});}};
}
export function assistantReport(pack:TaskPackage,sha:string){return {format:'IdeaClipCodexDelivery',schemaVersion:2,taskPackage:{packageId:pack.packageId,contentSha256:pack.contentSha256},reportId:randomUUID(),projectId:pack.task.projectId,taskId:pack.task.taskId,repository:pack.task.repository,commitSha:sha,summary:'合成Mock交付，不代表执行产品开发或测试',files:['docs/sample.md'],tests:[],notRun:[{command:'软件开发与测试',reason:'本轮只验交接，未执行'}],risks:['合成数据，未独立核验'],generatedAt:new Date().toISOString(),localRecordId:null};}
