import { obj, sourceDigest, validateRun, validateSource, validateResearchResult, type ResearchSource, type ResearchResult } from './model';
export function portableOnline(table:string,value:unknown,redact:(s:string)=>string,url:(s:unknown)=>string):Record<string,unknown>&{id:string}{
 const source=(raw:unknown)=>{const s=validateSource(raw);return validateSource({...s,url:url(s.url),title:redact(s.title),question:redact(s.question),content:redact(s.content),excerpt:redact(s.excerpt),reason:redact(s.reason)});};
 if(table==='researchSources')return source(value) as unknown as Record<string,unknown>&{id:string};
 if(table==='researchRuns'){const r=validateRun(value);return {...r,question:redact(r.question),operations:r.operations.map(o=>({...o,value:o.kind==='search'?redact(o.value):url(o.value)})),state:'paused',next:r.operations.length,imported:true,reason:r.imported?redact(r.reason):'备份历史只读：不恢复执行授权；原状态 '+r.state+'。'+redact(r.reason)};}
 const r=validateResearchResult(value);const report={schemaVersion:1,sections:Object.fromEntries(Object.entries(r.report.sections).map(([k,claims])=>[k,claims.map(c=>({...c,text:redact(c.text),quote:c.quote===null?null:redact(c.quote)}))]))};
 return validateResearchResult({...r,sources:r.sources.map(source),report}) as unknown as Record<string,unknown>&{id:string};
}
export async function checkOnlineHashes(table:string,value:unknown){const r=obj(value);const sources=table==='researchSources'?[validateSource(r)]:table==='researchReports'?validateResearchResult(r).sources:[];for(const source of sources)if(await sourceDigest(source)!==source.hash)throw new Error('研究来源内容哈希不一致。');}
export async function rehashOnline(table:string,row:Record<string,unknown>&{id:string}){
 if(table==='researchSources'){const s=row as unknown as ResearchSource;s.hash=await sourceDigest(s);}
 if(table==='researchReports'){const r=row as unknown as ResearchResult;for(const s of r.sources)s.hash=await sourceDigest(s);return validateResearchResult(r) as unknown as Record<string,unknown>&{id:string};}
 return row;
}
