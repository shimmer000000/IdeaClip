import { db } from '../storage';

export async function showNoteEditor(id: string, preferredTabId: number | null = null) {
  const url = chrome.runtime.getURL(`note.html?id=${encodeURIComponent(id)}`);
  if (preferredTabId !== null) {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab.url === url) {
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(preferredTabId, { active: true }); return;
      }
    } catch { /* The editor was closed; the draft is still in IndexedDB. */ }
  }
  await chrome.tabs.create({ url });
}
export async function activateDraftSource(id: string) {
  const draft = await db.noteDrafts.get(id);
  if (!draft || draft.sourceTabId === null) throw new Error('没有连接可读取的原网页。请在目标网页点击 IdeaClip，再选择“收藏当前网页”恢复草稿。');
  const tab = await chrome.tabs.get(draft.sourceTabId).catch(() => null);
  if (!tab || tab.url !== draft.sourcePageUrl) throw new Error('原网页已关闭或跳转。请在目标网页点击 IdeaClip，再选择“收藏当前网页”重新连接草稿。');
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(draft.sourceTabId, { active: true });
}
