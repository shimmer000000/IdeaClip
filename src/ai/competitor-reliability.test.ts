import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import Ajv from 'ajv';
import {AIEngine} from './engine';
import {chatTransport} from './transport';
import {DEFAULT_CONFIG} from './config';
import {diagnosticExport} from './diagnostics';
import {IdeaClipDB,createNote,setAIEnabled} from '../storage';
import {BUILTINS,COMPETITOR_ID,outputSchema,skillSystem,skillSignature,validateSkillReport} from '../skills/model';
import {bindingValid,getSkill,listSkills} from '../skills/repository';
import {mockCompletion} from '../../tests/ai-fixture';
const skill=()=>BUILTINS.find(s=>s.id===COMPETITOR_ID)!;
const source='合成来源：产品介绍。\n精确 Unicode cafe\u0301';
function report(){return {schemaVersion:2,sections:Object.fromEntries(skill().sections.map(s=>[s.key,[{kind:'hypothesis',text:'待调查用户是否愿意付费。',evidence:null}]]))} as {schemaVersion:number;sections:Record<string,{kind:string;text:string;evidence:string|null}[]>};}
let db:IdeaClipDB,noteId:string;const engines:AIEngine[]=[];
beforeEach(async()=>{db=new IdeaClipDB('competitor-'+crypto.randomUUID());noteId=await createNote({title:'合成竞争方案',body:'待验证',url:'https://example.invalid',tags:[]},db);await db.notes.update(noteId,{content:source});await setAIEnabled(true,db);await db.aiConfig.put({...DEFAULT_CONFIG,provider:'custom',endpoint:'http://127.0.0.1:45555/mock',model:'mock-competitor',version:'mock-v1',maxOutput:4096,timeoutMs:1000,dailyBudgetUsd:1,inputUsdPerMillion:1,outputUsdPerMillion:1});});
afterEach(async()=>{engines.splice(0).forEach(e=>e.close());vi.restoreAllMocks();await db.delete();});
function setup(value:unknown){const fetcher=vi.fn<typeof fetch>(async()=>Response.json(mockCompletion(value)));const e=new AIEngine(db,{transport:chatTransport(fetcher),permission:async()=>true,credential:async()=>({endpoint:'http://127.0.0.1:45555/mock',version:'mock-key',value:'synthetic-competitor-credential',persistent:false}),lock:async f=>f()});engines.push(e);return {e,fetcher};}
it('竞争模板示例通过严格Schema与证据验证，预算取小值',()=>{
 const prompt=skillSystem(skill(),256),value=JSON.parse(prompt.split('竞争分析JSON结构示例：')[1].split('\n')[0]);
 expect(new Ajv().compile(outputSchema(skill()))(value)).toBe(true);expect(()=>validateSkillReport(value,skill(),source)).not.toThrow();expect(Object.keys(value.sections)).toEqual(skill().sections.map(s=>s.key));expect(prompt).toContain('最大输出256 Token');expect(prompt).toContain('fact配evidence:null或空白必定被拒绝');expect(prompt).toContain('researchGaps');
});
for(const evidence of [null,'   '])it('复现第6栏fact缺证据：诊断、预算和usage保留，不重试 '+String(evidence),async()=>{
 const value=report();value.sections.researchGaps[0]={kind:'fact',text:'未知问题不能冒充事实。',evidence};const {e,fetcher}=setup(value),p=await e.preview(noteId,[],COMPETITOR_ID);await expect(e.run(p.id)).rejects.toMatchObject({code:'ai_report_evidence_required'});
 const d=(await db.aiDiagnostics.toArray())[0];expect(d).toMatchObject({stage:'evidence',finishReason:'stop',inputTokens:321,outputTokens:654,detail:{field:'sections.column-6.item-1.evidence',rule:'nonempty',sectionIndex:5,itemIndex:0},checks:{schemaValid:true,evidenceValid:false,reportSaved:false}});expect(diagnosticExport(d)).not.toContain(source);expect(await db.analyses.count()).toBe(0);expect((await db.aiUsage.get(p.id))?.reservedMicros).toBe(p.costMicros);db.close();await db.open();expect(await db.aiDiagnostics.count()).toBe(1);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('六栏简洁假设与精确原文fact正常保存、重开',async()=>{
 const value=report();value.sections.knownOffering[0]={kind:'fact',text:'作者陈述产品介绍，未核验。',evidence:source};const {e,fetcher}=setup(value),p=await e.preview(noteId,[],COMPETITOR_ID);expect(p.template.version).toBe('1.0.1');const result=await e.run(p.id);expect(result.saved).toBe(true);db.close();await db.open();expect((await db.analyses.get(result.analysis.id))?.skillReport).toEqual(value);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('拒绝归一化证据与空栏目，不自动改变kind',()=>{
 const value=report();value.sections.researchGaps[0]={kind:'fact',text:'来源陈述',evidence:source.normalize('NFC')};expect(()=>validateSkillReport(value,skill(),source)).toThrow();expect(value.sections.researchGaps[0].kind).toBe('fact');value.sections.researchGaps=[];expect(()=>validateSkillReport(value,skill(),source)).toThrow();
});
it('旧启停记录只读映射、旧授权失效、篡改拒绝',async()=>{
 const old={...skill(),version:'1.0.0',updatedAt:123};await db.aiTemplates.put(old);expect((await getSkill(COMPETITOR_ID,db)).version).toBe('1.0.1');expect(await db.aiTemplates.get(COMPETITOR_ID)).toEqual(old);expect(await bindingValid({skillId:COMPETITOR_ID,skillVersion:'1.0.0',skillSignature:skillSignature(old),skillPreferenceVersion:'initial'},db)).toBe(false);await db.aiTemplates.update(COMPETITOR_ID,{enabled:false});expect((await listSkills(db)).find(s=>s.id===COMPETITOR_ID)?.enabled).toBe(false);await expect(getSkill(COMPETITOR_ID,db)).rejects.toThrow('停用');await db.aiTemplates.put({...old,prompt:'altered'});await expect(getSkill(COMPETITOR_ID,db)).rejects.toThrow('内置模板内容无效');
});
