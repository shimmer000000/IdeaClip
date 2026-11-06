import { db } from '../storage';
import { getCredential } from '../ai/config';
import { announceAIChange } from '../ai/events';
import { beginDraft } from '../inspiration/repository';
import { pauseAutomatic } from './policy';
import { sourceOrigins, sourceProblem } from './model';

const SCRIPT = 'ideaclip-local-assist'; const ports = new Set<chrome.runtime.Port>();
let sessionPromise: Promise<string> | null = null; let opening: Promise<void> | null = null; let refreshChain = Promise.resolve();
function getSession() {
  return sessionPromise ??= (async () => { const key = 'ideaclip-auto-session'; const data = await chrome.storage.session.get(key); if (typeof data[key] === 'string') return data[key]; const id = crypto.randomUUID(); await chrome.storage.session.set({ [key]: id }); return id; })();
}
async function openTasks(active: boolean) {
  const url = chrome.runtime.getURL('tasks.html');
  if (typeof chrome.runtime.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB' as chrome.runtime.ContextType] });
    const existing = contexts.find(context => context.documentUrl?.split('?')[0] === url && context.tabId >= 0);
    if (existing) { if (active) await chrome.tabs.update(existing.tabId, { active: true }); return; }
  }
  await chrome.tabs.create({ url, active });
}
function ensureTasks(active = false) { return opening ??= openTasks(active).finally(() => { opening = null; }); }
async function assistAllowed(sender: chrome.runtime.MessageSender) {
  const policy = await db.autoPolicy.get('general');
  if (!sender.tab?.id || sender.frameId !== 0 || !sender.url || !policy || policy.mode !== 'assist' || policy.paused || !(await db.settings.get('general'))?.aiEnabled) return false;
  if (sourceProblem({ url: sender.url, title: '', body: '', content: '' }, policy)) return false;
  return chrome.permissions.contains({ origins: sourceOrigins([new URL(sender.url).hostname]) });
}
function refreshAssist() {
  refreshChain = refreshChain.catch(() => {}).then(async () => {
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT] }); if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT] });
    const policy = await db.autoPolicy.get('general');
    if (policy?.mode === 'assist' && !policy.paused && (await db.settings.get('general'))?.aiEnabled) {
      const matches: string[] = [];
      for (const host of policy.allowHosts) {
        const origin = sourceOrigins([host])[0]; if (sourceProblem({ url: origin.replace('*', ''), title: '', body: '', content: '' }, policy)) continue;
        if (await chrome.permissions.contains({ origins: [origin] })) matches.push(origin);
      }
      if (matches.length) await chrome.scripting.registerContentScripts([{ id: SCRIPT, matches, js: ['assist.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }]);
    }
    for (const port of ports) { try { port.postMessage({ refresh: true }); } catch { ports.delete(port); } }
  }); return refreshChain;
}
const extensionPage = (sender: chrome.runtime.MessageSender) => sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(''));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const type = message?.type;
  if (!['IC_QUEUE_SESSION', 'IC_QUEUE_WAKE', 'IC_TASKS_OPEN', 'IC_AUTO_POLICY_CHANGED', 'IC_AI_CHANGED', 'IC_ASSIST_POLICY', 'IC_ASSIST_OPEN'].includes(type)) return;
  const contentMessage = type === 'IC_ASSIST_POLICY' || type === 'IC_ASSIST_OPEN';
  if (!contentMessage && !extensionPage(sender)) { respond({ ok: false }); return; }
  void (async () => {
    if (type === 'IC_QUEUE_SESSION') return { ok: true, id: await getSession() };
    if (type === 'IC_TASKS_OPEN') { await ensureTasks(true); return { ok: true }; }
    if (type === 'IC_ASSIST_POLICY') return { ok: true, enabled: await assistAllowed(sender) };
    if (type === 'IC_ASSIST_OPEN') {
      if (!await assistAllowed(sender) || !sender.tab?.id || typeof message.url !== 'string' || typeof message.title !== 'string') return { ok: false };
      const tab = await chrome.tabs.get(sender.tab.id); const policy = (await db.autoPolicy.get('general'))!;
      if (tab.url !== message.url || sourceProblem({ url: message.url, title: message.title, body: '', content: '' }, policy)) return { ok: false };
      const id = await beginDraft(`source:${message.url}`, { sourceTabId: sender.tab.id, sourcePageUrl: message.url, title: message.title.slice(0, 1000) });
      await chrome.tabs.create({ url: chrome.runtime.getURL(`note.html?id=${encodeURIComponent(id)}&assist=1`) }); return { ok: true };
    }
    if (type === 'IC_AI_CHANGED') {
      const policy = await db.autoPolicy.get('general'); const config = await db.aiConfig.get('manual');
      if (policy?.autoEnabled) {
        const credential = config ? await getCredential(config.endpoint) : null;
        if (!(await db.settings.get('general'))?.aiEnabled || policy.configVersion !== config?.version || policy.credentialVersion !== (credential?.version ?? null)) await pauseAutomatic('AI 开关、配置或凭据已改变，请核对自动授权后恢复。', db);
      }
    }
    if (type !== 'IC_QUEUE_WAKE') await refreshAssist();
    const policy = await db.autoPolicy.get('general');
    if (policy?.autoEnabled && !policy.paused && (await db.settings.get('general'))?.aiEnabled && await db.aiTasks.where('state').equals('waiting').count()) await ensureTasks();
    return { ok: true };
  })().then(respond).catch(() => respond({ ok: false, error: '自动任务或网页辅助设置未完成，请打开任务中心核对；未绕过费用和权限门禁。' }));
  return true;
});
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'IC_LOCAL_ASSIST' || !port.sender?.tab || port.sender.frameId !== 0) return;
  ports.add(port); port.onDisconnect.addListener(() => ports.delete(port));
});
chrome.runtime.onStartup.addListener(() => { void db.autoPolicy.get('general').then(async policy => { if (policy?.autoEnabled) await pauseAutomatic('浏览器已重启，请在任务中心人工恢复未发送任务。', db); await refreshAssist(); }).catch(() => {}); });
chrome.permissions.onRemoved.addListener(() => { announceAIChange(); void pauseAutomatic('网站或服务商权限被撤销，自动任务已暂停。', db).then(refreshAssist).catch(() => {}); });
