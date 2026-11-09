import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import Ajv from 'ajv';
import {AIEngine} from './engine';
import {chatTransport} from './transport';
import {DEFAULT_CONFIG} from './config';
import {diagnosticExport} from './diagnostics';
import {IdeaClipDB,createNote,setAIEnabled} from '../storage';
import {BUILTINS,outputSchema,skillSystem,skillSignature,validateSkillReport} from '../skills/model';
import {bindingValid,getSkill,listSkills} from '../skills/repository';
import {mockCompletion} from '../../tests/ai-fixture';

const lean=()=>BUILTINS.find(s=>s.id==='builtin-lean')!;
const privateText='SYNTHETIC_PRIVATE_SOURCE_NOT_FOR_DIAGNOSTICS';
function reportFor(){return {schemaVersion:2,sections:Object.fromEntries(lean().sections.map(s=>[s.key,[{kind:'hypothesis',text:'先用少量访谈验证本栏信息缺口。',evidence:null}]]))} as {schemaVersion:number;sections:Record<string,Record<string,unknown>[]>};}
let db:IdeaClipDB,noteId:string;const engines:AIEngine[]=[];
beforeEach(async()=>{db=new IdeaClipDB('lean-reliability-'+crypto.randomUUID());noteId=await createNote({title:'合成低成本方案',body:'待核验',url:'https://example.invalid',tags:[]},db);await db.notes.update(noteId,{content:privateText});await setAIEnabled(true,db);await db.aiConfig.put({...DEFAULT_CONFIG,provider:'custom',endpoint:'http://127.0.0.1:45555/mock',model:'mock-lean',version:'mock-v1',maxOutput:4096,timeoutMs:1000,dailyBudgetUsd:1,inputUsdPerMillion:1,outputUsdPerMillion:1});});
afterEach(async()=>{engines.splice(0).forEach(e=>e.close());vi.restoreAllMocks();await db.delete();});
function setup(value:unknown){const fetcher=vi.fn<typeof fetch>(async()=>Response.json(mockCompletion(value)));const e=new AIEngine(db,{transport:chatTransport(fetcher),permission:async()=>true,credential:async()=>({endpoint:'http://127.0.0.1:45555/mock',version:'mock-key-v1',value:'synthetic-lean-credential',persistent:false}),lock:async f=>f()});engines.push(e);return {e,fetcher};}
function third(r:ReturnType<typeof reportFor>){const a=r.sections.constraints;a.push({...a[0]},{...a[0]});return a[2];}

for(const key of ['kind','text','evidence'])it('首栏第3条缺少'+key+'明确定位，预算/usage保留且不重试',async()=>{
 const r=reportFor();delete third(r)[key];const {e,fetcher}=setup(r),p=await e.preview(noteId,[],'builtin-lean');
 await expect(e.run(p.id)).rejects.toMatchObject({code:'ai_report_claim'});const d=(await db.aiDiagnostics.toArray())[0];
 expect(d).toMatchObject({stage:'schema',code:'ai_report_claim',finishReason:'stop',inputTokens:321,outputTokens:654,detail:{field:'sections.column-1.item-3.'+key,rule:'required',actual:'缺失',sectionIndex:0,itemIndex:2},checks:{responseReceived:true,jsonParsed:true,schemaValid:false,evidenceValid:null,reportSaved:false}});
 expect((await db.aiUsage.get(p.id))?.reservedMicros).toBe(p.costMicros);expect(await db.analyses.count()).toBe(0);expect(fetcher).toHaveBeenCalledTimes(1);
 db.close();await db.open();expect((await db.aiDiagnostics.get(d.id))?.detail?.rule).toBe('required');expect(JSON.stringify(diagnosticExport(d))).not.toContain(privateText);
});
it('首栏第3条多余字段拒绝，诊断不暴露任意字段名或正文',async()=>{
 const r=reportFor();third(r).SYNTHETIC_PRIVATE_FIELD=privateText;const {e,fetcher}=setup(r);await expect(e.run((await e.preview(noteId,[],'builtin-lean')).id)).rejects.toMatchObject({code:'ai_report_claim'});
 const d=(await db.aiDiagnostics.toArray())[0];expect(d.detail).toMatchObject({field:'sections.column-1.item-3.字段已隐藏',rule:'additionalProperties',actual:'object',sectionIndex:0,itemIndex:2});const exported=JSON.stringify(diagnosticExport(d));for(const text of ['SYNTHETIC_PRIVATE_FIELD',privateText,'synthetic-lean-credential'])expect(exported).not.toContain(text);expect(await db.analyses.count()).toBe(0);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('缺少字段并含额外字段时先报告固定缺失字段，不修补响应',()=>{const r=reportFor(),c=third(r);delete c.evidence;c.sourceId=privateText;try{validateSkillReport(r,lean());throw Error('应拒绝');}catch(error){expect(error).toMatchObject({detail:{field:'sections.column-1.item-3.evidence',rule:'required'}});}expect(c).not.toHaveProperty('evidence');expect(c.sourceId).toBe(privateText);});
for(const kind of [['fact'],['hypothesis'],{value:'fact'}])it('kind必须是字符串，不将'+JSON.stringify(kind)+'强转后接受',()=>{
 const r=reportFor();r.sections.constraints[0].kind=kind;expect(new Ajv({strict:true}).compile(outputSchema(lean()))(r)).toBe(false);
 expect(()=>validateSkillReport(r,lean())).toThrow();try{validateSkillReport(r,lean());}catch(error){expect(error).toMatchObject({code:'ai_report_claim',detail:{field:'sections.column-1.item-1.kind',rule:'type',expected:'string'}});}
});
it('低成本六栏JSON示例通过原Schema，提示显式保留evidence:null且不套用15栏',()=>{
 const p=skillSystem(lean(),1024),example=JSON.parse(p.split('低成本JSON结构示例：')[1].split('\n')[0]);expect(new Ajv({strict:true}).compile(outputSchema(lean()))(example)).toBe(true);expect(Object.keys(example.sections)).toEqual(lean().sections.map(s=>s.key));expect(p).toContain('最大输出1024 Token');expect(p).toContain('evidence也不能省略');expect(p).toContain('不要输出sourceId、quote、original');expect(p).not.toContain('单篇笔记的15栏');expect(p).toContain('不可照抄');
});
it('合法六栏包含三条和精确事实证据，成功保存、重开及保留usage',async()=>{
 const r=reportFor();third(r);r.sections.constraints[2]={kind:'fact',text:'这只是来源作者陈述，尚未独立核验。',evidence:privateText};const {e,fetcher}=setup(r),p=await e.preview(noteId,[],'builtin-lean'),result=await e.run(p.id);expect(result.saved).toBe(true);expect(p.template.version).toBe('1.0.1');db.close();await db.open();expect((await db.analyses.get(p.id))?.skillReport).toEqual(r);expect((await db.aiUsage.get(p.id))?.outputTokens).toBe(654);expect(await db.aiDiagnostics.count()).toBe(0);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('合法字段仍严格拒绝非逐字fact，不进入保存或自动重发',async()=>{const r=reportFor();r.sections.constraints[0]={kind:'fact',text:'合成来源主张',evidence:'改写过的内容'};const {e,fetcher}=setup(r);await expect(e.run((await e.preview(noteId,[],'builtin-lean')).id)).rejects.toMatchObject({code:'ai_report_quote_mismatch'});expect((await db.aiDiagnostics.toArray())[0]).toMatchObject({checks:{schemaValid:true,evidenceValid:false,reportSaved:false}});expect(await db.analyses.count()).toBe(0);expect(fetcher).toHaveBeenCalledTimes(1);});
it('旧低成本模板只读兼容、停用状态保留，旧自动授权失效',async()=>{const old={...lean(),version:'1.0.0',updatedAt:123};await db.aiTemplates.put(old);await db.skillPreferences.put({id:'general',defaultId:old.id,version:'initial'});expect((await getSkill(old.id,db)).version).toBe('1.0.1');expect(await db.aiTemplates.get(old.id)).toEqual(old);expect(await bindingValid({skillId:old.id,skillVersion:old.version,skillSignature:skillSignature(old),skillPreferenceVersion:'initial'},db)).toBe(false);await db.aiTemplates.update(old.id,{enabled:false});expect((await listSkills(db)).find(s=>s.id===old.id)).toMatchObject({version:'1.0.1',enabled:false});await expect(getSkill(old.id,db)).rejects.toThrow('停用');expect(()=>validateSkillReport(reportFor(),old)).not.toThrow();});
it('篡改的旧低成本定义不得升级成可信内置模板',async()=>{await db.aiTemplates.put({...lean(),version:'1.0.0',prompt:'合成篡改定义'});await expect(getSkill('builtin-lean',db)).rejects.toThrow('内置模板内容无效');});
