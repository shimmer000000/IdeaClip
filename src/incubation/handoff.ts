import {db,type IdeaClipDB,type Project} from '../storage';
import type {Task} from './model';
import {currentPackageBinding,linkedPackageContext} from './task-package';
import {type PackageHistory} from './task-package-model';
import {assertReportTarget,evidenceReview,importCodexReport} from './local-evidence';
import {digest,parseEvidence,REPORT_BYTES,sourceName,validateCodexReport,type CodexReport} from './local-evidence-model';
import {ciState,deliveryFresh,scopeState} from './delivery';

export const INBOX_FILES=20,INBOX_BYTES=2*1024*1024,INBOX_ENTRIES=100,INBOX_PREVIEW_MS=600000;
export const HANDOFF_STATES={waiting:'待交接',handed:'已交接',imported:'结果已导入'} as const;
export interface HandoffRow {project:Project;task:Task;history:PackageHistory;state:keyof typeof HANDOFF_STATES;updatedAt:number;warning:string;awaitingReview:boolean}

export async function handoffRows(projects:Project[]):Promise<HandoffRow[]> {
 const rows:HandoffRow[]=[];
 for(const project of projects)for(const task of project.tasks??[]){
  if(!task.taskPackages?.length)continue;
  const binding=await digest(currentPackageBinding(project,task));
  for(const history of task.taskPackages){
   const reports=(task.localDeliveries??[]).filter(e=>e.report.taskPackage?.packageId===history.packageId&&e.report.taskPackage.contentSha256===history.contentSha256);
   const state=reports.length?'imported':history.handedOffAt?'handed':'waiting';
   const warning=history.historical?'历史任务包已过期，恢复不授予执行权':history.repository&&history.repository.toLowerCase()!==project.workspace?.repository.toLowerCase()?'仓库绑定不一致，旧任务包已失效':binding!==history.bindingHash||!task.reviewed?'任务内容或执行边界已变更，旧任务包已失效':!project.workspace?'未绑定工作区，不能继续旧交接':'';
   rows.push({project,task,history,state,warning,awaitingReview:!!reports.length&&task.acceptanceReview?.state!=='passed',updatedAt:Math.max(project.updatedAt,history.exportedAt,history.handedOffAt??0,...reports.flatMap(e=>[e.importedAt,e.localCheck?.checkedAt??0]))});
  }
 }
 return rows.sort((a,b)=>b.updatedAt-a.updatedAt||a.history.packageId.localeCompare(b.history.packageId));
}
export function filterHandoffs(rows:HandoffRow[],projectId:string,state:string,from:string,to:string){
 const start=from?Date.parse(from+'T00:00:00'):0,end=to?Date.parse(to+'T23:59:59.999'):Infinity;
 if(!Number.isFinite(start)||Number.isNaN(end)||start>end)throw Error('更新时间范围无效。');
 return rows.filter(r=>(!projectId||r.project.id===projectId)&&(!state||(state==='review'?r.awaitingReview:state==='expired'?!!r.warning:r.state===state))&&r.updatedAt>=start&&r.updatedAt<=end);
}
export function handoffEvidence(p:Project,t:Task,now=Date.now()){
 const latest=t.localDeliveries?.at(-1),review=latest?evidenceReview(p,t,latest,now):null;
 const fresh=deliveryFresh(t,now),targets=t.deliveryCheck?.targets??[];
 const scopes=fresh?targets.flatMap(x=>x.files.map(f=>scopeState(f,p.workspace,t.github!.repository))):[];
 return {codex:latest?'已导入Codex声明，尚非独立核验':'缺少交付报告',local:latest?.localCheck&&!latest.localCheck.historical?'本地文件一致性已核对，不证明独立执行':'缺少当前本地测试记录核对',remote:review?.remote??(fresh?'已有GitHub成果快照，尚无报告可对照':'缺少最新GitHub成果快照'),ci:fresh?targets.map(x=>ciState(x.ci)).join('；')||'无法判断':'缺少最新CI快照',scope:!p.workspace?'无法判断（未绑定工作区）':!fresh?'尚未取得最新文件清单':scopes.includes('范围外')?'存在范围外文件':scopes.includes('无法判断')||!targets.length||targets.some(x=>!x.filesComplete)?'无法完整判断':'已读取文件均在范围内',missing:[...(review?[...review.conflicts,...review.blockers]:['缺少Codex交付和本地测试证据','远程提交/CI不等同人工验收']),...(t.acceptanceReview?.state!=='passed'?['缺少人工验收通过记录']:[])]};
}

// These are browser-granted handles only. Never resolve filesystem paths or recurse.
export interface InboxFile {name:string;size:number;arrayBuffer:()=>Promise<ArrayBuffer>;webkitRelativePath?:string}
export interface InboxDirectory {kind:'directory';name:string;values:()=>AsyncIterable<InboxDirectory|InboxFileHandle>}
export interface InboxFileHandle {kind:'file';name:string;getFile:()=>Promise<InboxFile>}
export async function directoryFiles(handle:InboxDirectory):Promise<InboxFile[]> {
 const entries:InboxFileHandle[]=[];let count=0;
 for await(const entry of handle.values()){
  if(++count>INBOX_ENTRIES)throw Error('目录第一层超过100项，未读取内容；请改选专用收件箱或少量JSON文件。');
  if(entry.kind==='file'&&entry.name.toLowerCase().endsWith('.json')){sourceName(entry.name);entries.push(entry);}
 }
 if(entries.length>INBOX_FILES)throw Error('JSON文件超过20个，未读取内容。');
 const files:InboxFile[]=[];for(const e of entries)files.push(await e.getFile());return files;
}
export type CandidateState='valid'|'duplicate'|'rejected';
export interface InboxCandidate {name:string;state:CandidateState;reason:string;report?:CodexReport;text?:string;checkedAt:number}
async function inspect(text:string,database:IdeaClipDB):Promise<{report:CodexReport;duplicate:boolean}> {
 const report=validateCodexReport(parseEvidence(text,REPORT_BYTES));
 if(report.schemaVersion!==2)throw Error('收件箱仅接受关联任务包的交付v2；旧v1请在原任务中导入。');
 const p=await database.projects.get(report.projectId),t=p?.tasks?.find(t=>t.id===report.taskId);
 if(!p||!t)throw Error('报告项目ID或任务ID不存在，未接受。');
 assertReportTarget(report,p,t);
 const old=t.localDeliveries?.find(e=>e.report.reportId===report.reportId);
 if(old){if(old.fileDigest!==await digest(text))throw Error('同一报告ID内容冲突，未覆盖旧证据。');return {report,duplicate:true};}
 await linkedPackageContext(p.id,t.id,report,database);
 return {report,duplicate:false};
}
export async function scanInbox(files:InboxFile[],database=db):Promise<InboxCandidate[]> {
 if(!files.length||files.length>INBOX_FILES)throw Error('请选1～20个JSON文件。');
 if(files.some(f=>!Number.isSafeInteger(f.size)||f.size<0)||files.reduce((n,f)=>n+f.size,0)>INBOX_BYTES)throw Error('候选文件总计超过2MiB或大小无效，未读取内容。');
 const rows:InboxCandidate[]=[],seen=new Map<string,{hash:string;index:number}>(),conflicts=new Set<string>();
 for(const file of files){
  const base={name:'不支持的文件名',checkedAt:Date.now()};
  try{
   base.name=sourceName(file.name);
   if(file.webkitRelativePath&&file.webkitRelativePath.split('/').length>2)throw Error('不读取子目录文件，请直接选择第一层JSON。');
   if(file.size>REPORT_BYTES)throw Error('单个报告超过128KiB，未读取内容。');
   let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{throw Error('文件不可读取或不是UTF-8 JSON。');}
   const {report,duplicate}=await inspect(text,database),key=[report.projectId,report.taskId,report.reportId].join(':'),hash=await digest(text),previous=seen.get(key);
   if(conflicts.has(key)||previous&&previous.hash!==hash){conflicts.add(key);if(previous)rows[previous.index]={...rows[previous.index],state:'rejected',text:undefined,reason:'本批同ID内容冲突，整组拒绝'};throw Error('本批存在同ID不同内容报告，整组拒绝。');}
   if(!previous)seen.set(key,{hash,index:rows.length});
   rows.push({...base,report,...(!duplicate&&!previous?{text}:{}),state:duplicate||previous?'duplicate':'valid',reason:duplicate||previous?'重复报告，跳过，不覆盖':'格式、项目任务、仓库、范围和任务包匹配；等待人工确认'});
  }catch(e){rows.push({...base,state:'rejected',reason:e instanceof Error?e.message:'候选读取失败，未接受。'});}
 }
 return rows;
}
export async function confirmInbox(candidates:InboxCandidate[],selected:number[],confirmed:boolean,database=db){
 if(!confirmed)throw Error('请核对所选报告的项目、任务及仓库并确认导入。');
 const indices=[...new Set(selected)];if(!indices.length||indices.length>INBOX_FILES||candidates.length>INBOX_FILES)throw Error('候选选择无效。');
 const results:{name:string;state:'imported'|'skipped'|'failed';message:string}[]=[];
 for(const i of indices){
  const c=candidates[i];if(!Number.isInteger(i)||!c||c.state!=='valid'||!c.text)throw Error('只能选择检查通过的候选。');
  if(Date.now()<c.checkedAt||Date.now()-c.checkedAt>INBOX_PREVIEW_MS)throw Error('候选预览超过10分钟，请重新扫描。');
 }
 for(const i of indices){const c=candidates[i];try{
  sourceName(c.name);const {report,duplicate}=await inspect(c.text!,database);
  if(duplicate){results.push({name:c.name,state:'skipped',message:'已导入，未重复保存'});continue;}
  const message=await importCodexReport(report.projectId,report.taskId,c.text!,c.name,database);
  results.push({name:c.name,state:message.startsWith('同一报告已导入')?'skipped':'imported',message});
 }catch(e){results.push({name:c.name,state:'failed',message:e instanceof Error?e.message:'导入失败，旧记录保留'});}}
 return results;
}
