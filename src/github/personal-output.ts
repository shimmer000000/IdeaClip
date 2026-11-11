import { PERSONAL_SKILL } from './personal-skill';

// Application-owned structure example. Never interpolate source or authored templates here.
export function personalOutputPrompt(maxOutput: number) {
 const example = {schemaVersion:2,sections:Object.fromEntries(PERSONAL_SKILL.sections.map(s=>[s.key,[{
  kind:'hypothesis',text:'资料不足，需先核实本栏问题并提出可人工审核的验证行动。',evidence:null
 }]]))};
 return `本次是个人 + Codex 创业分析，必须返回完整10栏、schemaVersion:2。最大输出${Math.min(maxOutput,PERSONAL_SKILL.maxOutput)} Token；用简洁内容完成全部栏目，避免前栏过长而遗漏后栏。每栏1～8条，优先1～3条，可在一条text中分点；每条恰好kind/text/evidence三个字段。栏目值必须是数组，即使只有一条也要用[{"kind":"hypothesis","text":"待验证行动","evidence":null}]，不能直接放单个对象、字符串、Markdown或按小标题分组的对象。不能使用items、content等额外包装，也不能用栏目中文名代替固定英文key。个人Codex十栏JSON结构示例：${JSON.stringify(example)}
示例只说明结构，不能照抄为分析内容或证据。必须结合实际资料逐栏回答：problem真实问题和需求/付费证据；feasibility给容易/中等/困难/证据不足及依赖、API/GPU/服务器/权限、Windows和测试难点；mvp写保留/不做、两天安排、人工验收，超期如实缩小；monetization比较候选并选一个验证，交付/客户/价格假设/收费难点；channels只选最匹配的两个渠道及原因；materials给三个原创选题标题、30秒脚本、演示功能、行动引导、指标，不自动发布；costs分开时间、API、服务器、域名部署、支持维护、推广、支付手续费，未知不是0；risks列许可、依赖、商标素材、模型条款、平台规则及待核实限制；week写7天逐日验证和停止条件，计划不是结果；verdict给A/B/C/D及原因、缺口、下一步，另列六项权重评分的来源/缺口与证据覆盖，未知不满分、不输出精确总分。
fact只用于复述本次untrustedSource中明确披露的来源陈述，evidence必须是本次资料的非空连续逐字原文或本次有效临时证据编号，不能引用此示例或模板。不能拼接、翻译、归一化空白/Unicode、加省略号或补造证据。推测用inference，方案、价格、成本/收入估计和计划用hypothesis，二者evidence:null。收入、利润、用户数和转化率无可信披露时明确没有证据，许可证未知时不得默认允许商业使用。
只输出JSON，不加围栏、前言或结语。发送前逐项检查10个固定key齐全，每栏Array，1～8条，所有条目字段齐全，fact证据有效。程序不会将对象自动包装成数组、补齐栏目、自动改类或重试请求。`;
}
