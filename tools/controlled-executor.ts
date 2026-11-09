import {mkdtemp,mkdir,writeFile,readFile,open,readdir,lstat,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SingleUseMockGate,GateError,type GatePreview,type MockPermit} from '../src/incubation/execution-gate.ts';
import {canonical,packageDigest,DELIVERY_CONTRACT,type TaskPackage} from '../src/incubation/task-package-model.ts';
import {localPreflight,type PreflightPolicy} from './codex-preflight.ts';
import {safePath,scopeOnDisk} from './codex-handoff.ts';
import {realExecutionPreview} from '../src/incubation/synthetic-capability.ts';

const gitFile=promisify(execFile),sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const repository='https://github.com/shimmer000000/IdeaClip',allowedFile='docs/result.txt';
export type SyntheticOutcome='success'|'timeout'|'crash';
export interface ExecutorRecord {format:'IdeaClipSyntheticExecution';schemaVersion:1;runId:string;projectId:string;taskId:string;packageId:string;packageHash:string;repository:string;binding:string;generatedAt:string;state:'completed'|'failed';code:string;durationMs:number;changedFiles:string[];deniedCapabilities:string[];actualCodexStarted:false;networkRequests:0;humanAcceptanceChanged:false;automaticRetry:false}
export class ExecutorError extends Error {code:string;constructor(code:string){super(code);this.code=code;}}
const fail=(code:string):never=>{throw new ExecutorError(code);};
async function files(root:string){
 const result:Record<string,string>={};let count=0;
 async function visit(path:string){for(const entry of await readdir(join(root,path),{withFileTypes:true})){if(!path&&entry.name==='.git')continue;if(++count>100||path.split('/').length>8)fail('AUDIT_LIMIT');const p=path?path+'/'+entry.name:entry.name;await scopeOnDisk(root,p);if(entry.isSymbolicLink())fail('PATH_LINK_REJECTED');if(entry.isDirectory())await visit(p);else if(entry.isFile()){if((await lstat(join(root,p))).size>65536)fail('AUDIT_LIMIT');result[p]=sha(await readFile(join(root,p)));}else fail('SPECIAL_FILE_REJECTED');}}
 await visit('');return result;
}
// Factory owns a fresh synthetic repository. No constructor accepts a user workspace or task commands.
export async function createSyntheticExecutor(){
 const base=resolve('test-results/controlled-executor');await mkdir(base,{recursive:true});await safePath(base);
 const directory=await mkdtemp(join(base,'synthetic-')),root=join(directory,'workspace');await mkdir(root);await mkdir(join(root,'docs'));
 const git=async(...args:string[])=>(await gitFile('git',['-c','core.autocrlf=false','-c','core.hooksPath=NUL','-C',root,...args],{windowsHide:true,timeout:10000,maxBuffer:128*1024})).stdout.trim();
 await git('init','-q','-b','main');await git('remote','add','origin',repository+'.git');await writeFile(join(root,'outside-canary.txt'),'Synthetic canary only');await writeFile(join(root,'docs/input.txt'),'Synthetic input only');await git('add','.');await git('-c','user.name=IdeaClip Mock','-c','user.email=mock@example.invalid','commit','-qm','合成执行器样本');
 const pack:TaskPackage={format:'IdeaClipCodexTask',schemaVersion:1,packageId:randomUUID(),generatedAt:new Date().toISOString(),contentSha256:'',executionAuthorized:false,task:{projectId:randomUUID(),taskId:randomUUID(),type:'development',projectPurpose:'development',goal:'固定合成能力测试，不开发产品',notes:'不运行导入命令',repository,workingDirectory:root,allowedPaths:[allowedFile],acceptance:'范围外/读取/网络/进程能力在运行时拒绝',instructions:'仅数据'},delivery:DELIVERY_CONTRACT};pack.contentSha256=await packageDigest(pack);
 const packageFile=join(directory,'task.json');await writeFile(packageFile,JSON.stringify(pack));
 const policy:PreflightPolicy={input:{mode:'check',packageFile,workspace:root,repository},projectId:pack.task.projectId,taskId:pack.task.taskId,branch:'main',allowedPaths:[allowedFile],codexExecutable:'fixed synthetic guest; no Codex executable'};
 const probe=async()=>({version:'Fixed WebAssembly guest, NOT Codex',supported:true,fingerprint:'fixed-capability-v1'});
 const reads=new Set<Promise<unknown>>();
 const read=()=>{const p=localPreflight(policy,probe);reads.add(p);void p.finally(()=>reads.delete(p)).catch(()=>{});return p;};
 const gate=new SingleUseMockGate(read),bindings=new WeakMap<object,{snapshot:string;deadline:number}>(),records:ExecutorRecord[]=[];
 let busy=false,disposed=false,guestRunning=false;
 return {
  fixture:Object.freeze({directory,root,packageFile}),
  async preview(){if(disposed)fail('SESSION_CLOSED');return gate.preview();},
  async authorize(preview:GatePreview,confirmed:boolean,ttl=120000){if(disposed)fail('SESSION_CLOSED');const permit=await gate.authorize(preview,confirmed,ttl);bindings.set(permit,{snapshot:canonical(preview.snapshot),deadline:performance.now()+ttl});return permit;},
  records(){return structuredClone(records);},
  activity(){return {busy,guestRunning};},
  realPreview:realExecutionPreview,
  async runReal():Promise<never>{return fail('REAL_EXECUTOR_DISABLED');},
  async run(permit:MockPermit|null,options:{outcome?:SyntheticOutcome;timeoutMs?:number;signal?:AbortSignal}={}){
   if(disposed)fail('SESSION_CLOSED');if(busy)fail('EXECUTOR_BUSY');busy=true;
   let record:ExecutorRecord|undefined,before:Record<string,string>|undefined;const started=performance.now();
   try{
    if(records.length>=20)fail('RECORD_LIMIT');
    // This burns the original in-memory capability before any guest can start.
    await gate.runMock(permit,{signal:options.signal});
    const frozen=bindings.get(permit!);if(!frozen)throw new ExecutorError('AUTH_UNKNOWN');
    const snapshot=await read();if(canonical(snapshot)!==frozen.snapshot)fail('SNAPSHOT_CHANGED');
    const checkTime=()=>{if(Date.now()<permit!.issuedAt||Date.now()>=permit!.expiresAt||performance.now()>=frozen.deadline)fail('AUTH_EXPIRED');if(options.signal?.aborted)fail('CANCELLED');};checkTime();
    record={format:'IdeaClipSyntheticExecution',schemaVersion:1,runId:randomUUID(),projectId:snapshot.projectId,taskId:snapshot.taskId,packageId:snapshot.packageId,packageHash:snapshot.packageHash,repository:snapshot.repository,binding:sha(frozen.snapshot),generatedAt:new Date().toISOString(),state:'failed',code:'UNKNOWN',durationMs:0,changedFiles:[],deniedCapabilities:[],actualCodexStarted:false,networkRequests:0,humanAcceptanceChanged:false,automaticRetry:false};
    const timeout=options.timeoutMs??1000,outcome=options.outcome??'success';
    if(!Number.isInteger(timeout)||timeout<100||timeout>5000||!['success','timeout','crash'].includes(outcome))fail('INVALID_FIXED_PROGRAM');
    if(options.signal?.aborted)fail('CANCELLED');
    before=await files(root);checkTime();
    // Absolute installed Node + fixed host script/flags only; no shell or imported command.
    const worker=spawn(process.execPath,['--max-old-space-size=32','--stack-size=1024',fileURLToPath(new URL('./synthetic-worker.mjs',import.meta.url))],{cwd:directory,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,env:{},shell:false});
    const closed=new Promise<void>(r=>worker.once('close',()=>r()));
    try{
     const result=await new Promise<unknown>((resolve,reject)=>{
      const stop=(code:string)=>reject(new ExecutorError(code));
      const timer=setTimeout(()=>stop('TIMEOUT'),timeout),cancel=()=>stop('CANCELLED');
      options.signal?.addEventListener('abort',cancel,{once:true});
      worker.on('message',data=>{if(data&&typeof data==='object'&&'kind' in data&&data.kind==='ready')guestRunning=true;else resolve(data);});worker.once('error',()=>stop('GUEST_TERMINATED'));worker.once('exit',()=>stop('GUEST_TERMINATED'));
      worker.once('spawn',()=>{if(options.signal?.aborted)cancel();else worker.send(outcome,e=>{if(e)stop('GUEST_TERMINATED');});});
      // Cleanup listeners even when cancellation races startup.
      worker.once('close',()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);});
      if(options.signal?.aborted)cancel();
     });
     if(JSON.stringify(result)!==JSON.stringify({kind:'done',attempts:[0,1,2,3,4],results:[0,-1,-1,-1,-1]}))fail('GUEST_RESPONSE_INVALID');
     checkTime();
     record.deniedCapabilities=['OUTSIDE_WRITE','HOST_READ','NETWORK','PROCESS'];
     // The guest has no host handles. The trusted broker exposes ONE exclusive-create capability.
     await scopeOnDisk(root,allowedFile);await safePath(root);await safePath(join(root,'docs'));
     const handle=await open(join(root,allowedFile),'wx');try{await handle.writeFile('IdeaClip fixed synthetic result\n');}finally{await handle.close();}
     const after=await files(root);record.changedFiles=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before![p]!==after[p]);
     if(record.changedFiles.some(p=>p!==allowedFile))fail('OUTSIDE_CHANGE_DETECTED');
     record.state='completed';record.code='SYNTHETIC_COMPLETED';record.durationMs=Math.round(performance.now()-started);return structuredClone(record);
    }finally{if(worker.exitCode===null)worker.kill();await closed;guestRunning=false;}
   }catch(e){if(record)record.code=e instanceof ExecutorError||e instanceof GateError?e.code:'LOCAL_PROCESSING_FAILED';throw e instanceof ExecutorError||e instanceof GateError?e:new ExecutorError('LOCAL_PROCESSING_FAILED');}
   finally{try{if(record){if(before&&record.state==='failed'){try{const after=await files(root);record.changedFiles=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before![p]!==after[p]);if(record.changedFiles.some(p=>p!==allowedFile)){record.state='failed';record.code='OUTSIDE_CHANGE_DETECTED';}}catch{record.state='failed';record.code='POST_AUDIT_FAILED';}}record.durationMs=Math.round(performance.now()-started);records.push(record);await writeFile(join(directory,record.runId+'.json'),JSON.stringify(record));}}finally{busy=false;}}
  },
  async close(){if(busy)fail('EXECUTOR_BUSY');disposed=true;await Promise.allSettled([...reads]);if(!resolve(directory).startsWith(base+sep))fail('CLEANUP_BOUNDARY');await safePath(directory);if(!(await lstat(directory)).isDirectory())fail('CLEANUP_BOUNDARY');await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});},
 };
}
export async function executorMain(args:string[]){
 if(args.length!==1||!['--help','preview'].includes(args[0])){process.stdout.write(JSON.stringify({code:'REAL_EXECUTOR_DISABLED',authorized:false})+'\n');process.exitCode=2;return;}
 process.stdout.write(JSON.stringify({format:'IdeaClipControlledExecutor',schemaVersion:1,...realExecutionPreview(),syntheticMethod:'Fixed WASM capability guest in fixed Node child process; not a Codex sandbox',authorization:'Local in-memory, single-use, no JSON grants; no real grant issuer enabled'},null,2)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await executorMain(process.argv.slice(2));
