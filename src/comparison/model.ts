import { type Note } from '../storage';
import { digest } from '../backup/zip';
import { validateSkillReport, BUILTINS, type Skill } from '../skills/model';
import type { Claim } from '../ai/report';
import schema from '../ai/generated/schema.json' with { type: 'json' };
export const DIMENSIONS = { demand: '用户需求', market: '目标市场', profit: '潜在盈利方式', development: '开发难度', funding: '初期资金需求', operation: '运营成本', acquisition: '获客难度', competition: '竞争强度', replicability: '可复制性', compliance: '合规风险', feasibility: '小团队执行可行性', experiment: '最小验证方案' };
export const WEIGHTS = { funding: '资金投入', development: '开发难度', acquisition: '获客难度', profit: '盈利潜力', compliance: '风险' };
export type Weights = Record<keyof typeof WEIGHTS, number>;
export const DEFAULT_WEIGHTS: Weights = { funding: 1, development: 1, acquisition: 1, profit: 1, compliance: 1 };
export interface Source { id: string; revision: number; updatedAt: number; hash: string; title: string; url: string; content: string; body: string; quality: string }
export interface Opportunity { noteId: string; dimensions: Record<keyof typeof DIMENSIONS, { score: number; claims: Claim[] }>; strengths: Claim[]; weaknesses: Claim[]; unknowns: Claim[]; risks: Claim[]; tasks: Claim[]; reason: Claim[]; sevenDays: Claim[]; stopConditions: Claim[] }
export interface ComparisonReport { schemaVersion: 1; projects: Opportunity[] }
export const GROUPS = { strengths: '优势', weaknesses: '劣势', unknowns: '关键未知项', risks: '主要风险', tasks: '验证任务', reason: '优先验证理由', sevenDays: '7 天验证计划', stopConditions: '不建议投入的条件' };
const claims = { type: 'array', minItems: 1, maxItems: 8, items: schema.$defs.claim };
export const COMPARISON_SCHEMA = { type: 'object', additionalProperties: false, required: ['schemaVersion', 'projects'], properties: { schemaVersion: { const: 1 }, projects: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['noteId', 'dimensions', ...Object.keys(GROUPS)], properties: { noteId: { type: 'string' }, dimensions: { type: 'object', additionalProperties: false, required: Object.keys(DIMENSIONS), properties: Object.fromEntries(Object.keys(DIMENSIONS).map(k => [k, { type: 'object', additionalProperties: false, required: ['score', 'claims'], properties: { score: { type: 'number', minimum: 0, maximum: 10 }, claims } }])) }, ...Object.fromEntries(Object.keys(GROUPS).map(k => [k, claims])) } } } } };
export const noteHash = (n: Note) => digest(new Blob([JSON.stringify({ id: n.id, title: n.title, url: n.url, content: n.content, body: n.body, revision: n.revision, updatedAt: n.updatedAt, saveState: n.saveState })]));
export function selectedIds(ids: string[]) { const unique = [...new Set(ids)]; if (unique.length < 2 || unique.length > 10 || unique.some(id => typeof id !== 'string' || !id || id.length > 500)) throw new Error('请选择 2～10 条不同的已保存灵感。'); return unique; }
export function validateComparison(value: unknown, sources: Source[]): ComparisonReport {
  selectedIds(sources.map(s => s.id)); const r = value as ComparisonReport;
  if (!r || Object.keys(r).sort().join() !== 'projects,schemaVersion' || r.schemaVersion !== 1 || !Array.isArray(r.projects) || r.projects.length !== sources.length || new Set(r.projects.map(p => p?.noteId)).size !== sources.length) throw new Error('对比报告结构或项目数量无效。');
  const validateClaims = (entries: Record<string, Claim[]>, source: Source) => { const skill: Skill = { ...BUILTINS[1], sections: Object.keys(entries).map(key => ({ key, label: key, instruction: key })) }; validateSkillReport({ schemaVersion: 2, sections: entries }, skill, [source.title, source.url, source.content, source.body].join('\n')); };
  for (const p of r.projects) {
    const source = sources.find(s => s.id === p.noteId); if (!source || Object.keys(p).sort().join() !== ['noteId', 'dimensions', ...Object.keys(GROUPS)].sort().join() || !p.dimensions || Object.keys(p.dimensions).sort().join() !== Object.keys(DIMENSIONS).sort().join()) throw new Error('项目来源或维度无效。');
    const entries: Record<string, Claim[]> = {};
    for (const key of Object.keys(DIMENSIONS) as (keyof typeof DIMENSIONS)[]) { const d = p.dimensions[key]; if (!d || Object.keys(d).sort().join() !== 'claims,score' || !Number.isFinite(d.score) || d.score < 0 || d.score > 10) throw new Error('参考评分必须是 0～10。'); entries[key] = d.claims; }
    validateClaims(entries, source); validateClaims(Object.fromEntries(Object.keys(GROUPS).map(k => [k, p[k as keyof typeof GROUPS]])), source);
  }
  return r;
}
export function rank(report: ComparisonReport, weights: Weights) {
  if (Object.keys(weights).sort().join() !== Object.keys(WEIGHTS).sort().join() || Object.values(weights).some(v => !Number.isFinite(v) || v < 0 || v > 100) || !Object.values(weights).some(v => v > 0)) throw new Error('权重为 0～100，至少一项大于 0。');
  const sum = Object.values(weights).reduce((a,b) => a+b,0);
  return report.projects.map(p => ({ project: p, score: Object.entries(weights).reduce((a,[k,v]) => a + v * p.dimensions[k as keyof Weights].score, 0) / sum })).sort((a,b) => b.score-a.score);
}
export function comparisonMarkdown(report: ComparisonReport, sources: Source[], weights = DEFAULT_WEIGHTS) {
 const safe = (s: string) => s.replace(/[\\`*_{}\[\]()#!|<>]/g, c => '\\' + c);
 return '# IdeaClip 商业机会对比\n\n评分为 AI 启发式参考，未经过真实市场验证；所有维度 0～10，越高表示条件越有利。\n权重：'+JSON.stringify(weights)+'\n\n| 项目 | '+Object.values(DIMENSIONS).join(' | ')+' | 加权参考分 |\n| '+Array(14).fill('---').join(' | ')+' |\n'+rank(report,weights).map(r=>'| '+safe(sources.find(s=>s.id===r.project.noteId)!.title).replace(/[\r\n]/g,' ')+' | '+Object.keys(DIMENSIONS).map(k=>r.project.dimensions[k as keyof typeof DIMENSIONS].score).join(' | ')+' | '+r.score.toFixed(2)+' |').join('\n')+'\n\n'+rank(report,weights).map((r,i) => `## ${i+1}. ${safe(sources.find(s=>s.id===r.project.noteId)!.title)} · ${r.score.toFixed(2)}\n`+Object.entries({...Object.fromEntries(Object.entries(DIMENSIONS).map(([k,label])=>[label,r.project.dimensions[k as keyof typeof DIMENSIONS].claims])),...Object.fromEntries(Object.entries(GROUPS).map(([k,label])=>[label,r.project[k as keyof typeof GROUPS]]))}).map(([label,items])=>'### '+label+'\n'+items.map(c=>`- ${c.kind}：${safe(c.text)}${c.evidence ? ' 来源摘录：'+safe(c.evidence):''}`).join('\n')).join('\n\n')).join('\n\n');
}
