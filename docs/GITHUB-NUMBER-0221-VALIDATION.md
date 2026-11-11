# 0.2.21 GitHub商业数字校验诊断

2026-11-11，基于12582dbf583ab59b3cd69a187f6bd9505a9a88ed；开始工作区干净，origin/main一致。

## 问题与证据边界

用户给出的0.2.20诊断显示完整响应、JSON及Schema通过，随后validator异常且未保存。诊断未保存原始模型响应，不能断言本次真实失败是哪一句触发，也不能恢复报告或推算服务商实际扣费。

代码确认有一条可产生同形诊断的路径：GitHub与个人Codex商业数字约束抛普通Error，被AIEngine包装为ai_report_validator，因此detail为空；旧正则把指标名之后16字符内的任意数字都当成商业数字。比如“收入没有证据，建议第1周验证需求”可能误触发。这个确定的代码缺陷不等于已确认用户历史响应的具体原因。

## 修复

只识别收入/营收/利润/月活/客单价/转化率/客户人数紧接数值或有限连接词的声明；不以相邻Star、周数或访谈人数判断收入。规则仍是有限启发式，不能识别所有自然语言、中文数字、复杂单位或证明来源真实。

真正商业数值声明必须按原约束标hypothesis，否则使用固定ReportValidationError ai_report_business_number，归入evidence阶段。安全detail仅保留sections.column-N.item-N.kind、enum、固定hypothesis期望、类型与有限长度，不记录触发原文、金额、引用或凭据。Schema和逐字证据检查保持原样，不自动改类、降级或保存无效报告。

诊断显示可操作的分类要求，预留费用保持，无自动重试。原ai_report_validator仍用于未知异常；旧记录detail:null和evidenceValid:null不回填新原因。不修改模板定义、旧报告、诊断或费用账本，不保存原始失败响应。

## 验证

- 相关Vitest首轮74项通过；包含两模式的无收入证据+第1周、未知收入+Star1200、未知转化率+访谈10人正常保存。
- 两模式的收入预计100万元但kind=inference明确拒绝，Schema=true、evidence=false、报告未存、费用预留不退，仅一次Mock调用；导出不含私人正文/凭据。
- kind=hypothesis的未来估算正常保存；旧通用validator诊断不回填原因。全量Vitest：56文件、1053项通过；Playwright相关11项全部通过，包含七模板证据编号、引用不匹配、JSON错误及两个商业模式的新诊断/误判修复。
- TypeScript及生产构建、Manifest/版本一致性检查通过。保留主bundle体积警告。
- Playwright使用固定localhost Mock响应，不调用真实DeepSeek/OpenAI/Brave等付费接口。诊断查看、复制、重开不重发；再次测试只在人工预览确认后增加一笔Mock调用。

本次不会自动重试用户的失败请求。真实模型响应质量、历史失败原文和实际账单均未知。

原Chrome更新：执行期间桌面报告USER_CONTROL，不抢占用户输入；先交付已构建dist，实机重载结果以最终回复为准。本轮不会在原Chrome重发失败的AI请求或改写诊断。
