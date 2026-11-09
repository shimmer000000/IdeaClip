import {evidenceText} from './evidence-text.ts';

export const REPORT_BYTES=128*1024,RECORD_BYTES=512*1024;
export interface TestEvidence {id:string;command:string;status:'passed'|'failed';exitCode:number|null;startedAt:string;finishedAt:string;durationMs:number;logExcerpt:string;logSha256:string}
export interface CodexReport {format:'IdeaClipCodexDelivery';schemaVersion:1|2;taskPackage?:{packageId:string;contentSha256:string};reportId:string;projectId:string;taskId:string;repository:string;commitSha:string;summary:string;files:string[];tests:TestEvidence[];notRun:{command:string;reason:string}[];risks:string[];generatedAt:string;localRecordId:string|null}
export interface LocalRecord {format:'IdeaClipLocalTestRecord';schemaVersion:1;recordId:string;repository:string;commitSha:string;treeSha:string;tests:TestEvidence[];logs:{testId:string;content:string}[];generatedAt:string}
export interface LocalCheck {recordId:string;recordDigest:string;checkedAt:number;sourceName:string;historical:boolean}
export interface EvidenceEntry {version:number;report:CodexReport;fileDigest:string;sourceName:string;importedAt:number;historical:boolean;localCheck?:LocalCheck}
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const invalid=()=>{throw Error('交付JSON的Schema、字段或长度无效。');};
export function shape(value:unknown,keys:string[]):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))return invalid();return value as Record<string,any>;}
function text(v:unknown,max:number,nonempty=false){if(typeof v!=='string'||v.length>max||nonempty&&!v.trim())return invalid();return evidenceText(v);}
function id(v:unknown){const s=text(v,100,true);if(!UUID.test(s))return invalid();return s.toLowerCase();}
function hash(v:unknown,len=64){if(typeof v!=='string'||!(len===40?/^[a-f0-9]{40}$/:/^[a-f0-9]{64}$/).test(v))return invalid();return v;}
function time(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)return invalid();return v;}
function num(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)return invalid();return v;}
function list(v:unknown,max:number){if(!Array.isArray(v)||v.length>max)return invalid();return v as unknown[];}
// No extra paths, credentials, query strings, wildcards, dot segments or shell expansion.
export function evidenceRepository(v:unknown){if(typeof v!=='string'||v.length>300||!/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(v)||v.endsWith('/.')||v.endsWith('/..')||v.endsWith('.git'))return invalid();return v;}
export function evidencePath(v:unknown){if(typeof v!=='string'||!v||v.length>300||v.startsWith('/')||/[\\:*?\r\n\x00-\x1f$%]/.test(v)||v.split('/').some(s=>!s||s==='.'||s==='..')||evidenceText(v)!==v)return invalid();return v;}
export function sourceName(v:unknown){if(typeof v!=='string'||v.length>120||!v.endsWith('.json')||/[\\/:\x00-\x1f]/.test(v)||evidenceText(v)!==v)return invalid();return v;}
export function validateTest(value:unknown):TestEvidence {
 const t=shape(value,['id','command','status','exitCode','startedAt','finishedAt','durationMs','logExcerpt','logSha256']);
 if(!['passed','failed'].includes(t.status)||t.exitCode!==null&&(!Number.isSafeInteger(t.exitCode)||Math.abs(t.exitCode)>2147483647)||t.status==='passed'&&t.exitCode!==0||t.status==='failed'&&t.exitCode===0)return invalid();
 const startedAt=time(t.startedAt),finishedAt=time(t.finishedAt),durationMs=num(t.durationMs,0,86400000);if(Date.parse(finishedAt)-Date.parse(startedAt)!==durationMs)return invalid();
 return {id:id(t.id),command:text(t.command,512,true),status:t.status,exitCode:t.exitCode,startedAt,finishedAt,durationMs,logExcerpt:text(t.logExcerpt,2000),logSha256:hash(t.logSha256)};
}
function tests(v:unknown){const t=list(v,20).map(validateTest);if(new Set(t.map(x=>x.id)).size!==t.length)return invalid();return t;}
function generated(v:unknown,items:TestEvidence[]){const s=time(v);if(items.some(t=>Date.parse(t.finishedAt)>Date.parse(s)))return invalid();return s;}
export function validateCodexReport(value:unknown):CodexReport {
 const linked=(value as CodexReport)?.schemaVersion===2;const r=shape(value,[...(linked?['taskPackage']:[]),'format','schemaVersion','reportId','projectId','taskId','repository','commitSha','summary','files','tests','notRun','risks','generatedAt','localRecordId']);if(r.format!=='IdeaClipCodexDelivery'||![1,2].includes(r.schemaVersion))return invalid();
 const ref=linked?shape(r.taskPackage,['packageId','contentSha256']):null;
 const files=list(r.files,300).map(evidencePath),results=tests(r.tests);if(new Set(files).size!==files.length)return invalid();
 return {format:r.format,schemaVersion:r.schemaVersion,...(ref?{taskPackage:{packageId:id(ref.packageId),contentSha256:hash(ref.contentSha256)}}:{}),reportId:id(r.reportId),projectId:id(r.projectId),taskId:id(r.taskId),repository:evidenceRepository(r.repository),commitSha:hash(r.commitSha,40),summary:text(r.summary,2000,true),files,tests:results,notRun:list(r.notRun,20).map(v=>{const n=shape(v,['command','reason']);return {command:text(n.command,512,true),reason:text(n.reason,500,true)};}),risks:list(r.risks,20).map(v=>text(v,500,true)),generatedAt:generated(r.generatedAt,results),localRecordId:r.localRecordId===null?null:id(r.localRecordId)};
}
export function validateLocalRecord(value:unknown):LocalRecord {
 const r=shape(value,['format','schemaVersion','recordId','repository','commitSha','treeSha','tests','logs','generatedAt']);if(r.format!=='IdeaClipLocalTestRecord'||r.schemaVersion!==1)return invalid();
 const results=tests(r.tests),logs=list(r.logs,20).map(v=>{const l=shape(v,['testId','content']);return {testId:id(l.testId),content:text(l.content,16384)};});
 if(logs.length!==results.length||new Set(logs.map(l=>l.testId)).size!==logs.length||results.some(t=>!logs.some(l=>l.testId===t.id)))return invalid();
 return {format:r.format,schemaVersion:1,recordId:id(r.recordId),repository:evidenceRepository(r.repository),commitSha:hash(r.commitSha,40),treeSha:hash(r.treeSha,40),tests:results,logs,generatedAt:generated(r.generatedAt,results)};
}
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export function parseEvidence(text:string,max:number){if(new TextEncoder().encode(text).length>max)throw Error('交付文件超过大小上限。');try{return JSON.parse(text);}catch{throw Error('交付文件不是合法JSON。');}}
export function evidenceEntries(value:unknown,historical=false):EvidenceEntry[]{
 const entries=list(value,10).map(v=>{const e=v as EvidenceEntry;if(!e||typeof e.historical!=='boolean')return invalid();const report=validateCodexReport(e.report);const check=e.localCheck;if(check&&(typeof check.historical!=='boolean'||!UUID.test(check.recordId)||check.recordId.toLowerCase()!==report.localRecordId))return invalid();return {version:num(e.version,1,10),report,fileDigest:hash(e.fileDigest),sourceName:sourceName(e.sourceName),importedAt:num(e.importedAt,0,8640000000000000),historical:historical||e.historical,...(check?{localCheck:{recordId:id(check.recordId),recordDigest:hash(check.recordDigest),checkedAt:num(check.checkedAt,0,8640000000000000),sourceName:sourceName(check.sourceName),historical:historical||check.historical}}:{})};});
 if(new Set(entries.map(e=>e.report.reportId)).size!==entries.length||entries.some((e,i)=>e.version!==i+1))return invalid();return entries;
}
