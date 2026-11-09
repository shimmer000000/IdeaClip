import {SECTIONS} from './report';

// Guidance, not a tokenizer or a guarantee. Never raises the configured allowance.
export function businessOutputPlan(configured:number,templateLimit=4096){
 const effective=Math.min(configured,templateLimit);
 return {configured,templateLimit,effective,recommended:2048,shortText:effective<=2048,low:effective<2048};
}

export function businessOutputPrompt(maxOutput:number){
 const plan=businessOutputPlan(maxOutput);
 const example={schemaVersion:1,sections:Object.fromEntries(Object.keys(SECTIONS).map(key=>[key,[{kind:'hypothesis',text:'资料不足，需调查本栏问题及验证办法。',evidence:null}]]))};
 return `本次为单篇笔记的15栏商业模式拆解。最大输出${plan.effective} Token，这不是必须用完的目标。优先让全部15栏完整，每栏先写1条有价值的简洁内容，text建议${plan.shortText?'20～60':'40～100'}个中文字符；不要把每栏扩展到8条，不重复背景或整段来源。7/30/90天各用1条说明关键行动、验收信号和未知项。不足信息使用hypothesis说明具体信息缺口及验证办法，推理用inference；两者无直接原文证据时evidence为null，不能伪造fact或营收。
JSON根节点必须且只能有schemaVersion和sections，schemaVersion为1。sections必须包含下述15个英文键，每个值均为数组，即使只有1条也要保留方括号。每条必须且只能含kind/text/evidence三个字段，不能输出sourceId、quote、original、Markdown围栏、前言、注释或尾随逗号。JSON模式只保证JSON语法，不代替本地Schema和证据校验。
fact只代表原资料主张、未独立核验。仅在能复制untrustedSource的title/content/body/url某一个字段内连续逐字子串时使用fact；evidence建议选短句，保留大小写、空格、换行、标点及Unicode。先按JSON转义规则理解输入，再正确编码输出中的换行和引号；不能把输入的转义展示改写成引文，不能引用模板说明或结构示例。无法确保逐字一致时改为明确的inference/hypothesis，不输出改写或翻译后的“原文”。截图不能代替文字证据。
以下只示范完整结构，不是事实或分析结果，不可照抄占位结论；必须根据本次资料为各栏写具体内容。JSON结构示例：${JSON.stringify(example)}
输出前核对15栏均存在、每栏1～8条且优先1条、每条字段齐全、JSON闭合、证据逐字一致；不得靠省略栏目或空数组缩短输出。`;
}
