import { publicUrl } from '../model';
import { digest } from '../../backup/zip';
import type { Skill } from '../../skills/model';
export const TOPICS = { competitor:'竞争对手研究', business:'商业模式调查', pricing:'产品定价调查', github:'GitHub 项目调查', demand:'市场需求验证', custom:'自定义研究问题' };
export interface ResearchConfig { id:'online'; version:string; enabled:boolean; endpoint:string; hosts:string[]; timeoutMs:number; priceUsd:number; dailyBudgetUsd:number; maxSearches:number; maxPages:number; maxText:number }
export const DEFAULT_RESEARCH:ResearchConfig={id:'online',version:'',enabled:false,endpoint:'',hosts:[],timeoutMs:30000,priceUsd:0,dailyBudgetUsd:0.1,maxSearches:3,maxPages:5,maxText:20000};
export interface Operation { kind:'search'|'read'|'github'; value:string }
export interface ResearchRun { id:string; studyId:string; createdAt:number; updatedAt:number; question:string; topic:keyof typeof TOPICS; operations:Operation[]; next:number; state:'running'|'completed'|'failed'|'paused'|'cancelled'; reason:string; revision:number; imported?:boolean }
export interface ResearchUsage { id:string; runId:string; day:string; createdAt:number; reservedMicros:number; state:'sent'|'succeeded'|'failed'|'unknown' }
export interface ResearchSource { id:string; studyId:string; runId:string; question:string; type:'search'|'webpage'|'github'; url:string; title:string; content:string; excerpt:string; publishedAt:string|null; collectedAt:number; status:'snippet'|'readable'|'partial'|'unreadable'|'failed'; hash:string; reason:string }
export const REPORT_SECTIONS={questions:'研究问题',findings:'关键发现',support:'支持证据',counter:'反面证据',uncertainty:'不确定性',competition:'竞争产品比较',opportunity:'商业机会判断',validation:'建议验证步骤'};
export const RESEARCH_SKILL:Skill={id:'builtin-research',version:'1.0.0',name:'公开资料综合研究',description:'只引用选中采集来源',scenario:'手动研究',inputRequirements:'已保存研究与选中资料',prompt:'只综合已选择的公开来源，按逐字证据引用，不补造链接。',sections:Object.entries(REPORT_SECTIONS).map(([key,label])=>({key,label,instruction:'区分原文、作者主张、推断和假设'})),maxOutput:8192,display:'sections',enabled:true,builtin:true,updatedAt:0};
export interface ResearchClaim { kind:'original'|'claim'|'inference'|'hypothesis'; text:string; sourceId:string|null; quote:string|null }
export interface ResearchReport { schemaVersion:1; sections:Record<keyof typeof REPORT_SECTIONS,ResearchClaim[]> }
export interface ResearchResult { id:string; studyId:string; createdAt:number; model:string; planRevision:number; report:ResearchReport; sources:ResearchSource[]; content:string }
export const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('研究响应格式无效。');return v as Record<string,unknown>;};
export const txt=(v:unknown,max=30000)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))throw new Error('研究文本无效或超过上限。');return v;};
export const num=(v:unknown,max=Number.MAX_SAFE_INTEGER)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw new Error('研究数量或时间无效。');return v;};
export const uid=(v:unknown)=>{const s=txt(v,500);if(!s.trim())throw new Error('研究 ID 无效。');return s;};
export function list(v:unknown,max:number):unknown[]{if(!Array.isArray(v)||v.length>max)throw new Error('研究数量超过上限。');return v;}
export function researchUrl(value:unknown,hosts?:string[]) {
 const u=new URL(publicUrl(value));
 if(u.protocol!=='https:'||u.port&&u.port!=='443'||/[\s]/.test(u.hostname)||/\.(?:arpa|onion)$/.test(u.hostname)||/^\d+(?:\.\d+){3}$/.test(u.hostname)||u.hostname.endsWith('.')||/\/(?:login|signin|account|admin|private|mail|bank|payment|checkout)(?:[/?#]|$)/i.test(u.pathname)||[...u.searchParams.keys()].some(k=>/token|secret|password|api.?key|authorization|credential|signature/i.test(k)))throw new Error('只允许公开 HTTPS 网页，禁止 IP、敏感页面或凭据 URL。');
 if(hosts&&!hosts.includes(u.hostname))throw new Error('来源域名不在本次授权范围。');return u.href;
}
export function validateResearchConfig(v:ResearchConfig):ResearchConfig {
 const c={...v,hosts:[...new Set(v.hosts.map(h=>h.trim().toLowerCase()).filter(Boolean))]};
 if(c.id!=='online'||typeof c.enabled!=='boolean'||c.hosts.length<1||c.hosts.length>20)throw new Error('请填写1～20个明确的来源域名。');
 c.hosts.forEach(h=>{if(new URL(researchUrl('https://'+h+'/')).hostname!==h)throw new Error('来源请仅填精确域名，不含路径或通配符。');});
 const u=new URL(c.endpoint);if(u.protocol==='https:')researchUrl(u.href);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw new Error('代理只允许HTTPS或明确配置的本机HTTP完整端点。');
 for(const [n,min,max]of [[c.timeoutMs,1000,120000],[c.maxSearches,1,3],[c.maxPages,1,5],[c.maxText,100,30000]])if(!Number.isInteger(n)||n<min||n>max)throw new Error('研究请求限制无效。');
 if(!Number.isFinite(c.priceUsd)||c.priceUsd<0||c.priceUsd>100||!Number.isFinite(c.dailyBudgetUsd)||c.dailyBudgetUsd<=0||c.dailyBudgetUsd>10000)throw new Error('请核对每次请求价格和每日预算（USD）。');
 return {id:'online',version:txt(c.version,100),enabled:c.enabled,endpoint:u.href,hosts:c.hosts,timeoutMs:c.timeoutMs,priceUsd:c.priceUsd,dailyBudgetUsd:c.dailyBudgetUsd,maxSearches:c.maxSearches,maxPages:c.maxPages,maxText:c.maxText};
}
export function operations(queries:string[],urls:string[],c:ResearchConfig):Operation[]{
 const q=[...new Set(queries.map(q=>q.trim()).filter(Boolean))];const u=[...new Set(urls.map(u=>u.trim()).filter(Boolean).map(u=>researchUrl(u,c.hosts)))];
 if(q.length>c.maxSearches||u.length>c.maxPages||q.length+u.length===0)throw new Error('研究请求数超限或为空，请缩减范围。');
 return [...q.map(value=>({kind:'search' as const,value:txt(value,500)})),...u.map(value=>({kind:new URL(value).hostname==='github.com'&&/^\/[^/]+\/[^/]+\/?$/.test(new URL(value).pathname)?'github' as const:'read' as const,value}))];
}
export function validateSource(value:unknown):ResearchSource {
 const r=obj(value);if(!['search','webpage','github'].includes(String(r.type))||!['snippet','readable','partial','unreadable','failed'].includes(String(r.status))||!/^([a-f0-9]{64})$/.test(String(r.hash)))throw new Error('来源类型、状态或哈希无效。');
 const content=txt(r.content);const excerpt=txt(r.excerpt??content.slice(0,1000),1000);if(excerpt&&!content.includes(excerpt))throw new Error('证据摘录不在实际来源正文中。');
 const publishedAt=r.publishedAt===null?null:txt(r.publishedAt,100);if(publishedAt&&!Number.isFinite(Date.parse(publishedAt)))throw new Error('来源发布时间无效。');
 return {id:uid(r.id),studyId:uid(r.studyId),runId:uid(r.runId),question:txt(r.question,2000),type:r.type as ResearchSource['type'],url:researchUrl(r.url),title:txt(r.title,1000),content,excerpt,publishedAt,collectedAt:num(r.collectedAt,8640000000000000),status:r.status as ResearchSource['status'],hash:String(r.hash),reason:txt(r.reason,1000)};
}
export const sourceDigest=(s:Pick<ResearchSource,'url'|'content'|'title'|'publishedAt'|'status'>)=>digest(new Blob([JSON.stringify({url:s.url,title:s.title,content:s.content,publishedAt:s.publishedAt,status:s.status})]));
export function validateRun(value:unknown):ResearchRun {
 const r=obj(value);if(!Object.hasOwn(TOPICS,String(r.topic))||!['running','completed','failed','paused','cancelled'].includes(String(r.state)))throw new Error('研究任务状态无效。');
 const ops=list(r.operations,8).map(v=>{const o=obj(v);if(!['search','read','github'].includes(String(o.kind)))throw new Error('研究操作无效。');return {kind:o.kind as Operation['kind'],value:o.kind==='search'?txt(o.value,500):researchUrl(o.value)};});
 return {id:uid(r.id),studyId:uid(r.studyId),createdAt:num(r.createdAt),updatedAt:num(r.updatedAt),question:txt(r.question,2000),topic:r.topic as ResearchRun['topic'],operations:ops,next:num(r.next,ops.length),state:r.state as ResearchRun['state'],reason:txt(r.reason,1000),revision:num(r.revision),...(r.imported===true?{imported:true}:{})};
}
export function researchSchema(ids:string[]){const claim={type:'object',additionalProperties:false,required:['kind','text','sourceId','quote'],properties:{kind:{enum:['original','claim','inference','hypothesis']},text:{type:'string',minLength:1,maxLength:3000},sourceId:{enum:[null,...ids]},quote:{type:['string','null'],maxLength:1000}}};return {type:'object',additionalProperties:false,required:['schemaVersion','sections'],properties:{schemaVersion:{const:1},sections:{type:'object',additionalProperties:false,required:Object.keys(REPORT_SECTIONS),properties:Object.fromEntries(Object.keys(REPORT_SECTIONS).map(k=>[k,{type:'array',minItems:1,maxItems:8,items:claim}]))}}};}
export function validateResearchReport(value:unknown,sources:ResearchSource[]):ResearchReport {
 const r=obj(value),sections=obj(r.sections);if(r.schemaVersion!==1||Object.keys(r).length!==2||Object.keys(sections).length!==8||new Set(sources.map(s=>s.id)).size!==sources.length)throw new Error('研究报告 Schema 无效。');
 const urls=new Set(sources.map(s=>s.url));
 const out=Object.fromEntries(Object.keys(REPORT_SECTIONS).map(k=>[k,list(sections[k],8).map(v=>{
   const c=obj(v);if(Object.keys(c).length!==4||!['kind','text','sourceId','quote'].every(k=>Object.hasOwn(c,k))||!['original','claim','inference','hypothesis'].includes(String(c.kind)))throw new Error('研究结论结构无效。');
   const text=txt(c.text,3000);if(!text.trim())throw new Error('研究结论不能为空。');const sourceId=c.sourceId===null?null:uid(c.sourceId),quote=c.quote===null?null:txt(c.quote,1000);const source=sources.find(s=>s.id===sourceId);
   if(sourceId===null?quote!==null||c.kind==='original'||c.kind==='claim':!source||!['snippet','readable','partial'].includes(source.status)||!quote?.trim()||!source.content.includes(quote))throw new Error('AI 引用来源 ID 或逐字证据不存在。');
   if(c.kind==='original'&&text!==quote)throw new Error('来源原文必须与逐字摘录一致。');
   for(const url of text.match(/https?:\/\/[^\s<>"'，。；）]+/gi)??[])if(!urls.has(new URL(url).href))throw new Error('AI 生成了未采集的来源链接。');
   return {kind:c.kind as ResearchClaim['kind'],text,sourceId,quote};
 })]));
 if(Object.values(out).some(a=>!a.length))throw new Error('报告栏目不能为空。');return {schemaVersion:1,sections:out as ResearchReport['sections']};
}
const md=(s:string)=>s.replace(/[\\`*_{}\[\]<>()#!|~]/g,'\\$&');
export function researchReportMarkdown(report:ResearchReport,sources:ResearchSource[],model:string,at:number){validateResearchReport(report,sources);return ['# 公开资料研究报告',`${md(model)} · ${new Date(at).toISOString()}`,'资料并非独立事实核验；搜索摘要不代表全文，结论仍需验证。',...Object.entries(REPORT_SECTIONS).map(([k,label])=>`## ${label}\n`+report.sections[k as keyof typeof REPORT_SECTIONS].map(c=>`${{original:'来源原文',claim:'作者主张',inference:'AI 推断',hypothesis:'未经验证的假设'}[c.kind]}：${md(c.text)}${c.sourceId?`\n来源 ID：${md(c.sourceId)}\n摘录：${md(c.quote??'')}`:''}`).join('\n\n')),'## 实际采集来源',...sources.map(s=>`${md(s.id)} · ${md(s.title)}\n${md(s.url)}\n${s.type}/${s.status} · 采集 ${new Date(s.collectedAt).toISOString()} · 公开时间 ${md(s.publishedAt??'未知')}\nSHA-256 ${s.hash}`)].join('\n\n');}
export function validateResearchResult(value:unknown):ResearchResult{const r=obj(value);const sources=list(r.sources,10).map(validateSource);const studyId=uid(r.studyId);if(!sources.length||sources.some(s=>s.studyId!==studyId))throw new Error('研究报告来源不属于本研究。');const report=validateResearchReport(r.report,sources);const model=txt(r.model,150),createdAt=num(r.createdAt);return {id:uid(r.id),studyId,createdAt,model,planRevision:num(r.planRevision),report,sources,content:researchReportMarkdown(report,sources,model,createdAt)};}
