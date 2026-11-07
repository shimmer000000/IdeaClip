import { db, type IdeaClipDB } from '../storage';
import { currentDraft, emptyDraft, generateOutline, refKey, validateDraft, validatePlan, type ResearchDraft, type ResearchRef, type RefKind } from './model';
export async function resolveRef(kind:RefKind,id:string,database=db):Promise<ResearchRef> {
  if(!['note','project','analysis','comparison'].includes(kind)||!id||id.length>500)throw new Error('关联类型或记录 ID 无效。');
  const row=kind==='note'?await database.notes.get(id):kind==='project'?await database.projects.get(id):kind==='analysis'?await database.analyses.get(id):await database.comparisonReports.get(id);
  if(!row||kind==='note'&&'saveState' in row&&row.saveState!=='saved')throw new Error('来源不存在或不是已保存灵感。');
  return {kind,id,title:'title' in row?row.title:kind==='analysis'?('template' in row?row.template?.name:null)||'AI 分析报告':'商业机会对比报告',updatedAt:'updatedAt' in row?row.updatedAt:row.createdAt};
}
export async function refStates(refs:ResearchRef[],database=db) {
  return Promise.all(refs.map(async r=>{try{const now=await resolveRef(r.kind,r.id,database);return {key:refKey(r),state:now.updatedAt===r.updatedAt&&now.title===r.title?'unchanged':'changed'};}catch{return {key:refKey(r),state:'missing'};}}));
}
export async function newDraft(kind?:RefKind,id='',database=db) {
  const d=emptyDraft();if(kind){const ref=await resolveRef(kind,id,database);d.title=ref.title.slice(0,190)+' · 研究';d.refs=[ref];}d.sections=generateOutline(d.title);return d;
}
export async function saveResearch(id:string,draft:ResearchDraft,expected:number,database:IdeaClipDB=db) {
  const data=validateDraft(draft);
  return database.transaction('rw',database.researchPlans,async()=>{
    const old=await database.researchPlans.get(id);
    if(old?old.revision!==expected:expected!==0)throw new Error('研究已被其他页面修改或删除，未覆盖；当前输入保留，请重新读取。');
    if(old&&JSON.stringify(currentDraft(old))===JSON.stringify(data))return old;
    const now=Math.max(Date.now(),old?.updatedAt??0);
    const plan=validatePlan({id,schemaVersion:1,title:data.title,revision:expected+1,createdAt:old?.createdAt??now,updatedAt:now,versions:[...(old?.versions??[]),{revision:expected+1,at:now,data}]});
    await database.researchPlans.put(plan);return plan;
  });
}
export async function deleteResearch(id:string,expected:number,database=db) {
  await database.transaction('rw',database.researchPlans,async()=>{const old=await database.researchPlans.get(id);if(!old||old.revision!==expected)throw new Error('研究已改变或删除，请重新读取后再删除。');await database.researchPlans.delete(id);});
}
