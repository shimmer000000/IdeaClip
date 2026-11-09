import {db,type IdeaClipDB,type Project} from '../storage';
import type {Task} from './model';
import {taskInstruction,validateWorkspace} from './instructions';
import {githubRepository,normalizeGitHub,taskMaterial} from './github';
import {evidenceText} from './evidence-text';
import {digest,evidencePath,type CodexReport} from './local-evidence-model';
import {canonical,decodeTaskPackage,packageDigest,packageHistories,DELIVERY_CONTRACT,type TaskPackage,type PackageHistory,PACKAGE_BYTES,packageUuid} from './task-package-model';

export const currentPackageBinding=(p:Project,t:Task)=>canonical({projectId:p.id,projectTitle:p.title,purpose:p.projectPurpose,workspace:p.workspace??null,task:taskMaterial(t),reviewed:t.reviewed});
function packageTask(p:Project,t:Task):TaskPackage['task']{
 if(t.kind!=='development'||p.projectPurpose!=='development')throw Error('仅真实开发项目中的软件开发任务可导出；人工研究和验证测试不可转换。');
 if(!t.reviewed)throw Error('任务尚未完成审核，禁止导出。');if(t.status==='done')throw Error('已完成任务不再交接执行，请另建明确任务。');
 if(!t.acceptance.trim()||/^(待人工填写|待补充|待确认)/.test(t.acceptance.trim()))throw Error('请先填写当前任务的验收标准并审核。');
 const w=validateWorkspace(p.workspace??{repository:'',directory:'',scope:[]}),repository=githubRepository(w.repository);
 if(t.github&&normalizeGitHub(t.github).repository.toLowerCase()!==repository.toLowerCase())throw Error('任务仓库与工作区不一致，禁止导出。');
 if(/[$%]/.test(w.directory))throw Error('工作目录不能包含环境变量或展开符号。');
 const allowedPaths=[...new Set(w.scope.map(s=>evidencePath(s.replace(/\\/g,'/'))))];
 // Reuse single-task safety gates, including mixed human-research rejection. No code is executed.
 const instructions=taskInstruction(p,t);
 return {projectId:packageUuid(p.id),taskId:packageUuid(t.id),type:'development',projectPurpose:'development',goal:evidenceText(t.title),notes:evidenceText(t.notes),repository,workingDirectory:w.directory.replace(/\\/g,'/'),allowedPaths,acceptance:evidenceText(t.acceptance),instructions};
}
async function load(projectId:string,taskId:string,database:IdeaClipDB){const p=await database.projects.get(projectId),t=p?.tasks?.find(t=>t.id===taskId);if(!p||!t)throw Error('项目或任务不存在。');return {p,t};}
export async function previewTaskPackage(projectId:string,taskId:string,database=db):Promise<TaskPackage>{
 const {p,t}=await load(projectId,taskId,database),task=packageTask(p,t);if((t.taskPackages??[]).length>=10)throw Error('已有10版任务包，旧历史保留，不再追加。');
 const unsigned={format:'IdeaClipCodexTask' as const,schemaVersion:1 as const,packageId:crypto.randomUUID(),generatedAt:new Date().toISOString(),executionAuthorized:false as const,task,delivery:DELIVERY_CONTRACT};
 const result={...unsigned,contentSha256:await packageDigest(unsigned)};return decodeTaskPackage(JSON.stringify(result));
}
function assertCurrent(pack:TaskPackage,p:Project,t:Task){const expected=packageTask(p,t);if(canonical(pack.task)!==canonical(expected))throw Error('任务包项目、任务、仓库、范围或内容与当前审核快照不一致，未接受。');}
export async function confirmPackageExport(projectId:string,taskId:string,pack:TaskPackage,confirmed:boolean,database=db){
 if(!confirmed)throw Error('请预览并人工确认任务包范围和安全提示。');
 const valid=await decodeTaskPackage(JSON.stringify(pack)),before=await load(projectId,taskId,database);assertCurrent(valid,before.p,before.t);
 if(Date.now()-Date.parse(valid.generatedAt)>10*60*1000||Date.parse(valid.generatedAt)>Date.now())throw Error('预览已过期，请重新生成并确认。');
 const binding=currentPackageBinding(before.p,before.t),bindingHash=await digest(binding);
 return database.transaction('rw',database.projects,async()=>{const {p,t}=await load(projectId,taskId,database);if(currentPackageBinding(p,t)!==binding)throw Error('确认期间任务变化，未导出旧包。');assertCurrent(valid,p,t);const rows=packageHistories(t.taskPackages??[]),old=rows.find(h=>h.packageId===valid.packageId);if(old){if(old.contentSha256!==valid.contentSha256)throw Error('任务包ID冲突。');return valid;}if(rows.length>=10)throw Error('任务包历史已满，未覆盖。');rows.push({packageId:valid.packageId,contentSha256:valid.contentSha256,bindingHash,generatedAt:valid.generatedAt,exportedAt:Date.now(),handedOffAt:null,historical:false});t.taskPackages=rows;p.revision=(p.revision??0)+1;await database.projects.put(p);return valid;});
}
export async function checkTaskPackage(projectId:string,taskId:string,text:string,database=db){
 const pack=await decodeTaskPackage(text),{p,t}=await load(projectId,taskId,database);assertCurrent(pack,p,t);const h=packageHistories(t.taskPackages??[]).find(h=>h.packageId===pack.packageId&&h.contentSha256===pack.contentSha256);
 if(!h||h.historical||h.bindingHash!==await digest(currentPackageBinding(p,t)))throw Error('任务包未在本任务导出、仅为历史记录或审核已失效，未接受。');return '任务包哈希、项目任务、仓库和允许范围一致；仅数据核对，不是执行授权。';
}
export async function markPackageHandedOff(projectId:string,taskId:string,packageId:string,confirmed:boolean,database=db){
 if(!confirmed)throw Error('请人工确认已经通过本地文件交接；此操作不启动Codex。');const before=await load(projectId,taskId,database);packageTask(before.p,before.t);const binding=currentPackageBinding(before.p,before.t),hash=await digest(binding);
 return database.transaction('rw',database.projects,async()=>{const {p,t}=await load(projectId,taskId,database);packageTask(p,t);const h=t.taskPackages?.find(h=>h.packageId===packageId);if(!h||h.historical||h.bindingHash!==hash||currentPackageBinding(p,t)!==binding)throw Error('任务包已失效或仅为历史，请重新审核导出。');if(!h.handedOffAt){h.handedOffAt=Date.now();p.revision=(p.revision??0)+1;await database.projects.put(p);}});
}
// Called before the report write transaction, then rechecked synchronously inside it.
export async function linkedPackageContext(projectId:string,taskId:string,report:CodexReport,database:IdeaClipDB){
 if(report.schemaVersion===1)return null;
 const {p,t}=await load(projectId,taskId,database),ref=report.taskPackage!,h=packageHistories(t.taskPackages??[]).find(h=>h.packageId===ref.packageId&&h.contentSha256===ref.contentSha256);
 if(!h||h.historical||h.bindingHash!==await digest(currentPackageBinding(p,t))||Date.parse(report.generatedAt)<Date.parse(h.generatedAt))throw Error('交付报告引用的任务包不存在、已变化、时间不符或为恢复历史，未导入。');packageTask(p,t);
 return {binding:currentPackageBinding(p,t),history:canonical(h)};
}
export function packageStage(t:Task,h:PackageHistory){if(h.historical)return '历史交接快照（不授予执行权）';if(t.localDeliveries?.some(e=>e.report.taskPackage?.packageId===h.packageId&&e.report.taskPackage.contentSha256===h.contentSha256))return '结果已导入（未自动验收）';return h.handedOffAt?'已交接（仅人工记录）':'待执行（已生成导出记录）';}
export {PACKAGE_BYTES};
