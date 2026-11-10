import { redact } from '../backup/model';
import { db, type IdeaClipDB } from '../storage';
import { announceAIChange } from '../ai/events';
import { BUSINESS_ID, LEAN_ID, COMPETITOR_ID, CODEX_ID, BUILTINS, skillSignature, validateSkill, type Skill } from './model';
import { signalQueue } from '../automation/signals';

export interface SkillPreferences { id: 'general'; defaultId: string; version: string }
export interface SkillBinding { skillId: string; skillVersion: string; skillSignature: string; skillPreferenceVersion: string }
function currentBuiltin(value:unknown):Skill {
  const skill=validateSkill(value),current=BUILTINS.find(b=>b.id===skill.id);
  // Upgrade only the exact former application definition; preserve local enabled state.
  // Old snapshots/bindings remain untouched and no longer match the new signature.
  if(current&&[BUSINESS_ID,LEAN_ID,COMPETITOR_ID,CODEX_ID].includes(skill.id)&&skill.version==='1.0.0'&&JSON.stringify({...skill,enabled:true,updatedAt:0})===JSON.stringify({...current,version:'1.0.0'}))return {...current,enabled:skill.enabled,updatedAt:skill.updatedAt};
  return skill;
}
export async function listSkills(database = db) { const rows = await database.aiTemplates.toArray(); return [...BUILTINS.filter(b => !rows.some(r => r.id === b.id)), ...rows].map(currentBuiltin); }
export async function getSkill(id: string, database = db): Promise<Skill> {
  const value = await database.aiTemplates.get(id) ?? BUILTINS.find(b => b.id === id);
  if (!value) throw new Error('分析模板不存在，请重新选择。');
  const skill = currentBuiltin(value); if (!skill.enabled) throw new Error('分析模板已停用，请重新选择。');
  if (skill.builtin) { const builtin = BUILTINS.find(b => b.id === id); if (!builtin || JSON.stringify({ ...skill, enabled: true, updatedAt: 0 }) !== JSON.stringify(builtin)) throw new Error('内置模板内容无效。'); }
  return skill;
}
export async function preferences(database = db): Promise<SkillPreferences> { return await database.skillPreferences.get('general') ?? { id: 'general', defaultId: BUSINESS_ID, version: 'initial' }; }
export async function defaultBinding(database = db): Promise<SkillBinding> {
  const pref = await preferences(database); const skill = await getSkill(pref.defaultId, database);
  return { skillId: skill.id, skillVersion: skill.version, skillSignature: skillSignature(skill), skillPreferenceVersion: pref.version };
}
export async function bindingValid(binding: Partial<SkillBinding>, database: IdeaClipDB): Promise<boolean> {
  try { const current = await defaultBinding(database); return !!binding.skillId && Object.entries(current).every(([k, value]) => binding[k as keyof SkillBinding] === value); } catch { return false; }
}
async function change(action: () => Promise<void>, database: IdeaClipDB) {
  await database.transaction('rw', [database.aiTemplates, database.skillPreferences, database.autoPolicy, database.aiTasks], async () => {
    await action(); const pref = await preferences(database);
    await database.skillPreferences.put({ ...pref, version: crypto.randomUUID() });
    const p = await database.autoPolicy.get('general');
    if (p) await database.autoPolicy.update('general', { paused: true, reason: '模板或默认模板已改变，请在设置页重新确认自动分析模板与授权。' });
    await database.aiTasks.where('state').equals('waiting').modify({ state: 'paused', errorCode: 'template', reason: '模板授权已改变，不会自动改用新版本；请核对后重新授权。', updatedAt: Date.now() });
  }); announceAIChange(); signalQueue();
}
export async function saveSkill(value: unknown, database = db, expectedVersion?: string) {
  const parsed = validateSkill(value); if (parsed.builtin) throw new Error('内置模板只能复制或启停。');
  const next = { ...parsed, version: crypto.randomUUID(), updatedAt: Date.now() };
  await change(async () => {
    const old = await database.aiTemplates.get(next.id);
    if (old && old.version !== expectedVersion) throw new Error('模板已在其他窗口修改或 ID 冲突，未覆盖；请重新读取。');
    if (!old && expectedVersion) throw new Error('模板已删除，未重新创建。');
    if (!old && await database.aiTemplates.count() >= 100) throw new Error('本机最多保存 100 个模板记录。');
    await database.aiTemplates.put(next);
  }, database); return next;
}
export async function copySkill(skill: Skill, database = db) { return saveSkill({ ...skill, id: 'custom-' + crypto.randomUUID(), name: skill.name.slice(0, 70) + '（副本）', builtin: false, enabled: true }, database); }
export async function setDefaultSkill(id: string, database = db) { await change(async () => { await getSkill(id, database); await database.skillPreferences.put({ id: 'general', defaultId: id, version: crypto.randomUUID() }); }, database); }
export async function toggleSkill(id: string, database = db) {
  await change(async () => { const row = (await listSkills(database)).find(s => s.id === id); if (!row) throw new Error('模板不存在。'); await database.aiTemplates.put({ ...row, enabled: !row.enabled, ...(row.builtin ? {} : { version: crypto.randomUUID() }), updatedAt: Date.now() }); }, database);
}
export async function deleteSkill(id: string, database = db) { await change(async () => { const row = await database.aiTemplates.get(id); if (!row || row.builtin) throw new Error('只能删除自定义模板。'); await database.aiTemplates.delete(id); }, database); }
export function exportSkill(skill: Skill): string { return JSON.stringify({ format: 'IdeaClip-Skill', formatVersion: 1, template: validateSkill(JSON.parse(JSON.stringify(skill), (_key, value) => typeof value === 'string' ? redact(value) : value)) }, null, 2); }
export async function importSkill(text: string, database = db) {
  if (new TextEncoder().encode(text).length > 32768) throw new Error('模板文件超过 32 KiB。');
  const raw = JSON.parse(text); if (!raw || raw.format !== 'IdeaClip-Skill' || raw.formatVersion !== 1 || Object.keys(raw).length !== 3) throw new Error('模板文件格式或版本不兼容。');
  const skill = validateSkill(raw.template);
  // Import always creates a new disabled local identity, never local consent.
  return saveSkill({ ...skill, id: 'custom-' + crypto.randomUUID(), builtin: false, enabled: false }, database);
}
