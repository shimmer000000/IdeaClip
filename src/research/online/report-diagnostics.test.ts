import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { IdeaClipDB,setAIEnabled } from '../../storage';
import { AIEngine } from '../../ai/engine';
import { chatTransport } from '../../ai/transport';
import { DEFAULT_CONFIG,PROVIDERS } from '../../ai/config';
import * as validator from '../../ai/generated/research.js';
import { emptyDraft,currentDraft } from '../model';
import { beginWorkflow,saveInvestigation,reviewEvidence } from '../workflow/repository';
import { OPPORTUNITY_SECTIONS,sourceDigest,validateSource,validateResearchReport,type ResearchSource } from './model';
let database:IdeaClipDB,source:ResearchSource;const engines:AIEngine[]=[];
const key='synthetic-report-diagnostics-key';
beforeEach(async()=>{
 database=new IdeaClipDB('report-diagnostics-'+crypto.randomUUID());
 let w=await beginWorkflow('study',{...emptyDraft(),title:'仅合成资料的十二栏研究'},0,database);
 const raw={id:'source',studyId:'study',runId:'synthetic-run',question:'定价验证',type:'webpage',url:'https://example.com/pricing',title:'合成价格',content:'Sync\n$7 USD\nPer user, per month, billed annually.\n原文含中文 😀 与 café。',excerpt:'Sync\n$7 USD',publishedAt:null,collectedAt:1,status:'readable',reason:'合成测试，非真实价格'};
 source=validateSource({...raw,hash:await sourceDigest(raw as ResearchSource)});await database.researchSources.add(source);
 w=await saveInvestigation(w,currentDraft((await database.researchPlans.get('study'))!),database);await reviewEvidence(w,[source.id],true,database);
 await setAIEnabled(true,database);await database.aiConfig.put({...DEFAULT_CONFIG,provider:'deepseek',endpoint:PROVIDERS.deepseek,model:'mock-deepseek',outputParameter:'max_tokens',version:'c1',dailyBudgetUsd:1,inputUsdPerMillion:0.3,outputUsdPerMillion:1.2,maxOutput:8192});
});
afterEach(async()=>{engines.splice(0).forEach(e=>e.close());vi.restoreAllMocks();await database.delete();});
type Claim={kind:string;text:string;sourceId:string|null;quote:string|null};
type Report={schemaVersion:number;sections:Record<string,Claim[]>;[key:string]:unknown};
const report=():Report=>({schemaVersion:2,sections:Object.fromEntries(Object.keys(OPPORTUNITY_SECTIONS).map(k=>[k,[k==='evidence'?{kind:'original',text:source.content,sourceId:source.id,quote:source.content}:{kind:'hypothesis',text:'需访谈用户，不能推定市场需求。',sourceId:null,quote:null}]]))});
function setup(value:unknown=report(),fetcher?:typeof fetch){
 const fetchMock=vi.fn(fetcher??(async()=>Response.json({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:1234,completion_tokens:456}})));
 const engine=new AIEngine(database,{permission:async()=>true,credential:async()=>({endpoint:PROVIDERS.deepseek,value:key,version:'k1',persistent:false}),lock:async fn=>fn(),transport:chatTransport(fetchMock)});engines.push(engine);return {engine,fetchMock};
}
const cases:[string,(r:Report)=>void,string][]=[
 ['版本错误',r=>{r.schemaVersion=1;},'research_version'],
 ['缺失栏目',r=>{delete r.sections.mvp;},'research_fields'],
 ['多余顶层字段',r=>{r['private-model-field']='private-body';},'research_fields'],
 ['多余栏目',r=>{r.sections.extra=[];},'research_fields'],
 ['空栏目',r=>{r.sections.counter=[];},'research_items'],
 ['超过八条',r=>{r.sections.conclusion=Array.from({length:9},()=>r.sections.conclusion[0]);},'research_items'],
 ['条目多余字段',r=>{Object.assign(r.sections.evidence[0],{secret:'private-body'});},'research_fields'],
 ['缺少quote字段',r=>{delete (r.sections.evidence[0] as Partial<Claim>).quote;},'research_fields'],
 ['错误类型',r=>{r.sections.evidence[0].kind='fact';},'research_kind'],
 ['超长text',r=>{r.sections.conclusion[0].text='中'.repeat(3001);},'research_text'],
 ['控制字符',r=>{r.sections.conclusion[0].text='private\u0000body';},'research_text'],
 ['超长quote',r=>{r.sections.evidence[0].quote='x'.repeat(1001);},'research_text'],
 ['伪造sourceId',r=>{r.sections.evidence[0].sourceId='invented-private-id';},'research_source'],
 ['缺失逐字quote',r=>{r.sections.evidence[0].quote=null;},'research_quote_required'],
 ['合并换行',r=>{r.sections.evidence[0].quote=source.content.replaceAll('\n',' ');},'research_quote_mismatch'],
 ['Unicode规范化不逐字',r=>{r.sections.evidence[0].quote=source.content.normalize('NFD');},'research_quote_mismatch'],
 ['拼接来源摘录',r=>{r.sections.evidence[0].quote='Sync Per user';},'research_quote_mismatch'],
 ['original改写或翻译',r=>{r.sections.evidence[0].text='作者说每月收费。';},'research_original_mismatch'],
 ['未采集URL',r=>{r.sections.conclusion[0].text='https://uncollected.example/';},'research_url'],
];
it.each(cases)('%s：固定安全码、保留usage和预留、不写报告且不自动重试',async(_label,mutate,code)=>{
 const value=report();mutate(value);const {engine,fetchMock}=setup(value);const p=await engine.previewResearch('study',[source.id],'study');
 await expect(engine.run(p.id)).rejects.toMatchObject({code});const usage=(await database.aiUsage.toArray())[0];expect(usage).toMatchObject({status:'failed',errorCode:code,reservedMicros:p.costMicros,inputTokens:1234,outputTokens:456,responseReceived:true});expect(usage.errorStage).toMatch(/schema|evidence/);expect(await database.researchReports.count()).toBe(0);expect(await database.researchSources.get(source.id)).toEqual(source);
 expect(JSON.stringify(usage)).not.toContain('private-body');expect(JSON.stringify(usage)).not.toContain(source.content);expect(JSON.stringify(usage)).not.toContain(key);expect(fetchMock).toHaveBeenCalledTimes(1);
 await expect(engine.run(p.id)).rejects.toMatchObject({code:'consent'});expect(fetchMock).toHaveBeenCalledTimes(1);expect((await database.aiUsage.toArray())[0].reservedMicros).toBe(p.costMicros);
});
it('有效中文/emoji/原语言逐字证据通过十二栏Schema并保存，重复保存不重计费',async()=>{
 const {engine,fetchMock}=setup();const p=await engine.previewResearch('study',[source.id],'study');expect(p.systemPrompt).toContain('original的text必须与quote完全相等');expect(p.systemPrompt).toContain('sourceId和quote均为null');
 const result=await engine.run(p.id);expect(result.saved).toBe(true);expect((await database.researchReports.get(p.id))?.report.schemaVersion).toBe(2);expect((await database.researchReports.get(p.id))?.report.sections.evidence[0].quote).toBe(source.content);expect((await database.aiUsage.get(p.id))).toMatchObject({status:'succeeded',inputTokens:1234,outputTokens:456,reportSaved:true});await engine.save(result.analysis);expect(await database.researchReports.count()).toBe(1);expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('中文作者主张可配原语言quote，但不能把中文翻译冒充original',()=>{const r=report();r.sections.evidence[0]={kind:'claim',text:'作者声明按年计费，尚未核实需求。',sourceId:source.id,quote:'Per user, per month, billed annually.'};expect(validateResearchReport(r,[source],2).schemaVersion).toBe(2);});
it('模型内层JSON无效与外层响应JSON无效分别记录，不泄露原始正文',async()=>{
 for(const outer of [false,true]){const {engine,fetchMock}=setup('private-invalid-json',outer?async()=>new Response('private-provider-body'):undefined);const p=await engine.previewResearch('study',[source.id],'study');await expect(engine.run(p.id)).rejects.toMatchObject({code:outer?'response_json':'research_json'});const row=await database.aiUsage.get(p.id);expect(row?.errorStage).toBe(outer?'transport':'json');if(!outer)expect(row?.inputTokens).toBe(1234);expect(JSON.stringify(row)).not.toContain('private-');expect(fetchMock).toHaveBeenCalledTimes(1);}
});
it('校验器运行时异常使用独立安全码且保留usage',async()=>{vi.spyOn(validator,'default').mockImplementationOnce(()=>{throw new Error('private-validator-body');});const {engine}=setup();const p=await engine.previewResearch('study',[source.id],'study');await expect(engine.run(p.id)).rejects.toMatchObject({code:'research_validator'});expect(await database.aiUsage.get(p.id)).toMatchObject({errorStage:'validator',inputTokens:1234,reservedMicros:p.costMicros});});
it('本地保存失败返回有效待保存结果；只重试保存，不再请求AI或重复写报告',async()=>{
 const {engine,fetchMock}=setup();const p=await engine.previewResearch('study',[source.id],'study');vi.spyOn(database.researchReports,'add').mockRejectedValueOnce(new DOMException('private-storage-body','QuotaExceededError'));
 const result=await engine.run(p.id);expect(result.saved).toBe(false);expect(result.analysis.research?.report.schemaVersion).toBe(2);expect(await database.researchReports.count()).toBe(0);expect(await database.aiUsage.get(p.id)).toMatchObject({status:'succeeded',reportSaved:false,errorCode:'research_save',errorStage:'storage',inputTokens:1234,reservedMicros:p.costMicros});
 await engine.save(result.analysis);expect(await database.researchReports.count()).toBe(1);expect(await database.aiUsage.get(p.id)).toMatchObject({reportSaved:true});expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('usage提前写入失败不丢失有效报告或费用预留',async()=>{const {engine}=setup();const p=await engine.previewResearch('study',[source.id],'study');vi.spyOn(database.aiUsage,'update').mockRejectedValueOnce(new DOMException('full','QuotaExceededError'));expect((await engine.run(p.id)).saved).toBe(true);expect(await database.researchReports.count()).toBe(1);expect(await database.aiUsage.get(p.id)).toMatchObject({inputTokens:1234,reservedMicros:p.costMicros});});
it('关闭AI、预算不足、来源变更仍在请求前阻止，旧费用记录不变',async()=>{
 const {engine,fetchMock}=setup();await database.aiUsage.put({id:'old',noteId:'study',day:new Date().toISOString().slice(0,10),createdAt:1,model:'mock',status:'failed',reservedMicros:15054,estimatedInput:1,maxOutput:8192,errorCode:'validation'});const old=await database.aiUsage.get('old');
 await setAIEnabled(false,database);await expect(engine.previewResearch('study',[source.id],'study')).rejects.toMatchObject({code:'disabled'});await setAIEnabled(true,database);
 await database.aiConfig.update('manual',{dailyBudgetUsd:0.000001});const p=await engine.previewResearch('study',[source.id],'study');await expect(engine.run(p.id)).rejects.toMatchObject({code:'budget'});await database.aiConfig.update('manual',{dailyBudgetUsd:1});const fresh=await engine.previewResearch('study',[source.id],'study');await database.researchSources.update(source.id,{content:'changed'});await expect(engine.run(fresh.id)).rejects.toThrow();expect(fetchMock).not.toHaveBeenCalled();expect(await database.aiUsage.get('old')).toEqual(old);
});
it.each(['utf8','truncated','stream'] as const)('传输%s失败与报告校验分开，不重试',async mode=>{
 const fetcher:typeof fetch=async()=>mode==='utf8'?new Response(new Uint8Array([0xff])):mode==='stream'?new Response(new ReadableStream({start(c){c.error(new Error('private-stream-error'));}})):Response.json({choices:[{finish_reason:'length',message:{content:'private-partial'}}],usage:{prompt_tokens:1234,completion_tokens:8192}});
 const {engine,fetchMock}=setup(undefined,fetcher);const p=await engine.previewResearch('study',[source.id],'study');await expect(engine.run(p.id)).rejects.toMatchObject({code:mode==='utf8'?'response_encoding':mode==='stream'?'response_read':'response_truncated'});const usage=await database.aiUsage.get(p.id);expect(usage?.errorStage).toBe('transport');if(mode==='truncated')expect(usage?.outputTokens).toBe(8192);expect(usage?.reservedMicros).toBe(p.costMicros);expect(fetchMock).toHaveBeenCalledTimes(1);
});
