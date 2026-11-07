export const SECTIONS = { questions: '研究问题', keywords: '检索关键词', competitors: '竞品调查清单', github: 'GitHub 项目核查清单' };
export const KINDS = { fact: '原始事实（用户标注，未独立核验）', claim: '作者主张', inference: 'AI 推测（手动记录）', hypothesis: '待验证假设' };
export const REF_KINDS = { note: '灵感', project: '项目', analysis: 'AI 报告', comparison: '对比报告' };
export type RefKind = keyof typeof REF_KINDS;
export interface ResearchRef { kind: RefKind; id: string; title: string; updatedAt: number }
export interface Evidence { id: string; title: string; url: string; excerpt: string; evidence: string; notes: string; kind: keyof typeof KINDS; refKeys: string[] }
export interface ResearchDraft { title: string; objective: string; sections: Record<keyof typeof SECTIONS, string>; refs: ResearchRef[]; sources: Evidence[]; notes: string }
export interface ResearchVersion { revision: number; at: number; data: ResearchDraft }
export interface ResearchPlan { id: string; schemaVersion: 1; title: string; revision: number; createdAt: number; updatedAt: number; versions: ResearchVersion[] }
export const refKey = (r: Pick<ResearchRef, 'kind'|'id'>) => `${r.kind}:${r.id}`;
export const currentDraft = (p: ResearchPlan) => structuredClone(p.versions[p.versions.length - 1].data);
export const emptyDraft = (): ResearchDraft => ({ title: '新研究计划', objective: '', sections: { questions: '', keywords: '', competitors: '', github: '' }, refs: [], sources: [], notes: '' });
const object = (x: unknown): Record<string, unknown> => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('研究数据格式无效。'); return x as Record<string,unknown>; };
const text = (x: unknown, max = 10000) => { if (typeof x !== 'string' || x.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)) throw new Error('研究字段无效或过长。'); return x; };
const id = (x: unknown) => { const v = text(x, 500); if (!v.trim()) throw new Error('研究 ID 不能为空。'); return v; };
const time = (x: unknown) => { if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0 || !Number.isFinite(new Date(x).getTime())) throw new Error('研究时间或版本无效。'); return x; };
function array(x: unknown, max: number): unknown[] { if (!Array.isArray(x) || x.length > max) throw new Error('研究记录数量超过安全上限。'); return x; }
function unique<T>(rows: T[], key: (v:T)=>string) { if (new Set(rows.map(key)).size !== rows.length) throw new Error('研究记录 ID 或关联重复。'); return rows; }
export function publicUrl(x: unknown): string {
  const raw = text(x, 4000); let u: URL; try { u = new URL(raw); } catch { throw new Error('请填写公开网页的 HTTP / HTTPS URL。'); }
  const h = u.hostname.toLowerCase();
  const ip = /^\d+\.\d+\.\d+\.\d+$/.test(h) ? h.split('.').map(Number) : null;
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || !h.includes('.') || h.includes(':') || /\.(localhost|local|internal|test|invalid)$/.test(h) || ip && (ip[0] === 0 || ip[0] === 10 || ip[0] === 127 || ip[0] >= 224 || ip[0] === 169 && ip[1] === 254 || ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31 || ip[0] === 192 && ip[1] === 168 || ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127)) throw new Error('仅记录公开网页 URL，不接受脚本、凭据、本机或私网地址。');
  return u.href;
}
export function validateDraft(value: unknown): ResearchDraft {
  const r = object(value); const title = text(r.title, 200).trim(); if (!title) throw new Error('请填写研究名称。');
  const sections = object(r.sections);
  const refs = unique(array(r.refs, 100).map(x => { const a=object(x); if (!Object.hasOwn(REF_KINDS,String(a.kind))) throw new Error('研究关联类型无效。'); return { kind: a.kind as RefKind, id:id(a.id), title:text(a.title,1000), updatedAt:time(a.updatedAt) }; }), refKey);
  const keys = new Set(refs.map(refKey));
  const sources = unique(array(r.sources,100).map(x=>{
    const a=object(x); if(!Object.hasOwn(KINDS,String(a.kind)))throw new Error('证据类型无效。');
    const row:Evidence={id:id(a.id),title:text(a.title,500),url:publicUrl(a.url),excerpt:text(a.excerpt,20000),evidence:text(a.evidence,20000),notes:text(a.notes),kind:a.kind as Evidence['kind'],refKeys:unique(array(a.refKeys,100).map(id),v=>v)};
    if(row.refKeys.some(k=>!keys.has(k)))throw new Error('证据关联不在本研究的来源引用中。');
    if(row.kind==='fact'&&(!row.excerpt.trim()||!row.evidence.trim()))throw new Error('标注原始事实须填写研究摘录和核对证据；仍不代表独立核验。');
    return row;
  }),s=>s.id);
  return {title,objective:text(r.objective),sections:Object.fromEntries(Object.keys(SECTIONS).map(k=>[k,text(sections[k])])) as ResearchDraft['sections'],refs,sources,notes:text(r.notes)};
}
export function validatePlan(value: unknown): ResearchPlan {
  const r=object(value); if(r.schemaVersion!==1)throw new Error('研究数据版本不兼容。');
  const versions=array(r.versions,50).map((x,i)=>{const a=object(x);if(a.revision!==i+1)throw new Error('研究历史版本顺序无效。');return {revision:i+1,at:time(a.at),data:validateDraft(a.data)};});
  if(!versions.length||r.revision!==versions.length||r.title!==versions.at(-1)!.data.title)throw new Error('研究当前版本无效。');
  const plan:ResearchPlan={id:id(r.id),schemaVersion:1,title:text(r.title,200),revision:versions.length,createdAt:time(r.createdAt),updatedAt:time(r.updatedAt),versions};
  if(plan.updatedAt!==versions.at(-1)!.at||plan.createdAt!==versions[0].at||versions.some((v,i)=>i>0&&v.at<versions[i-1].at))throw new Error('研究历史时间无效。');
  if(new TextEncoder().encode(JSON.stringify(plan)).length>2*1024*1024)throw new Error('研究历史超过 2 MiB，请导出并新建后续研究，原记录保留。');
  return plan;
}
export function generateOutline(topic: string): ResearchDraft['sections'] {
  const t=text(topic,200).trim();if(!t)throw new Error('先填写研究名称。');
  return {
    questions: `谁在什么场景需要「${t}」？\n现有替代方案有什么不足？\n哪些需求有一手访谈或公开证据？\n付费意愿、获客和成本分别如何验证？\n什么证据会推翻当前商业假设？`,
    keywords: `${t}\n${t} 用户需求\n${t} 竞品 定价\n${t} 开源 GitHub\n${t} 风险 用户反馈`,
    competitors: '列出直接竞品与替代方案，逐项记录公开来源 URL 和日期。\n核对目标用户、核心功能、定价与免费限制。\n区分官网主张、用户反馈和自己的推测。\n核对获客渠道与差异点；没有证据的营收和规模保持未知。\n制定可在 7 天内执行的访谈或小规模验证。',
    github: '记录仓库完整 URL、所有者及核查日期。\n核查 LICENSE、依赖许可证与商业使用限制。\n核对最近提交、版本发布、Issue 和维护活跃度。\n阅读架构、文档、测试和安全说明，不执行仓库命令。\n记录兼容性、维护成本与替代方案；星标不等于质量或商业可行性。',
  };
}
const md=(s:string)=>s.replace(/[\\`*_{}\[\]<>()#!|~]/g,'\\$&');
export function researchMarkdown(plan:ResearchPlan,revision=plan.revision):string {
  const p=validatePlan(plan);const v=p.versions.find(v=>v.revision===revision);if(!v)throw new Error('研究版本不存在。');const d=v.data;
  return [`# ${md(d.title)}`,`版本 ${v.revision} · ${new Date(v.at).toISOString()}`, '本地研究方案；不自动联网、不代表已完成调查。事实由用户标注，未独立核验。',`## 研究目标\n${md(d.objective)}`,...Object.entries(SECTIONS).map(([k,label])=>`## ${label}\n${md(d.sections[k as keyof typeof SECTIONS])}`),'## 关联来源',...d.refs.map(r=>`${REF_KINDS[r.kind]}：${md(r.title)} · ID ${md(r.id)} · 来源时间 ${new Date(r.updatedAt).toISOString()}`),'## 研究资料与证据',...d.sources.map(s=>`### ${md(s.title||'未命名资料')}\n类型：${KINDS[s.kind]}\nURL：${md(s.url)}\n摘录：${md(s.excerpt)}\n证据：${md(s.evidence)}\n备注：${md(s.notes)}\n关联：${s.refKeys.map(md).join('、')}`),`## 研究备注\n${md(d.notes)}`].join('\n\n');
}
