import { db } from '../storage';
import { httpUrl } from '../collection/model';
import { beginDraft, draftFromCapture, draftFromScreenshot, editNote } from './repository';
import { showNoteEditor } from './browser';

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'IC_NOTE_OPEN' || sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  void (async () => {
    let id: string;
    if (message.kind === 'active') {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const url = httpUrl(tab?.url) ?? '';
      if (!url) throw new Error('请在普通网页点击收藏，或从灵感库新建手动笔记。');
      id = await db.transaction('rw', db.noteDrafts, async () => {
        const existing = await db.noteDrafts.where('sourcePageUrl').equals(url).sortBy('updatedAt');
        const latest = existing.at(-1);
        if (latest) { await db.noteDrafts.update(latest.id, { sourceTabId: tab.id ?? null }); return latest.id; }
        return beginDraft(`source:${url}`, { sourceTabId: tab.id, sourcePageUrl: url, title: tab.title });
      });
    } else if (message.kind === 'capture' && typeof message.id === 'string') id = await draftFromCapture(message.id);
    else if (message.kind === 'screenshot' && typeof message.id === 'string') id = await draftFromScreenshot(message.id);
    else if (message.kind === 'note' && typeof message.id === 'string') id = await editNote(message.id);
    else if (message.kind === 'blank' && typeof message.requestId === 'string') id = await beginDraft(`manual:${message.requestId}`);
    else throw new Error('无效的编辑请求。');
    await showNoteEditor(id); return id;
  })().then(id => respond({ ok: true, id })).catch(error => respond({ ok: false, error: error instanceof Error ? error.message : '编辑页打开失败，请重试。' }));
  return true;
});
