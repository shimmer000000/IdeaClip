import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import Dexie from 'dexie';
import {AIEngine} from './engine';
import {chatTransport} from './transport';
import {DEFAULT_CONFIG,PROVIDERS} from './config';
import {businessOutputPlan,businessOutputPrompt} from './business-output';
import {SECTIONS,validateReportSchema} from './report';
import {BUILTINS,BUSINESS_ID,skillSystem,skillSignature} from '../skills/model';
import {getSkill,listSkills,bindingValid} from '../skills/repository';
import {IdeaClipDB,createNote,setAIEnabled} from '../storage';
import {mockCompletion,mockReport} from '../../tests/ai-fixture';
let db:IdeaClipDB,id:string;const engines:AIEngine[]=[];
beforeEach(async()=>{db=new IdeaClipDB('reliability-'+crypto.randomUUID());id=await createNote({title:'合成分析',body:'待验证',tags:[],url:'https://example.invalid'},db);await db.notes.update(id,{content:'第一行\n第二行“引号” cafe\u0301'});await setAIEnabled(true,db);await db.aiConfig.put({...DEFAULT_CONFIG,version:'config-1',provider:'deepseek',endpoint:PROVIDERS.deepseek,model:'deepseek-flash',outputParameter:'max_tokens',timeoutMs:1000,maxOutput:8192,dailyBudgetUsd:1,inputUsdPerMillion:1,outputUsdPerMillion:1});});
afterEach(async()=>{engines.splice(0).forEach(e=>e.close());vi.restoreAllMocks();await db.delete();});
function engine(report:unknown=mockReport()){
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json(mockCompletion(report)));
 const e=new AIEngine(db,{transport:chatTransport(fetcher),permission:async()=>true,credential:async()=>({endpoint:PROVIDERS.deepseek,version:'key-1',value:'synthetic-reliability-credential',persistent:false}),lock:async f=>f()});engines.push(e);return {e,fetcher};
}
it('15栏结构示例本身通过真实Schema，提示要求完整而简洁，示例不含事实或任意来源',()=>{
 const prompt=businessOutputPrompt(4096),raw=prompt.split('JSON结构示例：')[1].split('\n')[0],example=JSON.parse(raw);expect(()=>validateReportSchema(example)).not.toThrow();expect(Object.keys(example.sections)).toEqual(Object.keys(SECTIONS));expect(Object.values(example.sections).every((v:any)=>v.length===1&&v[0].kind==='hypothesis'&&v[0].evidence===null)).toBe(true);expect(prompt).toContain('不能引用模板说明或结构示例');expect(prompt).toContain('先写1条');expect(prompt).toContain('保留大小写、空格、换行、标点及Unicode');
});
it('输出建议按实际预算收紧，不增加配置上限或改变严格Schema',()=>{
 expect(businessOutputPlan(8192)).toMatchObject({configured:8192,effective:4096,low:false});expect(businessOutputPlan(256)).toMatchObject({effective:256,low:true});expect(businessOutputPrompt(256)).toContain('20～60');expect(businessOutputPrompt(4096)).toContain('40～100');const s=skillSystem(BUILTINS[0],256);expect(s).toContain('最大输出256 Token');expect(s).toContain('"minItems":1,"maxItems":8');
});
it('配置8192与模板4096差别明确；请求仍为官方JSON模式、非思考、一次发送',async()=>{
 const {e,fetcher}=engine(),p=await e.preview(id,[]);expect(p.configuredMaxOutput).toBe(8192);expect(p.config.maxOutput).toBe(4096);expect(p.template.version).toBe('1.0.1');expect(p.systemPrompt).toContain('最大输出4096 Token');const r=await e.run(p.id);expect(r.saved).toBe(true);const body=JSON.parse(fetcher.mock.calls[0][1]!.body as string);expect(body).toMatchObject({response_format:{type:'json_object'},stream:false,thinking:{type:'disabled'},max_tokens:4096});expect(body).not.toHaveProperty('max_completion_tokens');expect(body).not.toHaveProperty('tools');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('简洁15栏与精确Unicode/换行证据成功保存及重开',async()=>{
 const r=mockReport();for(const k of Object.keys(SECTIONS))r.sections[k as keyof typeof SECTIONS]=[{kind:'hypothesis',text:'先用小规模访谈验证本栏假设。',evidence:null}];r.sections.summary=[{kind:'fact',text:'来源只是一项作者主张，未独立核验。',evidence:'第一行\n第二行“引号” cafe\u0301'}];const {e,fetcher}=engine(r);const result=await e.run((await e.preview(id,[])).id);expect(result.saved).toBe(true);db.close();await db.open();expect((await db.analyses.get(result.analysis.id))?.report).toEqual(r);expect((await db.aiUsage.get(result.analysis.id))?.inputTokens).toBe(321);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('完整响应后本地usage写入延迟超过请求超时仍能保存，不误标网络超时',async()=>{
 const {e,fetcher}=engine();const update=db.aiUsage.update.bind(db.aiUsage);vi.spyOn(db.aiUsage,'update').mockImplementationOnce((...args:Parameters<typeof update>)=>new Dexie.Promise<number>((resolve,reject)=>{setTimeout(()=>{void update(...args).then(resolve,reject);},1100);}));const result=await e.run((await e.preview(id,[])).id);expect(result.saved).toBe(true);expect(await db.aiDiagnostics.count()).toBe(0);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('仅本地保存重试成功清除保存错误状态，不改费用和实际usage',async()=>{
 const {e,fetcher}=engine();const broken=vi.spyOn(e,'save').mockRejectedValueOnce(new Error('Synthetic write failure'));const result=await e.run((await e.preview(id,[])).id);const before=(await db.aiUsage.get(result.analysis.id))!;expect(before.errorCode).toBe('ai_report_save');broken.mockRestore();await e.save(result.analysis);const after=(await db.aiUsage.get(result.analysis.id))!;expect(after.errorCode).toBeUndefined();expect(after.errorStage).toBeUndefined();expect(after.reportSaved).toBe(true);expect([after.reservedMicros,after.inputTokens,after.outputTokens]).toEqual([before.reservedMicros,before.inputTokens,before.outputTokens]);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('旧内置模板启停记录兼容，旧自动发送授权失效，旧历史不重写',async()=>{
 const legacy={...BUILTINS[0],version:'1.0.0',updatedAt:123};await db.aiTemplates.put(legacy);const binding={skillId:BUSINESS_ID,skillVersion:'1.0.0',skillSignature:skillSignature(legacy),skillPreferenceVersion:'initial'};expect((await getSkill(BUSINESS_ID,db)).version).toBe('1.0.1');expect(await db.aiTemplates.get(BUSINESS_ID)).toEqual(legacy);expect(await bindingValid(binding,db)).toBe(false);await db.aiTemplates.update(BUSINESS_ID,{enabled:false});expect((await listSkills(db)).find(s=>s.id===BUSINESS_ID)).toMatchObject({enabled:false,version:'1.0.1'});await expect(getSkill(BUSINESS_ID,db)).rejects.toThrow('停用');
});
it('不把篡改的旧模板当作可信内置升级',async()=>{await db.aiTemplates.put({...BUILTINS[0],version:'1.0.0',prompt:'Synthetic altered template'});await expect(getSkill(BUSINESS_ID,db)).rejects.toThrow('内置模板内容无效');});
for(const[code,finish,content]of [['response_truncated','length','{"schemaVersion":1'],['ai_report_json','stop','{"schemaVersion":1'],['response_empty','stop','   ']]as const)it(code+'保留实际结束原因和用量，不修补JSON或自动重发',async()=>{const {e,fetcher}=engine();fetcher.mockImplementationOnce(async()=>Response.json({choices:[{finish_reason:finish,message:{content}}],usage:{prompt_tokens:11,completion_tokens:256}}));const p=await e.preview(id,[]);await expect(e.run(p.id)).rejects.toMatchObject({code});expect((await db.aiDiagnostics.toArray())[0]).toMatchObject({code,finishReason:finish,inputTokens:11,outputTokens:256,checks:{reportSaved:false}});expect((await db.aiUsage.get(p.id))?.reservedMicros).toBe(p.costMicros);expect(await db.analyses.count()).toBe(0);expect(fetcher).toHaveBeenCalledTimes(1);});
