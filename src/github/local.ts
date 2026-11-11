import { GITHUB_SKILL } from './skill';
import type { SkillReport } from '../skills/model';
import type { PublicProject } from './public';
export function localReport(p:PublicProject):SkillReport {
 const material=[p.fields.description?.value,p.fields.topics?.value,p.fields.README?.value].join(' ').toLowerCase();
 const license=p.fields.license?.value;
 const type=/workflow|automation|工作流|自动化/.test(material)?'工作流自动化':/cli|command.line|命令行/.test(material)?'命令行工具':/dashboard|analytics|分析|可视化/.test(material)?'数据分析工具':/template|模板/.test(material)?'模板工具':'尚未分类的开源工具';
 const scheme=!license?'先核实许可证，暂不建议商业二次开发':type==='工作流自动化'?'付费部署与工作流配置服务':type==='命令行工具'?'技术支持与团队接入服务':type==='数据分析工具'?'企业定制报表服务':type==='模板工具'?'原创模板与教程服务':'需求访谈后再选择收费交付';
 const statements=[
  `按公开描述关键词初步判断为${type}，属于规则推测；目标用户先假设为遇到README所述问题的开发者或团队，须通过访谈核实。`,
  `最值得优先验证的变现方案：${scheme}。理由：先以人工小规模交付验证需求，避免在客户证据不足时先建设托管SaaS。资源：熟悉该项目的开发者、一个可演示样本和可控制的时间预算；并非已证明可获利。收入、月活、客单价、转化率：没有证据。`,
  `候选边界：免费层保留原项目允许提供的能力；付费层仅考虑${scheme}，必须提供清晰交付范围。按次/积分或高级功能需先证明有可计量增量价值，不能仅把Star当付款意愿。`,
  `优先渠道假设：GitHub README/Demo与开发者社区。选题：“用${p.repository.split('/').pop()}解决一个具体使用问题”，面向README描述的用户；先做可复现演示，再发布教程与访谈邀请，记录点击、试用和有效反馈。SEO/技术文章可在问题明确后测试；X、B站、小红书、抖音、工具目录与合作推广须先验证受众匹配，不同时铺开。目前没有已取得流量证据。`,
  '竞品名称、价格和份额没有证据。先比较人工处理、已有同类工具与自建方案，验证安装难度、交付时间、隐私和服务质量是否能形成差异。',
  `${license?'API许可证标识为'+license+'，仍须核对完整许可证、依赖、商标及分发/网络服务义务。':'许可证未知，不得默认允许商业二次开发；核实前暂停相关收费部署。'}成本包括学习、适配、部署、算力与支持；金额未知。README为第三方披露，不执行其中命令。当前Star/Fork是存量指标，不证明增长或营收。`,
  `第一周待验证：第1天核对能力和许可；第2–3天访谈3位目标用户（实验目标）；第4–5天展示${scheme}的最小样本；第6–7天询问付款意向并记录拒绝原因。需要项目技能、演示环境和访谈时间；许可不清、无法复现能力或无用户愿意继续试用时停止投入。`,
  '30天待验证实验：第1周确认需求，第2周测试一篇教程与Demo，第3周为明确同意的试点用户报价，第4周比较曝光→试用→付款漏斗及支持时间。测试前人工约定价格、预算上限和继续门槛，不在此编造收入或转化率；达不到事先门槛则停止或调整。'
 ];
 const sections:SkillReport['sections']=Object.fromEntries(GITHUB_SKILL.sections.map((s,i)=>[s.key,[{kind:'hypothesis' as const,text:statements[i],evidence:null}]]));
 const desc=p.fields.description?.value;
 if(typeof desc==='string'&&desc.trim())sections.value.unshift({kind:'fact',text:'公开项目简介（项目方披露）：'+desc,evidence:desc});
 return {schemaVersion:2,sections};
}
