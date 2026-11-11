import { db, type Analysis } from '../storage';
import { PERSONAL_ID, PERSONAL_SKILL } from './personal-skill';
import { createProject, full, validateProject } from '../incubation/repository';
import { validateSkillReport } from '../skills/model';
export interface MVPDraft {mvp:string;difficulties:string;acceptance:string}
export const reportBinding=(a:Analysis)=>JSON.stringify([a.id,a.noteId,a.content,a.skillReport,a.template]);
export function mvpDraft(a:Analysis):MVPDraft {
 if(a.template?.id!==PERSONAL_ID||!a.skillReport)throw Error('仅支持个人 + Codex模式的结构化报告。');
 validateSkillReport(a.skillReport,PERSONAL_SKILL);
 const text=(key:string)=>a.skillReport!.sections[key].map(c=>c.text).join('\n');
 return {mvp:text('mvp'),difficulties:text('feasibility')+'\n'+text('risks'),acceptance:'待人工审核并填写可检查的预期结果。参考MVP栏目：\n'+text('mvp')};
}
export async function createMVP(a:Analysis,draft:MVPDraft,reviewed:boolean,database=db){
 if(!reviewed)throw Error('请人工审核MVP功能、技术难点和验收标准后确认。');mvpDraft(a);
 for(const value of Object.values(draft))if(typeof value!=='string'||!value.trim()||value.length>10000)throw Error('开发方案字段不能为空或超过10000字符。');
 return database.transaction('rw',[database.projects,database.notes,database.analyses,database.comparisonReports],async()=>{
  const current=await database.analyses.get(a.id);if(!current||reportBinding(current)!==reportBinding(a))throw Error('来源报告已改变或删除，请重新打开并审核。');
  const old=(await database.projects.toArray()).find(p=>p.description?.startsWith('[个人CodexMVP]')&&p.refs?.some(r=>r.kind==='analysis'&&r.id===a.id));if(old)return old.id;
  const id=await createProject('analysis',a.id,database),p=full((await database.projects.get(id))!);
  const section=(key:string)=>a.skillReport!.sections[key].map(c=>c.text).join('\n').slice(0,10000);
  const next=validateProject({...p,title:'个人Codex MVP：'+(await database.notes.get(a.noteId))?.title?.slice(0,170),description:'[个人CodexMVP] 人工审核后的开发草案；未执行开发、未发布。\n技术难点与许可风险：\n'+draft.difficulties.slice(0,9800),mvp:draft.mvp,validationGoal:draft.acceptance,needs:section('problem'),businessModel:section('monetization'),costs:section('costs'),projectPurpose:'development',revision:1});
  await database.projects.put(next);return id;
 });
}
