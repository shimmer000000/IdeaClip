import type { SkillReport } from '../skills/model';
import { PERSONAL_SKILL } from './personal-skill';
export const COST_FIELDS={development:'Codex开发与测试时间（小时）',api:'API或模型费用（元）',server:'服务器费用（元/月）',deployment:'域名和部署费用（元/年）',support:'支持及维护时间（小时/周）',promotion:'推广费用（元）',payment:'支付手续费（%）'};
export type Costs=Partial<Record<keyof typeof COST_FIELDS,string>>;
export function costText(costs:Costs){return Object.entries(COST_FIELDS).map(([key,label])=>{const v=costs[key as keyof Costs]?.trim()??'';if(v&&!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(v))throw Error('成本请输入非负数字，最多两位小数。');if(key==='payment'&&Number(v)>100)throw Error('支付手续费不能超过100%。');return label+'：'+(v?v+'（用户手动披露，未独立核验）':'未知');}).join('\n');}
// Only app-generated metadata BEFORE README is considered a license indicator.
export function signals(source:string){
 const metadata=source.split(/\nREADME:/)[0];
 const readme=source.match(/(?:^|\n)README: ([\s\S]*)/)?.[1];
 const license=metadata.match(/(?:^|\n)license: ([^\n]+)/)?.[1];
 const hasReadme=!!readme&&!/^未知(?:\n|$)/.test(readme);
 const complex=hasReadme&&/GPU|CUDA|kubernetes|distributed|训练|分布式|多租户|multi.tenant|oauth/i.test(readme);
 const small=hasReadme&&!complex&&/CLI|command.line|calculator|convert|formatter|计算器|转换|格式化/i.test(readme);
 const consumer=hasReadme&&/生活|图片|image|photo|简历|resume|文案|视频|video/i.test(readme);
 const knownLicense=!!license&&!/未知|NOASSERTION|unknown/i.test(license);
 const restricted=!!license&&/AGPL|GPL|non.commercial|非商业/i.test(license);
 const security=hasReadme&&/password|credential|支付|密码|人脸|biometric/i.test(readme);
 return {hasReadme,complex,small,consumer,knownLicense,restricted,security,license,readme};
}
export const SCORE_WEIGHTS=[['用户需求',25],['Codex可行性',20],['推广可执行性',20],['变现潜力',15],['维护成本',10],['许可证及合规',10]] as const;
export function personalReport(source:string,title:string,costs:Costs={}):SkillReport {
 const s=signals(source),level=!s.hasReadme?'证据不足':s.complex?'困难':s.small?'中等':'证据不足';
 const channels=s.consumer?['小红书','抖音']:['B站','GitHub'];
 const scheme=!s.knownLicense||s.restricted?'先进行需求访谈和原创教程样品，许可核实前不收费部署或分发':'一次性收费安装与使用指导服务（须先复核许可）';
 const range=s.small?'仅保留一个本地输入→处理→输出的小功能':'只制作一个静态交互演示或人工服务样品，暂不移植原项目';
 const rationale=s.complex?'README存在GPU/分布式/登录等复杂依赖信号，完整项目预期超出两天；不替用户保证可在Windows直接运行。':!s.hasReadme?'README缺失，不能据此判断代码质量、功能范围或开发时长。':'即使轻量工具也需确认依赖、构建与Windows适配，未运行源码不能保证两天交付。';
 const text=[
  '先确认README描述的使用任务及目标用户；公开介绍只证明项目方披露，不是付费需求证据。真实用户访谈、付款和重复使用：没有证据。',
  `判断：${level}。${rationale} 未审计可复用源码；是否有复杂编程知识、依赖、付费API、GPU、服务器及登录权限需求均须逐项核实。最低范围：${range}。Windows Codex负责开发，Playwright和Windows-MCP辅助测试，人工仍需验收、支持与维护；AI能写代码不代表能自动稳定运营。`,
  `${range}。不做：账户体系、多租户、云端托管、支付集成、GPU训练及原项目完整功能。第一天：核实许可/依赖和用户痛点，Codex实现一个离线样本；第二天：Windows样例测试、异常输入、Playwright/Windows-MCP验收和使用说明。人工验收：一组正常输入得到预期输出、错误输入有提示、关闭重开可用、不泄露资料。${s.complex?'完整移植明确超出两天，先缩为静态演示。':'若安装、依赖或核心功能首日仍无法跑通，停止承诺两天并缩为无代码样品。'}`,
  `优先验证：${scheme}。相较广告需要流量、订阅需要持续价值、按次/积分需要计量与账务、定制需要长期维护，先做边界清楚的单次交付。合法软件服务、培训也须核实权利。交付物：一份原创操作样品和一次使用指导；潜在客户：确有该问题但不愿自行安装的个人或小团队。价格测试假设：访谈后测试49～99元一次（待验证，不是实际客单价）；难点是信任、售后及合法收费资格。`,
  `优先两个渠道：${channels.join('、')}。${s.consumer?'按图像/文案/生活工具关键词初步匹配，适合具体问题图文与前后对比短演示。':'按技术工具或受众未知处理，先用详细教程核实技术用户，再用README/Demo触达开发者；受众匹配仍需验证。'} SEO适合有明确长尾搜索的问题；微信生态需先确认已有社群或客户；其余渠道本轮暂不投入，不无条件全选。`,
  `以下为原创草稿，不自动发布。选题1/标题：“${title.slice(0,100)}：一个具体问题怎样解决”；选题2/标题：“从手工到工具，只看这一步”；选题3/标题：“新手第一次使用，哪些坑要避开”。30秒脚本：0–5秒展示真实痛点；5–10秒输入样例；10–22秒演示一个核心输入→输出功能；22–27秒展示结果及限制；27–30秒邀请留言描述问题并报名试用。核心展示：${range}。面向${channels.join('与')}分别采用图文步骤/短演示或详细教程/Demo；行动引导为试用和反馈，跟踪曝光、点击、有效反馈、试用和明确付款意愿，现阶段均无实际转化证据。`,
  costText(costs)+'\n估计与实际分开：未填写项未知，不默认为0。开发时间目标1～2天只是范围假设；API/模型/GPU/服务器是否必需与费用尚待核实，不声称免费。不同周期不可直接相加；利润只能按实际收款减同周期费用计算，当前实际收入/利润/转化率没有证据。',
  `${s.knownLicense?'快照许可证标识：'+s.license+'，仅供核对。':'重大许可证风险：许可证未知。'}${s.restricted?' 发现可能涉及强传染或商业限制的许可标识，需逐条核实义务。':''}${s.security?' 重大安全风险：README涉及凭据/支付/敏感数据，需专门安全审查，不能两天默认上线。':''}商业使用、二次分发、托管服务均待核实；依赖许可、商标、素材、模型条款、平台规则未审查，不默认允许。`,
  '以下均为计划目标：第1天确认痛点并约访3位目标用户；第2天制作演示；第3天开发最小产品或无代码样品；第4天在两个优先渠道发布人工审核的原创内容；第5天收集真实反馈；第6天询问付费意愿，在许可核实后测试报价；第7天按反馈与实际成本决定继续/停止。无人愿试用、许可不清或维护超出能力时停止。访谈与付款不得用合成测试代替。',
  `${!s.knownLicense||s.restricted||s.security?'D：暂不建议投入商业开发。先解决许可/安全风险。':s.complex?'C：适合先人工服务，不急于开发完整系统。': 'B：需要进一步验证需求。'}${rationale} 下一步：补齐需求、许可、依赖和Windows样例证据，再考虑A类快速开发；不以Star或代码先进程度代替赚钱证据。`
 ];
 const sections:SkillReport['sections']=Object.fromEntries(PERSONAL_SKILL.sections.map((k,i)=>[k.key,[{kind:'hypothesis' as const,text:text[i],evidence:null}]]));
 const signal=s.hasReadme?s.readme!.slice(0,100):'README缺失';
 const scored=[false,s.hasReadme,s.hasReadme,false,s.hasReadme,false];
 SCORE_WEIGHTS.forEach(([label,weight],i)=>sections.verdict.push({kind:'hypothesis',text:`${label}（权重${weight}%）：${scored[i]?(i===1?(s.complex?'1/5':'2/5'):i===2?'2/5':s.complex?'1/5':'2/5')+'，规则估分假设，来源为README片段：'+signal:'未知；缺少'+(i===0?'真实需求访谈':i===3?'真实付款意愿和交付成本':'完整许可及合规审查')+'证据'}。${i===4?'维护评分越高表示负担越低；仅粗略依赖信号，未证明维护量。':''}`,evidence:null}));
 const count=scored.filter(Boolean).length,weight=scored.reduce((n,v,i)=>n+(v?SCORE_WEIGHTS[i][1]:0),0);
 sections.verdict.push({kind:'hypothesis',text:`证据覆盖：${count}/6项、权重覆盖${weight}%；仅表示README粗略信号覆盖，不表示已核验商业结论。不输出精确总分，未知不填满分也不按零分计算；不能把覆盖率当成功率。`,evidence:null});
 return {schemaVersion:2,sections};
}
