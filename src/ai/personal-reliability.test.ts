import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import Ajv from 'ajv';
import {AIEngine} from './engine';
import {chatTransport} from './transport';
import {DEFAULT_CONFIG} from './config';
import {diagnosticExport} from './diagnostics';
import {IdeaClipDB,createNote,setAIEnabled} from '../storage';
import {BUILTINS,outputSchema,skillSystem,skillSignature,validateSkillReport} from '../skills/model';
import {bindingValid,getSkill,listSkills} from '../skills/repository';
import {PERSONAL_ID,PERSONAL_SKILL as skill} from '../github/personal-skill';
import {mockCompletion} from '../../tests/ai-fixture';

const source='合成公开资料：这是一个小工具。\n许可和需求尚待核实。';
function report(){return {schemaVersion:2,sections:Object.fromEntries(skill.sections.map(s=>[s.key,[{kind:'hypothesis',text:'收入没有证据，先访谈用户再决定是否开发。',evidence:null}]]))} as {schemaVersion:number;sections:Record<string,{kind:string;text:string;evidence:string|null}[]>};}
let db:IdeaClipDB,noteId:string;const engines:AIEngine[]=[];
beforeEach(async()=>{
 db=new IdeaClipDB('personal-format-'+crypto.randomUUID());noteId=await createNote({title:'合成小工具',body:'人工审核',url:'https://example.invalid',tags:[]},db);await db.notes.update(noteId,{content:source});await setAIEnabled(true,db);await db.aiConfig.put({...DEFAULT_CONFIG,provider:'custom',endpoint:'http://127.0.0.1:45555/mock',model:'mock-personal',version:'mock-v1',maxOutput:4096,timeoutMs:1000,dailyBudgetUsd:1,inputUsdPerMillion:1,outputUsdPerMillion:1});
});
afterEach(async()=>{engines.splice(0).forEach(e=>e.close());vi.restoreAllMocks();await db.delete();});
function setup(value:unknown){const fetcher=vi.fn<typeof fetch>(async()=>Response.json(mockCompletion(value)));const e=new AIEngine(db,{transport:chatTransport(fetcher),permission:async()=>true,credential:async()=>({endpoint:'http://127.0.0.1:45555/mock',version:'mock-key',value:'synthetic-personal-credential',persistent:false}),lock:async f=>f()});engines.push(e);return {e,fetcher};}

it('个人模板完整十数组示例通过严格Schema；上限取小值，不把用户偏好写入system',()=>{
 const prompt=skillSystem(skill,256),value=JSON.parse(prompt.split('个人Codex十栏JSON结构示例：')[1].split('\n')[0]);
 expect(new Ajv().compile(outputSchema(skill))(value)).toBe(true);expect(()=>validateSkillReport(value,skill,source)).not.toThrow();expect(Object.keys(value.sections)).toEqual(skill.sections.map(s=>s.key));expect(Object.values(value.sections).every(Array.isArray)).toBe(true);expect(prompt).toContain('最大输出256 Token');expect(skillSystem(skill,99999)).toContain('最大输出8192 Token');expect(prompt).toContain('即使只有一条也要用[');expect(prompt).toContain('不能直接放单个对象');expect(prompt).toContain('许可证未知时不得默认允许');expect(prompt).toContain('收入、利润、用户数和转化率无可信披露时明确没有证据');
 expect(skillSystem({...skill,prompt:'PRIVATE_TEMPLATE_SENTINEL'})).not.toContain('PRIVATE_TEMPLATE_SENTINEL');expect(skillSystem({...skill,id:'custom-personal',builtin:false})).not.toContain('个人Codex十栏JSON结构示例');
});
it('复现首栏object：精确类型诊断、保留预留及旧报告，不包装或重发',async()=>{
 const value=report(),bad={...value,sections:{...value.sections,problem:{kind:'hypothesis',text:'PRIVATE_RESPONSE_SENTINEL',evidence:null}}};const before=structuredClone(bad);
 const old={id:'old-report',noteId,createdAt:1,content:'旧付费报告',template:{...skill,version:'1.0.0'},skillReport:report() as any};await db.analyses.add(old);await db.aiUsage.add({id:'old-cost',noteId,day:'2026-11-11',createdAt:1,model:'old',status:'succeeded',reservedMicros:123,estimatedInput:1,maxOutput:1});
 const {e,fetcher}=setup(bad),p=await e.preview(noteId,[],PERSONAL_ID);expect(fetcher).not.toHaveBeenCalled();await expect(e.run(p.id)).rejects.toMatchObject({code:'ai_report_items'});
 const d=(await db.aiDiagnostics.toArray())[0];expect(d).toMatchObject({stage:'schema',code:'ai_report_items',templateVersion:'1.0.1',finishReason:'stop',inputTokens:321,outputTokens:654,detail:{field:'sections.column-1',rule:'type',expected:'array，1～8条',actual:'object',sectionIndex:0},checks:{responseReceived:true,modelOutputComplete:true,jsonParsed:true,schemaValid:false,evidenceValid:null,reportSaved:false}});expect(diagnosticExport(d)).not.toContain('PRIVATE_RESPONSE_SENTINEL');expect((await db.aiUsage.get(p.id))?.reservedMicros).toBe(p.costMicros);expect(await db.aiUsage.get('old-cost')).toMatchObject({reservedMicros:123,status:'succeeded'});expect(await db.analyses.toArray()).toEqual([old]);expect(bad).toEqual(before);
 db.close();await db.open();expect(await db.aiDiagnostics.count()).toBe(1);expect(await db.analyses.get(old.id)).toEqual(old);await expect(e.run(p.id)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
});
it('十栏数组与逐字fact经一次确认保存；预览计入新指导、不增输出预算或配置',async()=>{
 const value=report();value.sections.problem[0]={kind:'fact',text:'作者称这是小工具，未独立核验。',evidence:source};const {e,fetcher}=setup(value),config=await db.aiConfig.toArray(),p=await e.preview(noteId,[],PERSONAL_ID);expect(p.template.version).toBe('1.0.1');expect(p.config.maxOutput).toBe(4096);expect(p.systemPrompt).toContain('最大输出4096 Token');expect(p.inputTokensUpper).toBe(new TextEncoder().encode(p.systemPrompt+p.requestText).length+4096);expect(fetcher).not.toHaveBeenCalled();expect(await db.aiUsage.count()).toBe(0);
 const result=await e.run(p.id);expect(result.saved).toBe(true);expect(JSON.parse(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).messages[1].content).untrustedSource.content).toBe(source);expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).messages[0].content).toContain('个人Codex十栏JSON结构示例');db.close();await db.open();expect((await db.analyses.get(result.analysis.id))?.skillReport).toEqual(value);expect((await db.analyses.get(result.analysis.id))?.template?.version).toBe('1.0.1');expect(await db.aiConfig.toArray()).toEqual(config);expect(fetcher).toHaveBeenCalledTimes(1);
});
for(const [name,change] of [
 ['空栏目',(r:ReturnType<typeof report>)=>{r.sections.problem=[];}],
 ['超8条',(r:ReturnType<typeof report>)=>{r.sections.problem=Array(9).fill(r.sections.problem[0]);}],
 ['缺栏目',(r:ReturnType<typeof report>)=>{delete r.sections.verdict;}],
 ['额外包装',(r:ReturnType<typeof report>)=>{(r.sections as any).problem={items:r.sections.problem};}]
] as const)it('仍严格拒绝'+name+'，不补齐或改变响应',()=>{const value=report();change(value);const before=structuredClone(value);expect(()=>validateSkillReport(value,skill,source)).toThrow();expect(value).toEqual(before);});
for(const [evidence,code] of [[null,'ai_report_evidence_required'],['不是来源原文','ai_report_quote_mismatch']] as const)it('数组合法仍保留证据约束 '+code,async()=>{
 const value=report();value.sections.problem[0]={kind:'fact',text:'待核实',evidence};const {e,fetcher}=setup(value),p=await e.preview(noteId,[],PERSONAL_ID);await expect(e.run(p.id)).rejects.toMatchObject({code});expect(await db.analyses.count()).toBe(0);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('旧个人模板只读精确映射，启停保留、旧授权失效，旧报告Schema不变',async()=>{
 const old={...skill,version:'1.0.0',updatedAt:123};await db.aiTemplates.put(old);await db.skillPreferences.put({id:'general',defaultId:PERSONAL_ID,version:'legacy'});expect((await getSkill(PERSONAL_ID,db)).version).toBe('1.0.1');expect(await db.aiTemplates.get(PERSONAL_ID)).toEqual(old);expect(await bindingValid({skillId:PERSONAL_ID,skillVersion:'1.0.0',skillSignature:skillSignature(old),skillPreferenceVersion:'legacy'},db)).toBe(false);expect(outputSchema(old)).toEqual(outputSchema(skill));expect(()=>validateSkillReport(report(),old,source)).not.toThrow();
 await db.aiTemplates.update(PERSONAL_ID,{enabled:false});expect((await listSkills(db)).find(s=>s.id===PERSONAL_ID)?.enabled).toBe(false);await expect(getSkill(PERSONAL_ID,db)).rejects.toThrow('停用');await db.aiTemplates.put({...old,prompt:'altered'});await expect(getSkill(PERSONAL_ID,db)).rejects.toThrow('内置模板内容无效');await db.aiTemplates.put({...old,version:'0.9.0'});await expect(getSkill(PERSONAL_ID,db)).rejects.toThrow('内置模板内容无效');expect(BUILTINS).toHaveLength(7);
});
