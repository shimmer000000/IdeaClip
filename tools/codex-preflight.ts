import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat,lstat,opendir} from 'node:fs/promises';
import {basename,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {randomBytes} from 'node:crypto';
import {checkedPackage,readGit,safePath,safeScope,scopeOnDisk,HandoffError,safeError,type AssistantOptions} from './codex-handoff.ts';
import {canonical,packageUuid} from '../src/incubation/task-package-model.ts';
import {digest,evidenceRepository} from '../src/incubation/local-evidence-model.ts';
import {evidenceText} from '../src/incubation/evidence-text.ts';
import {SingleUseMockGate,type ExecutionSnapshot,GateError} from '../src/incubation/execution-gate.ts';

const run=promisify(execFile);
export interface PreflightPolicy {input:AssistantOptions;projectId:string;taskId:string;branch:string;allowedPaths:string[];codexExecutable:string}
export interface CodexInspection {version:string;supported:boolean;fingerprint:string}
async function scopeFingerprint(root:string,paths:string[]){
 const rows:unknown[]=[],seen=new Set<string>();
 async function visit(path:string,depth:number){
  if(seen.has(path))return;seen.add(path);if(seen.size>2000||depth>16)throw new HandoffError('SCOPE_SCAN_LIMIT');
  await scopeOnDisk(root,path);const absolute=join(root,...path.split('/'));
  let st;try{st=await lstat(absolute);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){rows.push([path,'missing']);return;}throw e;}
  if(st.isSymbolicLink())throw new HandoffError('PATH_LINK_REJECTED');
  if(!st.isDirectory()&&!st.isFile())throw new HandoffError('SCOPE_SPECIAL_FILE');
  rows.push([path,st.isDirectory()?'directory':'file',st.size,st.mtimeMs,st.ino]);
  if(st.isDirectory())for await(const child of await opendir(absolute))await visit(safeScope(path+'/'+child.name),depth+1);
 }
 for(const path of paths)await visit(path,0);
 return digest(canonical(rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));
}
export async function inspectCodex(executable:string):Promise<CodexInspection>{
 const path=await safePath(executable);if(!['codex.exe','codex'].includes(basename(path).toLowerCase()))throw new HandoffError('CODEX_EXECUTABLE_INVALID');
 try{
  const before=await stat(path);
  // Only installed CLI metadata/help. Never interpolate a package prompt or call an execution command.
  const version=(await run(path,['--version'],{timeout:10000,maxBuffer:128*1024,windowsHide:true})).stdout.trim();
  const help=(await run(path,['help','exec'],{timeout:10000,maxBuffer:128*1024,windowsHide:true})).stdout;
  const after=await stat(path);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error();
  if(!/^codex-cli \d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))throw Error();
  return {version,supported:['--cd','--sandbox','--json'].every(flag=>help.includes(flag)),fingerprint:await digest(canonical({path,version,help,size:after.size,mtime:after.mtimeMs}))};
 }catch{throw new HandoffError('CODEX_INSPECTION_FAILED');}
}
export async function localPreflight(policy:PreflightPolicy,probe=inspectCodex):Promise<ExecutionSnapshot>{
 const {pack,root}=await checkedPackage(policy.input);
 const projectId=packageUuid(policy.projectId),taskId=packageUuid(policy.taskId),repository=evidenceRepository(policy.input.repository);
 if(pack.task.projectId!==projectId||pack.task.taskId!==taskId)throw new HandoffError('TASK_MISMATCH');
 if(!policy.allowedPaths.length||policy.allowedPaths.length>20)throw new HandoffError('EXPLICIT_SCOPE_REQUIRED');
 const allowed=policy.allowedPaths.map(safeScope);
 if(new Set(allowed).size!==allowed.length||!pack.task.allowedPaths.every(p=>allowed.some(s=>p===s||p.startsWith(s+'/'))))throw new HandoffError('SCOPE_EXPANSION');
 for(const path of allowed)await scopeOnDisk(root,path);
 const scope=await scopeFingerprint(root,pack.task.allowedPaths);
 const head=await readGit(root,['rev-parse','--verify','HEAD']),branch=await readGit(root,['branch','--show-current']);
 const status=await readGit(root,['status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=none']);
 const index=await readGit(root,['ls-files','--stage','-v','-z']),unmerged=await readGit(root,['ls-files','--unmerged','-z']);
 const origin=await readGit(root,['config','--local','--get-all','remote.origin.url']);
 const codex=await probe(policy.codexExecutable),again=await checkedPackage(policy.input);
 if(pack.contentSha256!==again.pack.contentSha256||head!==await readGit(root,['rev-parse','--verify','HEAD'])||branch!==await readGit(root,['branch','--show-current'])||index!==await readGit(root,['ls-files','--stage','-v','-z'])||status!==await readGit(root,['status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=none'])||origin!==await readGit(root,['config','--local','--get-all','remote.origin.url'])||scope!==await scopeFingerprint(root,pack.task.allowedPaths))throw new HandoffError('INPUT_CHANGED');
 const blockers:string[]=[];if(!branch)blockers.push('DETACHED_HEAD');if(!policy.branch||branch!==policy.branch)blockers.push('BRANCH_MISMATCH');if(status)blockers.push('GIT_DIRTY');if(unmerged)blockers.push('GIT_CONFLICT');if(!codex.supported)blockers.push('CODEX_ARGUMENTS_UNSUPPORTED');
 return {source:'local-preflight',projectId,taskId,packageId:pack.packageId,packageHash:pack.contentSha256,repository,workspace:root,allowedPaths:[...pack.task.allowedPaths],goal:evidenceText(pack.task.goal),binding:await digest(canonical({pack:pack.contentSha256,projectId,taskId,repository,root,allowed,branch:policy.branch})),git:{head,branch:evidenceText(branch),dirty:!!status,conflicts:!!unmerged,fingerprint:await digest(canonical({head,branch,status,index,unmerged,root,origin,scope}))},codex,blockers};
}
export function preflightArguments(args:string[]):{mode:'preview'|'mock-once';policy:PreflightPolicy}|null{
 if(args.length===1&&args[0]==='--help')return null;
 const mode=args.shift();if(mode!=='preview'&&mode!=='mock-once')throw new HandoffError('ARGUMENT_INVALID');
 const fields:Record<string,string>={},allowedPaths:string[]=[],keys=['--package','--workspace','--repository','--project-id','--task-id','--branch','--codex-executable'];
 while(args.length){const key=args.shift()!,value=args.shift();if(!value||value.startsWith('--'))throw new HandoffError('ARGUMENT_INVALID');if(key==='--allow-path'){allowedPaths.push(value);continue;}if(!keys.includes(key)||fields[key])throw new HandoffError('ARGUMENT_INVALID');fields[key]=value;}
 if(keys.some(k=>!fields[k])||!allowedPaths.length)throw new HandoffError('EXPLICIT_POLICY_REQUIRED');
 return {mode,policy:{input:{mode:'check',packageFile:fields['--package'],workspace:fields['--workspace'],repository:fields['--repository']},projectId:fields['--project-id'],taskId:fields['--task-id'],branch:fields['--branch'],allowedPaths,codexExecutable:fields['--codex-executable']}};
}
export async function preflightMain(args:string[]){
 try{
  const parsed=preflightArguments([...args]);if(!parsed){process.stdout.write('IdeaClip 0.2.3 单次Mock授权门禁（没有真实执行器）\npreview|mock-once --package <绝对JSON> --workspace <绝对工作区> --repository <HTTPS仓库> --project-id <UUID> --task-id <UUID> --branch <预期分支> --allow-path <已有范围，可重复> --codex-executable <明确受信任已安装Codex绝对路径>\n');return;}
  const gate=new SingleUseMockGate(()=>localPreflight(parsed.policy)),preview=await gate.preview();
  process.stdout.write(JSON.stringify({format:'IdeaClipExecutionPreflight',schemaVersion:1,...preview,snapshot:{...preview.snapshot,workspace:'[已与明确工作目录核对]'},plannedMethod:'仅内存Mock；未来Codex exec参数仅探测--cd/--sandbox/--json，不构造或执行命令',externalOperations:'当前无外部操作；未来真实执行可能联网、写文件或推送，须另行设计与逐项授权',authorized:false},null,2)+'\n');
  if(parsed.mode==='preview'){if(preview.snapshot.blockers.length)process.exitCode=2;return;}
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new HandoffError('INTERACTIVE_CONFIRMATION_REQUIRED');
  if(preview.snapshot.blockers.length)throw new GateError('PREFLIGHT_BLOCKED');
  const challenge='批准单次Mock '+randomBytes(12).toString('hex'),reader=createInterface({input:process.stdin,output:process.stdout});
  try{const answer=await reader.question(`工作目录（仅本次本地预览）：${parsed.policy.input.workspace}\n仅限该项目/任务/哈希的Mock，不授权真实Codex。若确认，请原样输入：${challenge}\n`);const permit=await gate.authorize(preview,answer===challenge);process.stdout.write(JSON.stringify(await gate.runMock(permit))+'\n');}finally{reader.close();}
 }catch(e){process.stdout.write(JSON.stringify({ok:false,code:e instanceof GateError?e.code:safeError(e),realExecutionAuthorized:false})+'\n');process.exitCode=2;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await preflightMain(process.argv.slice(2));
