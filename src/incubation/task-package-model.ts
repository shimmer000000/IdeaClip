import {UUID,shape,digest,evidencePath,evidenceRepository,parseEvidence} from './local-evidence-model';
import deliverySchema from '../../docs/CODEX-DELIVERY.schema.json';
export const PACKAGE_BYTES=128*1024;
export const DELIVERY_CONTRACT={format:'IdeaClipCodexDelivery',schemaVersion:2,association:'taskPackage.packageId + taskPackage.contentSha256',schemaFile:'docs/CODEX-DELIVERY.schema.json',schema:deliverySchema.oneOf[1]} as const;
export interface TaskPackage {
 format:'IdeaClipCodexTask';schemaVersion:1;packageId:string;generatedAt:string;contentSha256:string;
 executionAuthorized:false;
 task:{projectId:string;taskId:string;type:'development';projectPurpose:'development';goal:string;notes:string;repository:string;workingDirectory:string;allowedPaths:string[];acceptance:string;instructions:string};
 delivery:typeof DELIVERY_CONTRACT;
}
export interface PackageHistory {packageId:string;contentSha256:string;bindingHash:string;generatedAt:string;exportedAt:number;handedOffAt:number|null;historical:boolean;repository?:string}
export function canonical(value:unknown):string {if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';}
export function packageUuid(v:unknown){if(typeof v!=='string'||!UUID.test(v))throw Error('任务包ID无效。');return v.toLowerCase();}
export function packageHash(v:unknown){if(typeof v!=='string'||!(/^[a-f0-9]{64}$/).test(v))throw Error('任务包哈希无效。');return v;}
export function packageTime(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)throw Error('任务包时间无效。');return v;}
export function packageText(v:unknown,max:number,required=true){if(typeof v!=='string'||v.length>max||required&&!v.trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('任务包字段无效或过长。');return v;}
export async function packageDigest(p:Omit<TaskPackage,'contentSha256'>|TaskPackage){const {contentSha256:_,...unsigned}=p as TaskPackage;return digest(canonical(unsigned));}
export async function decodeTaskPackage(text:string):Promise<TaskPackage>{
 const p=shape(parseEvidence(text,PACKAGE_BYTES),['format','schemaVersion','packageId','generatedAt','contentSha256','executionAuthorized','task','delivery']);
 if(p.format!=='IdeaClipCodexTask'||p.schemaVersion!==1||p.executionAuthorized!==false)throw Error('任务包版本或执行授权字段无效；只接受数据包。');
 const t=shape(p.task,['projectId','taskId','type','projectPurpose','goal','notes','repository','workingDirectory','allowedPaths','acceptance','instructions']);
 if(t.type!=='development'||t.projectPurpose!=='development'||!Array.isArray(t.allowedPaths)||!t.allowedPaths.length||t.allowedPaths.length>20)throw Error('任务包仅接受已绑定的软件开发任务。');
 const allowedPaths=t.allowedPaths.map(evidencePath);if(new Set(allowedPaths).size!==allowedPaths.length)throw Error('任务包范围重复。');
 shape(p.delivery,Object.keys(DELIVERY_CONTRACT));if(canonical(p.delivery)!==canonical(DELIVERY_CONTRACT))throw Error('交付协议不兼容。');
 const result:TaskPackage={format:p.format,schemaVersion:1,packageId:packageUuid(p.packageId),generatedAt:packageTime(p.generatedAt),contentSha256:packageHash(p.contentSha256),executionAuthorized:false,task:{projectId:packageUuid(t.projectId),taskId:packageUuid(t.taskId),type:t.type,projectPurpose:t.projectPurpose,goal:packageText(t.goal,1000),notes:packageText(t.notes,10000,false),repository:packageText(t.repository,300),workingDirectory:packageText(t.workingDirectory,2000),allowedPaths,acceptance:packageText(t.acceptance,30000),instructions:packageText(t.instructions,50000)},delivery:DELIVERY_CONTRACT};
 if(await packageDigest(result)!==result.contentSha256)throw Error('任务包内容SHA-256不一致，可能已篡改，未接受。');return result;
}
export function packageHistories(value:unknown,historical=false):PackageHistory[]{
 if(!Array.isArray(value)||value.length>10)throw Error('任务包历史超过10版或格式无效。');
 const n=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||!Number.isFinite(new Date(v).getTime()))throw Error('任务包记录时间无效。');return v;};
 const rows=value.map(v=>{const h=v as PackageHistory;if(!h||typeof h.historical!=='boolean')throw Error('任务包历史无效。');const generatedAt=packageTime(h.generatedAt),exportedAt=n(h.exportedAt),handedOffAt=h.handedOffAt===null?null:n(h.handedOffAt);if(Date.parse(generatedAt)>exportedAt||handedOffAt!==null&&handedOffAt<exportedAt)throw Error('任务包历史时间顺序无效。');return {packageId:packageUuid(h.packageId),contentSha256:packageHash(h.contentSha256),bindingHash:packageHash(h.bindingHash),generatedAt,exportedAt,handedOffAt,historical:historical||h.historical,...(h.repository!==undefined?{repository:evidenceRepository(h.repository)}:{})};});
 if(new Set(rows.map(h=>h.packageId)).size!==rows.length)throw Error('任务包历史ID重复。');return rows;
}
