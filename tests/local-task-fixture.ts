import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {assistantFixture,repository} from './handoff-assistant-fixture';
import {LocalTaskController,LocalTaskError,type LocalTaskDriver} from '../tools/local-task';
export const localAck={task:true,trustedWorkspace:true,modelUsage:false};
export async function localTaskFixture(){
 const f=await assistantFixture(),git=(...args:string[])=>execFileSync('git',['-c','core.autocrlf=false','-C',f.root,...args],{encoding:'utf8',windowsHide:true}).trim();
 const options={policy:{input:{mode:'check' as const,packageFile:f.packageFile,workspace:f.root,repository},projectId:f.pack.task.projectId,taskId:f.pack.task.taskId,branch:git('branch','--show-current'),allowedPaths:['docs'],codexExecutable:'Mock CLI - never launched'},model:'mock-no-model',timeoutMs:1000};
 const commit=()=>{git('add','--all');git('-c','user.name=IdeaClip Mock','-c','user.email=mock@example.invalid','-c','core.hooksPath=NUL','commit','-qm','单任务合成修改');};
 const driver:LocalTaskDriver={kind:'mock',inspect:async()=>({version:'Mock CLI',supported:true,fingerprint:'mock'}),run:async()=>{await writeFile(join(f.root,'docs/sample.md'),'Fixed local Mock output.\n');commit();return {exitCode:0,completed:true};}};
 const waiting:LocalTaskDriver={...driver,run:async({signal})=>new Promise((_,reject)=>{const stop=()=>reject(new LocalTaskError('REQUEST_CANCELLED'));signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();})};
 return {...f,git,commit,options,driver,waiting,controller:(d=driver,now?:()=>number,steady?:()=>number)=>new LocalTaskController(options,d,now,steady)};
}
