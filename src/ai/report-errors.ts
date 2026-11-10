// Fixed application-owned diagnostics only: never include upstream text, field names or quotes.
export const REPORT_ERRORS={
 ai_report_json:'返回内容不是合法JSON。',ai_report_shape:'报告根节点或栏目不是JSON对象。',
 ai_report_version:'报告Schema版本与本次模板要求不一致。',ai_report_fields:'报告必需字段/栏目缺失，或存在额外字段。',
 ai_report_items:'每个栏目必须包含1～8个条目。',ai_report_claim:'条目字段或信息类型不符合Schema。',
 ai_report_text:'条目文字为空、类型错误或超过3000字符。',ai_report_evidence:'证据类型错误或超过1000字符。',
 ai_report_evidence_required:'来源陈述必须提供非空原文证据。',ai_report_quote_mismatch:'原文证据不是已发送文本中的连续逐字摘录；空白、换行和Unicode差异也会被拒绝。',
 ai_report_schema:'报告未通过最终JSON Schema校验。',ai_report_validator:'本地报告校验器异常，不能判定结果有效。',
 ai_report_format:'报告格式化失败，尚未生成可保存报告。',
 ai_report_evidence_ref:'证据编号不属于本次预览或原文切片已变化；未自动替换或修正引用。',
 ai_report_evidence_catalog:'证据目录超过安全数量上限，请缩减资料后重新预览；未自动截断。',
} as const;
export type ReportErrorCode=keyof typeof REPORT_ERRORS;
export interface ValidationDetail {field:string;rule:string;expected:string;actual:string;arrayItems:number|null;characters:number|null;sectionIndex:number|null;itemIndex:number|null}
const keys=['summary','targetUsers','painPoints','positioning','businessModel','revenue','acquisition','advantages','costs','replicability','risks','sevenDayPlan','thirtyDayPlan','ninetyDayPlan','questions'];
export const dataType=(v:unknown)=>v===undefined?'缺失':v===null?'null':Array.isArray(v)?'array':typeof v==='object'?'object':typeof v==='string'?'string':typeof v==='number'?'number':typeof v==='boolean'?'boolean':'未知';
export function detailOf(value:unknown,field:string,rule:string,expected:string,sectionIndex:number|null=null,itemIndex:number|null=null):ValidationDetail{return {field,rule,expected,actual:dataType(value),arrayItems:Array.isArray(value)?Math.min(value.length,1000000):null,characters:typeof value==='string'?Math.min([...value].length,1000000):null,sectionIndex,itemIndex};}
export function schemaFailure(error:unknown,value:unknown){
 const e=error as {keyword?:unknown;instancePath?:unknown;params?:Record<string,unknown>};const rule=typeof e?.keyword==='string'&&['type','required','additionalProperties','const','enum','minItems','maxItems','minLength','maxLength'].includes(e.keyword)?e.keyword:'schema';
 const parts=typeof e?.instancePath==='string'?e.instancePath.split('/').slice(1):[];const safe:string[]=[];let current:unknown=value,sectionIndex:number|null=null,itemIndex:number|null=null;
 for(const [i,part]of parts.entries()){const allowed=i===0?['schemaVersion','sections'].includes(part):i===1?keys.includes(part):i===2?/^[0-7]$/.test(part):i===3?['kind','text','evidence'].includes(part):false;if(!allowed)break;safe.push(part);if(i===1)sectionIndex=keys.indexOf(part);if(i===2)itemIndex=Number(part);current=current&&typeof current==='object'&&Object.hasOwn(current,part)?(current as Record<string,unknown>)[part]:undefined;}
 if(rule==='required'){const missing=e.params?.missingProperty;if(typeof missing==='string'&&['schemaVersion','sections','kind','text','evidence',...keys].includes(missing))safe.push(missing);else safe.push('字段已隐藏');current=undefined;}
 const expected=rule==='type'&&['object','array','string','null','number','boolean'].includes(String(e.params?.type))?String(e.params!.type):({required:'必需字段',additionalProperties:'不允许额外字段（名称已隐藏）',const:'模板规定的Schema版本',enum:'fact / inference / hypothesis',minItems:'至少1条',maxItems:'最多8条',minLength:'至少1字符',maxLength:'文本最多3000字符；证据最多1000字符'} as Record<string,string>)[rule]??'应用Schema';
 const code:ReportErrorCode=rule==='required'||rule==='additionalProperties'?'ai_report_fields':rule==='const'?'ai_report_version':rule==='minItems'||rule==='maxItems'?'ai_report_items':rule==='minLength'||rule==='maxLength'?'ai_report_text':'ai_report_schema';
 return new ReportValidationError(code,sectionIndex??undefined,detailOf(current,safe.join('.')||'报告根节点',rule,expected,sectionIndex,itemIndex));
}
export class ReportValidationError extends Error {
 readonly code:ReportErrorCode;readonly sectionIndex?:number;readonly detail?:ValidationDetail;
 constructor(code:ReportErrorCode,sectionIndex?:number,detail?:ValidationDetail){super(`报告未通过 JSON Schema 或来源证据校验：[${code}] ${REPORT_ERRORS[code]}${Number.isInteger(sectionIndex)&&sectionIndex!>=0&&sectionIndex!<15?' 第'+(sectionIndex!+1)+'栏。':''} 未保存报告；费用预留保留，不自动重试。`);this.code=code;this.detail=detail;if(Number.isInteger(sectionIndex)&&sectionIndex!>=0&&sectionIndex!<15)this.sectionIndex=sectionIndex;}
 get stage():'json'|'schema'|'evidence'|'validator'|'format'{return this.code==='ai_report_json'?'json':this.code==='ai_report_validator'?'validator':this.code==='ai_report_format'?'format':this.code.startsWith('ai_report_evidence')||this.code==='ai_report_quote_mismatch'?'evidence':'schema';}
}
