import {linkedPackageContext,currentPackageBinding} from './task-package';
import {canonical} from './task-package-model';
import {db,type IdeaClipDB,type Project} from '../storage';
import {normalizeGitHub,taskMaterial} from './github';
import {deliveryFresh,deliverySummary,scopeState,ciState} from './delivery';
import {evidenceEntries,validateCodexReport,validateLocalRecord,parseEvidence,digest,sourceName,REPORT_BYTES,RECORD_BYTES,type CodexReport,type EvidenceEntry} from './local-evidence-model';
import type {Task} from './model';

export function assertReportTarget(report:CodexReport,project:Project,task:Task){
 if(report.projectId!==project.id||report.taskId!==task.id)throw Error('报告项目ID或任务ID不属于当前任务，未导入。');
 const bound=task.github?normalizeGitHub(task.github).repository:project.workspace?.repository;
 if(!bound||bound.replace(/\.git$/,'').replace(/\/$/,'').toLowerCase()!==report.repository.toLowerCase()||project.workspace&&project.workspace.repository.replace(/\.git$/,'').replace(/\/$/,'').toLowerCase()!==report.repository.toLowerCase())throw Error('报告仓库与当前任务或工作区绑定不一致，未导入。');
 if(report.files.some(path=>scopeState({path,status:'modified',additions:0,deletions:0},project.workspace,report.repository)==='范围外'))throw Error('报告包含允许修改范围以外的文件，未导入。');
}
const binding=(p:Project,t:Task)=>JSON.stringify([taskMaterial(t),p.workspace??null]);
export async function importCodexReport(projectId:string,taskId:string,text:string,name:string,database:IdeaClipDB=db){
 const report=validateCodexReport(parseEvidence(text,REPORT_BYTES)),fileDigest=await digest(text),safeName=sourceName(name);
 const context=await linkedPackageContext(projectId,taskId,report,database);
 return database.transaction('rw',database.projects,async()=>{const p=await database.projects.get(projectId),t=p?.tasks?.find(t=>t.id===taskId);if(!p||!t)throw Error('项目或任务不存在，未导入。');assertReportTarget(report,p,t);if(context&&(currentPackageBinding(p,t)!==context.binding||!t.taskPackages?.some(h=>h.packageId===report.taskPackage!.packageId&&canonical(h)===context.history)))throw Error('报告导入期间任务包或绑定变化，未导入。');const entries=evidenceEntries(t.localDeliveries??[]),old=entries.find(e=>e.report.reportId===report.reportId);
  if(old){if(old.fileDigest!==fileDigest)throw Error('报告ID已存在但内容不同，请生成新的reportId；未覆盖旧证据。');return '同一报告已导入，未重复创建。';}
  if(entries.length>=10)throw Error('当前任务已达10版报告上限，未覆盖旧证据。');
  entries.push({version:entries.length+1,report,fileDigest,sourceName:safeName,importedAt:Date.now(),historical:false});t.localDeliveries=entries;p.revision=(p.revision??0)+1;await database.projects.put(p);return '交付报告已追加保存；Codex报告，尚未独立核验。';
 });
}
export async function checkLocalEvidence(projectId:string,taskId:string,reportId:string,text:string,name:string,database:IdeaClipDB=db){
 const record=validateLocalRecord(parseEvidence(text,RECORD_BYTES)),recordDigest=await digest(text),safeName=sourceName(name);
 if(!record.tests.length)throw Error('本地记录没有已执行测试，不能标记测试证据已核对。');
 const p=await database.projects.get(projectId),t=p?.tasks?.find(t=>t.id===taskId),entry=t?.localDeliveries?.find(e=>e.report.reportId===reportId);if(!p||!t||!entry)throw Error('待核对报告不存在。');assertReportTarget(entry.report,p,t);const before=binding(p,t),report=entry.report;
 if(record.recordId!==report.localRecordId||record.repository.toLowerCase()!==report.repository.toLowerCase()||record.commitSha!==report.commitSha||JSON.stringify(record.tests)!==JSON.stringify(report.tests)||Date.parse(record.generatedAt)>Date.parse(report.generatedAt))throw Error('本地测试记录与报告的Commit、命令、结果或时间不一致，未标记核对。');
 for(const test of record.tests){const log=record.logs.find(l=>l.testId===test.id)!;if(await digest(log.content)!==test.logSha256||!log.content.includes(test.logExcerpt))throw Error('日志哈希或摘录不一致，未标记核对。');}
 return database.transaction('rw',database.projects,async()=>{const latest=await database.projects.get(projectId),task=latest?.tasks?.find(t=>t.id===taskId),e=task?.localDeliveries?.find(e=>e.report.reportId===reportId);if(!latest||!task||!e||e.fileDigest!==entry.fileDigest||binding(latest,task)!==before)throw Error('核对期间任务或报告变化，未保存过期核对。');e.localCheck={recordId:record.recordId,recordDigest,checkedAt:Date.now(),sourceName:safeName,historical:false};latest.revision=(latest.revision??0)+1;await database.projects.put(latest);return '本地证据已核对（文件一致性）；记录仍由Codex提供，不是独立执行证明。';});
}
export function evidenceReview(project:Project,task:Task,entry:EvidenceEntry,now=Date.now()){
 const r=entry.report,conflicts:string[]=[],blockers:string[]=[];let remote='尚未独立核实Commit';
 try{assertReportTarget(r,project,task);}catch{conflicts.push('项目、任务、仓库绑定或允许范围已变化。');}
 if(task.github?.commitSha&&!r.commitSha.startsWith(task.github.commitSha.toLowerCase()))conflicts.push('Codex声明的Commit与任务当前关联Commit不一致。');
 const s=task.deliveryCheck;
 if(deliveryFresh(task,now)&&s){const targets=s.targets,matching=targets.find(t=>t.sha===r.commitSha);if(!matching)conflicts.push('Codex声明的Commit与GitHub最新核实的Commit/PR head不一致。');else{remote='GitHub已核实同一Commit';if(matching.filesComplete){const remoteFiles=matching.files.map(f=>f.path).sort();if(JSON.stringify(remoteFiles)!==JSON.stringify([...r.files].sort()))conflicts.push('报告文件清单与GitHub完整文件清单不一致。');}else blockers.push('GitHub文件清单不完整，无法核对全部文件。');if(ciState(matching.ci)!=='已读取的 CI 全部通过')blockers.push('GitHub CI：'+ciState(matching.ci)+'；不等同本地测试结论。');}}
 else blockers.push('缺少最新GitHub开发成果快照，请主动检查开发成果；导入不会联网。');
 if(!project.workspace?.scope?.length)blockers.push('未绑定允许修改范围，无法判断文件是否全部在范围内。');
 if(!entry.localCheck||entry.localCheck.historical)blockers.push('本地记录尚未核对或仅为恢复的历史核对。');
 if(!r.tests.length)blockers.push('报告没有已执行的测试。');if(r.tests.some(t=>t.status==='failed'))blockers.push('存在Codex报告失败的测试。');if(r.notRun.length)blockers.push('仍有未测试项目。');
 if(r.risks.length)blockers.push('报告列有遗留问题或风险，请人工审核。');
 blockers.push('Codex及本地记录一致性不能替代独立核验与人工验收。');
 return {remote,conflicts,blockers};
}
export function localEvidenceSummary(project:Project,task:Task,entry:EvidenceEntry,now=Date.now()){
 const r=entry.report,review=evidenceReview(project,task,entry,now);return [deliverySummary(task,project.workspace,now),'\n本地交付证据（与上方GitHub/CI分开）',`项目ID：${r.projectId}；任务ID：${r.taskId}；报告v${entry.version} ${r.reportId}`,`Codex声明Commit：${r.commitSha}；${review.remote}`,`来源：${entry.sourceName}；导入：${new Date(entry.importedAt).toISOString()}；生成：${r.generatedAt}`,`原始导入文件SHA256：${entry.fileDigest}（导入时，不是执行签名）`,r.summary,...r.tests.map(t=>`${t.command}\n${t.status==='failed'?'失败':entry.localCheck&&!entry.localCheck.historical?'本地证据已核对（文件一致性）':'Codex报告成功，尚未独立核验'}；exit=${t.exitCode??'未知'}；${t.startedAt}～${t.finishedAt}；${t.durationMs}ms\n日志摘录：${t.logExcerpt}\n日志SHA256：${t.logSha256}`),...r.notRun.map(t=>`未测试：${t.command}；原因：${t.reason}`),...r.risks.map(s=>'遗留问题：'+s),...review.conflicts.map(s=>'冲突：'+s),...review.blockers.map(s=>'验收阻塞/限制：'+s),'本摘要仅复制，不执行命令，不自动修改人工验收及看板状态。'].join('\n');
}
