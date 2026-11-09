/** One-shot, read-only handoff validation. This module has no task executor. */
import {lstat,open,realpath,opendir,readFile} from 'node:fs/promises';
import {isAbsolute,join,parse,relative,resolve,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {decodeTaskPackage,PACKAGE_BYTES} from '../src/incubation/task-package-model.ts';
import {digest,evidencePath,evidenceRepository,parseEvidence,REPORT_BYTES,sourceName,validateCodexReport} from '../src/incubation/local-evidence-model.ts';
import {evidenceText} from '../src/incubation/evidence-text.ts';

const runFile=promisify(execFile);
export class HandoffError extends Error {code:string;constructor(code:string){super(code);this.code=code;}}
function fail(code:string):never {throw new HandoffError(code);}
const equalPath=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const isInside=(root:string,path:string)=>{const r=relative(root,path);return r===''||!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r);};
const noExecution={authorized:false,state:'awaiting-single-use-user-approval',executor:'not-implemented'} as const;
const safetyNotice='只读校验，不是执行授权；须回IdeaClip复查当前审核与绑定。任何后续执行须单次明确批准，本版不能启动Codex。';

// Reject links/junctions in every existing component, including parents of explicit inputs.
export async function safePath(input:string,missing=false){
 if(!isAbsolute(input)||input.startsWith('\\\\')||input.startsWith('//')||/[\x00-\x1f]/.test(input))fail('PATH_INVALID');
 const path=resolve(input);let cursor=parse(path).root;
 for(const part of path.slice(cursor.length).split(sep).filter(Boolean)){
  cursor=join(cursor,part);
  try{const st=await lstat(cursor);if(st.isSymbolicLink())fail('PATH_LINK_REJECTED');}
  catch(e){if(missing&&(e as NodeJS.ErrnoException).code==='ENOENT')return path;throw e;}
 }
 const actual=await realpath(path);if(!equalPath(actual,path))fail('PATH_ALIAS_REJECTED');return actual;
}
export function safeScope(value:string){
 const path=evidencePath(value);
 if(path.split('/').some(p=>p.endsWith('.')||p.endsWith(' ')||p.toLowerCase()==='.git'||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail('SCOPE_UNSAFE');
 return path;
}
export async function scopeOnDisk(root:string,value:string){
 const path=join(root,...safeScope(value).split('/'));if(!isInside(root,path))fail('SCOPE_OUTSIDE');
 await safePath(path,true);
 let cursor=root;
 for(const part of safeScope(value).split('/')){
  cursor=join(cursor,part);
  try{await lstat(join(cursor,'.git'));fail('NESTED_REPOSITORY');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'&&(e as NodeJS.ErrnoException).code!=='ENOTDIR')throw e;}
 }
}
async function boundedJson(file:string,max:number){
 const path=await safePath(file),st=await lstat(path);if(!st.isFile()||st.size>max)fail('FILE_SIZE_OR_TYPE');
 const handle=await open(path,'r');try{
  const opened=await handle.stat();if(opened.ino!==st.ino||opened.dev!==st.dev||opened.size!==st.size)fail('INPUT_CHANGED');
  await safePath(path);
  const bytes=Buffer.alloc(max+1);let used=0;
  while(used<bytes.length){const r=await handle.read(bytes,used,bytes.length-used,null);if(!r.bytesRead)break;used+=r.bytesRead;}
  if(used>max)fail('FILE_SIZE_OR_TYPE');
  const after=await handle.stat();if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)fail('INPUT_CHANGED');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used));
 }finally{await handle.close();}
}
const schemaCache=new Map<string,ReturnType<InstanceType<typeof Ajv>['compile']>>();
async function schemaCheck(name:string,value:unknown){
 let check=schemaCache.get(name);if(!check){const schema=JSON.parse(await readFile(new URL('../docs/'+name,import.meta.url),'utf8'));check=new Ajv({strict:true,allErrors:false}).compile(schema);schemaCache.set(name,check);}
 if(!check(value))fail('SCHEMA_INVALID');
}
export async function readGit(root:string,args:string[]):Promise<string>{
 try{return (await runFile('git',['--no-pager','--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',root,...args],{timeout:10000,maxBuffer:256*1024,windowsHide:true,encoding:'utf8'})).stdout.trim();}
 catch{fail('GIT_READ_FAILED');}
}
export interface AssistantOptions {mode:'check'|'collect';packageFile?:string;handoffDirectory?:string;workspace:string;repository:string;inbox?:string}
async function packageInput(options:AssistantOptions){
 if(!!options.packageFile===!!options.handoffDirectory)fail('EXPLICIT_PACKAGE_REQUIRED');
 if(options.packageFile)return options.packageFile;
 const dir=await safePath(options.handoffDirectory!);const files=await rootJsonFiles(dir);
 // Dedicated task directory must contain exactly one task-*.json package. Other JSONs are not opened.
 const packages=files.filter(f=>/^IdeaClip-CodexTask-[a-f0-9-]+\.json$/i.test(f));if(packages.length!==1)fail('PACKAGE_DIRECTORY_AMBIGUOUS');return join(dir,packages[0]);
}
async function rootJsonFiles(dir:string){
 const files:string[]=[];let count=0;
 for await(const entry of await opendir(dir)){
  if(++count>100)fail('DIRECTORY_LIMIT');
  if(entry.name.endsWith('.json')&&(entry.isFile()||entry.isSymbolicLink()))files.push(entry.name);
  if(files.length>20)fail('DIRECTORY_LIMIT');
 }return files.sort();
}
export async function checkedPackage(options:AssistantOptions){
 const text=await boundedJson(await packageInput(options),PACKAGE_BYTES);await schemaCheck('CODEX-TASK-PACKAGE.schema.json',parseEvidence(text,PACKAGE_BYTES));
 const pack=await decodeTaskPackage(text),repository=evidenceRepository(options.repository);
 if(evidenceRepository(pack.task.repository).toLowerCase()!==repository.toLowerCase())fail('REPOSITORY_MISMATCH');
 const root=await safePath(options.workspace);if(!equalPath(resolve(pack.task.workingDirectory),root)||!isAbsolute(pack.task.workingDirectory))fail('WORKSPACE_MISMATCH');
 await safePath(join(root,'.git'));if(!(await lstat(join(root,'.git'))).isDirectory())fail('GIT_LAYOUT_UNSUPPORTED');
 if(!equalPath(await realpath(await readGit(root,['rev-parse','--show-toplevel'])),root))fail('REPOSITORY_ROOT_MISMATCH');
 // Check both raw URL and effective URL (insteadOf rewrites), never echo either on failure.
 for(const args of [['config','--local','--get-all','remote.origin.url'],['remote','get-url','--all','origin']]){
  const urls=(await readGit(root,args)).split(/\r?\n/);if(urls.length!==1||urls[0].replace(/\.git$/,'').toLowerCase()!==repository.toLowerCase())fail('REMOTE_MISMATCH');
 }
 for(const path of pack.task.allowedPaths)await scopeOnDisk(root,path);
 const status=await readGit(root,['status','--porcelain=v1','-z','--untracked-files=normal','--ignore-submodules=all']);
 return {pack,root,dirty:status.length>0};
}
export async function inspectHandoff(options:AssistantOptions){
 if(!['check','collect'].includes(options.mode)||options.mode==='check'&&options.inbox||options.mode==='collect'&&!options.inbox)fail('ARGUMENT_INVALID');
 const {pack,root,dirty}=await checkedPackage(options);
 const result={format:'IdeaClipHandoffCheck',schemaVersion:1,checkedAt:new Date().toISOString(),packageId:pack.packageId,contentSha256:pack.contentSha256,projectId:pack.task.projectId,taskId:pack.task.taskId,repository:pack.task.repository,
  goal:evidenceText(pack.task.goal),acceptance:evidenceText(pack.task.acceptance).slice(0,1000),allowedPaths:pack.task.allowedPaths,workspaceMatched:true,remoteMatched:true,dirty,
  state:dirty?'blocked-uncommitted-changes':'awaiting-single-use-user-approval',execution:noExecution,notice:safetyNotice,reports:[] as {name:string;state:'valid'|'rejected'|'duplicate';code:string;reportId?:string;fileSha256?:string}[]};
 if(options.mode==='collect'){
  const dir=await safePath(options.inbox!),files=await rootJsonFiles(dir);let total=0;
  const seen=new Map<string,{hash:string;index:number}>(),conflicts=new Set<string>();
  for(const name of files){
   const row:{name:string;state:'valid'|'rejected'|'duplicate';code:string;reportId?:string;fileSha256?:string}={name:'[未接受文件名]',state:'rejected',code:'REPORT_INVALID'};
   try{
    row.name=sourceName(name);const text=await boundedJson(join(dir,name),REPORT_BYTES);total+=Buffer.byteLength(text);if(total>2*1024*1024)fail('TOTAL_SIZE_LIMIT');
    const raw=parseEvidence(text,REPORT_BYTES);await schemaCheck('CODEX-DELIVERY.schema.json',raw);const report=validateCodexReport(raw);
    if(report.schemaVersion!==2)fail('DELIVERY_V2_REQUIRED');
    if(report.projectId!==pack.task.projectId||report.taskId!==pack.task.taskId)fail('TASK_MISMATCH');
    if(report.repository.toLowerCase()!==pack.task.repository.toLowerCase())fail('REPOSITORY_MISMATCH');
    if(report.taskPackage?.packageId!==pack.packageId||report.taskPackage.contentSha256!==pack.contentSha256)fail('PACKAGE_HASH_MISMATCH');
    if(Date.parse(report.generatedAt)<Date.parse(pack.generatedAt))fail('REPORT_PREDATES_PACKAGE');
    for(const path of report.files){if(!pack.task.allowedPaths.some(s=>path===s||path.startsWith(s+'/')))fail('FILE_OUTSIDE_SCOPE');await scopeOnDisk(root,path);}
    const hash=await digest(text),previous=seen.get(report.reportId);row.reportId=report.reportId;row.fileSha256=hash;
    if(conflicts.has(report.reportId)||previous&&previous.hash!==hash){conflicts.add(report.reportId);if(previous)result.reports[previous.index]={...result.reports[previous.index],state:'rejected',code:'REPORT_ID_CONFLICT'};fail('REPORT_ID_CONFLICT');}
    if(!previous)seen.set(report.reportId,{hash,index:result.reports.length});row.state=previous?'duplicate':'valid';row.code=previous?'DUPLICATE_REPORT':'AWAITING_IDEACLIP_CONFIRMATION';
   }catch(e){row.code=safeError(e);}
   result.reports.push(row);
  }
 }
 // Recheck Git dirtiness and package after the scan; no authorization survives this process.
 const final=await checkedPackage(options);if(final.pack.contentSha256!==pack.contentSha256||final.dirty!==dirty)fail('INPUT_CHANGED');
 return result;
}
export function safeError(e:unknown){
 if(e instanceof HandoffError)return e.code;
 const code=(e as NodeJS.ErrnoException)?.code;if(code==='EACCES'||code==='EPERM')return 'ACCESS_DENIED';if(code==='ENOENT')return 'PATH_NOT_FOUND';
 return 'VALIDATION_FAILED'; // Never forward filenames, Git stderr, task text or validator internals.
}
export function argumentsFor(args:string[]):AssistantOptions|null {
 if(args.length===1&&args[0]==='--help')return null;
 const mode=args.shift();if(mode!=='check'&&mode!=='collect')fail('ARGUMENT_INVALID');
 const fields:Record<string,string>={},allowed=['--package','--handoff-dir','--workspace','--repository','--inbox'];
 while(args.length){const key=args.shift()!,value=args.shift();if(!allowed.includes(key)||!value||value.startsWith('--')||fields[key])fail('ARGUMENT_INVALID');fields[key]=value;}
 if(!fields['--workspace']||!fields['--repository'])fail('EXPLICIT_WORKSPACE_AND_REPOSITORY_REQUIRED');
 return {mode,packageFile:fields['--package'],handoffDirectory:fields['--handoff-dir'],workspace:fields['--workspace'],repository:fields['--repository'],inbox:fields['--inbox']};
}
export async function main(args:string[]){
 try{if(Number(process.versions.node.split('.')[0])<24)fail('NODE_VERSION_UNSUPPORTED');const options=argumentsFor([...args]);if(!options){process.stdout.write('IdeaClip 本地一次性交接助手（只读，Node.js 24+）\ncheck|collect --package <绝对JSON路径> 或 --handoff-dir <专用绝对目录> --workspace <明确绝对仓库目录> --repository <GitHub HTTPS仓库> [--inbox <交付专用绝对目录>]\n不会执行任务、启动Codex、联网或写入文件；输出不授予执行权。\n');return;}
  const result=await inspectHandoff(options);process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.dirty||result.reports.some(r=>r.state==='rejected'))process.exitCode=2;
 }catch(e){process.stdout.write(JSON.stringify({ok:false,code:safeError(e),execution:noExecution})+'\n');process.exitCode=2;}
}
if(process.argv[1]&&equalPath(resolve(process.argv[1]),fileURLToPath(import.meta.url)))await main(process.argv.slice(2));
