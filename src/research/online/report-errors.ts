// Only fixed codes/messages may leave the validator. Never include model data,
// Ajv instance paths, unknown field names, quotes or source identifiers.
const messages = {
 research_version:'报告 Schema 版本与本次确认不符。',
 research_shape:'报告或栏目不是要求的 JSON 对象。',
 research_fields:'报告 Schema 必需字段缺失或存在多余字段。',
 research_items:'报告栏目必须包含 1～8 个条目。',
 research_kind:'报告条目的信息类型不在允许范围。',
 research_text:'报告文字为空、含控制字符或超过字符上限。',
 research_source:'引用来源 ID 不属于本次已审核的可读证据资料，或来源 ID 重复。',
 research_quote_required:'引用来源时必须提供非空逐字摘录；无来源的推测须使用 null。',
 research_quote_mismatch:'摘录不是来源正文的连续逐字子串；空白、换行和 Unicode 差异也会被拒绝。',
 research_original_mismatch:'original 类型的 text 必须与 quote 逐字完全相同；翻译或改写应标为作者主张。',
 research_url:'报告含未采集或格式无效的来源链接。',
 research_validator:'本地研究报告校验器发生异常，无法判定报告是否有效。',
} as const;
export type ResearchReportCode=keyof typeof messages;
export class ResearchReportError extends Error {
 constructor(readonly code:ResearchReportCode){super('['+code+'] '+messages[code]+' 未保存有效报告；费用预留保留，不自动重试。');}
 get stage():'schema'|'evidence'|'validator'{return this.code==='research_validator'?'validator':/^research_(source|quote|original|url)/.test(this.code)?'evidence':'schema';}
}
