import { db, type Note, type Analysis } from '../storage';
import { writeNoteIndex } from '../library/projections';
import { PERSONAL_SKILL } from './personal-skill';
import { personalReport, costText, type Costs } from './personal';
import { skillMarkdown, validateSkillReport } from '../skills/model';
import { sourceAppendix } from './public';
export async function savePersonalSnapshot(sourceId:string,costs:Costs,database=db){
 const now=Date.now(),id=crypto.randomUUID();
 return database.transaction('rw',[database.notes,database.analyses,database.noteCatalog,database.noteSearch,database.libraryState],async()=>{
  const source=await database.notes.get(sourceId);if(!source?.tags.includes('github-analysis'))throw Error('请选择已保存的GitHub公开资料快照。');
  const report=personalReport(source.content,source.title,costs);validateSkillReport(report,PERSONAL_SKILL,source.content);
  const note:Note={...source,id,body:source.body.split('\n\n本次用户手动成本')[0]+'\n\n本次用户手动成本（以下仅人工披露）：\n'+costText(costs),createdAt:now,updatedAt:now,revision:1};
  // Costs are included in the confirmed AI input, but never alter previous notes or reports.
  await database.notes.add(note);await writeNoteIndex(note,database);
  const analysis:Analysis={id:crypto.randomUUID(),noteId:id,createdAt:now,template:PERSONAL_SKILL,skillReport:report,model:'免费本地规则整理（无AI调用）',sourceUrl:source.url,content:skillMarkdown(report,PERSONAL_SKILL,'免费本地规则整理（无AI调用）',now)+sourceAppendix(note.content+'\n'+note.body)};
  await database.analyses.add(analysis);return {noteId:id,reportId:analysis.id};
 });
}
