// Fixed project commands only. This development CLI never reads imported reports.
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {evidenceText} from '../src/incubation/evidence-text.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
if(git('remote','get-url','origin')!=='https://github.com/shimmer000000/IdeaClip.git'&&git('remote','get-url','origin')!=='https://github.com/shimmer000000/IdeaClip')throw Error('Unexpected repository');
if(git('status','--porcelain'))throw Error('Commit source changes before recording evidence');
const commitSha=git('rev-parse','HEAD'),treeSha=git('rev-parse','HEAD^{tree}'),recordId=randomUUID();
const commands=[['typecheck','npm run typecheck'],['unit','npm test -- --maxWorkers=1 --testNamePattern "^(?!.*Windows PowerShell5\\.1真实启停)"'],['build','npm run build'],['chrome','npm run test:e2e -- tests/browser/local-evidence.spec.ts tests/browser/github-delivery.spec.ts tests/browser/github-sync.spec.ts tests/browser/github-tasks.spec.ts tests/browser/task-instructions.spec.ts tests/browser/ai.spec.ts tests/browser/online-research.spec.ts --output=test-results/0.1.7-record']];
const tests=[],logs=[];
for(const [label,command] of commands){const startedAt=new Date().toISOString();let tail='';const exitCode=await new Promise((resolve,reject)=>{const child=spawn(process.env.ComSpec||'cmd.exe',['/d','/s','/c',command],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});const collect=b=>{tail=(tail+b.toString('utf8')).slice(-65536);};child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',reject);child.on('close',resolve);});const finishedAt=new Date().toISOString(),content=evidenceText(tail).slice(-16384),id=randomUUID();tests.push({id,command,status:exitCode===0?'passed':'failed',exitCode,startedAt,finishedAt,durationMs:Date.parse(finishedAt)-Date.parse(startedAt),logExcerpt:content.slice(-2000),logSha256:createHash('sha256').update(content).digest('hex')});logs.push({testId:id,content});process.stdout.write(`${label}: exit=${exitCode}, ${tests.at(-1).durationMs}ms\n`);}
if(git('status','--porcelain')||git('rev-parse','HEAD')!==commitSha)throw Error('Source changed during recording; evidence not published');
const record={format:'IdeaClipLocalTestRecord',schemaVersion:1,recordId,repository:'https://github.com/shimmer000000/IdeaClip',commitSha,treeSha,tests,logs,generatedAt:new Date().toISOString()};
await mkdir(new URL(`../private/test-evidence/${recordId}/`,import.meta.url),{recursive:true});await writeFile(new URL(`../private/test-evidence/${recordId}/record.json`,import.meta.url),JSON.stringify(record,null,2),'utf8');
process.stdout.write(`recordId=${recordId}\ncommit=${commitSha}\n`);if(tests.some(t=>t.status==='failed'))process.exitCode=1;
