import { db } from '../storage';
import { resolveBrowserShortLinks } from './short-link-browser';
import { withResolvedProjects, tcoUrl } from './short-links';
import { emptyPage, type ExtractedPage } from './model';
import { storeExtraction } from './storage';
import { activateDraftSource, showNoteEditor } from '../inspiration/browser';
import { stageCapture } from '../inspiration/repository';

let collecting = false;
export async function collectActivePage(draftId?: string, editorTabId: number | null = null) {
  if (draftId) await activateDraftSource(draftId);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let page: ExtractedPage;
  try {
    if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) throw new Error('此页面不可采集或缺少权限。请在普通网页点击插件图标授权；也可以手动粘贴正文。');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collect.js'] });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const extract = (globalThis as typeof globalThis & { __ideaClipExtract?: () => ExtractedPage }).__ideaClipExtract;
      if (!extract) throw new Error('正文模块未加载，请刷新网页后重试。');
      return extract();
    } });
    const after = await chrome.tabs.get(tab.id);
    if (!result?.result || result.result.sourceUrl !== tab.url || after.url !== tab.url) throw new Error('网页在采集期间发生跳转，本次结果未使用，请回到目标网页重新提取。');
    page = result.result;
  } catch (e) {
    const raw = e instanceof Error ? e.message : '页面采集失败。';
    const reason = /permission|cannot access|cannot be scripted|extensions gallery/i.test(raw) ? '没有读取权限或此页面受浏览器限制。请在目标网页重新点击插件图标；不会绕过访问限制。' : raw;
    page = emptyPage(tab?.url ?? '', tab?.title ?? '', reason);
  }
  if(page.platform==='x'&&page.links.some(l=>tcoUrl(l.url))){
    const repositories=await resolveBrowserShortLinks(page.links);page=withResolvedProjects(page,repositories);
    if(tab?.id&&(await chrome.tabs.get(tab.id)).url!==tab.url)throw Error('短链核实时原网页已跳转，未保存本次采集，请重新提取。');
  }
  const id = await storeExtraction(page, tab?.id ?? null);
  if (draftId) await stageCapture(draftId, id);
  try {
    if (draftId) await showNoteEditor(draftId, editorTabId);
    else await chrome.tabs.create({ url: chrome.runtime.getURL(`collection.html?id=${encodeURIComponent(id)}`) });
  }
  catch { throw new Error('采集草稿已保存在本地，但预览打开失败。请重新点击插件中的“最近采集”。'); }
  return id;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'IC_COLLECT_START' || sender.id !== chrome.runtime.id) return;
  const fromPopup = sender.url?.split('?')[0] === chrome.runtime.getURL('popup.html');
  const fromEditor = sender.url?.startsWith(chrome.runtime.getURL('note.html')) && typeof message.draftId === 'string';
  if (!fromPopup && !fromEditor) return;
  if (collecting) { respond({ ok: false, error: '正在提取网页，请稍候。' }); return; }
  collecting = true;
  void collectActivePage(fromEditor ? message.draftId : undefined, sender.tab?.id ?? null).then(id => respond({ ok: true, id })).catch(e => respond({ ok: false, error: e instanceof Error ? e.message : '采集失败，请重试。' })).finally(() => { collecting = false; });
  return true;
});

const resolving=new Map<string,Promise<void>>();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message?.type!=='IC_RESOLVE_CAPTURE'||sender.id!==chrome.runtime.id||typeof message.id!=='string')return;
 const own=chrome.runtime.getURL('collection.html');
 if(!sender.url||sender.url.split('?')[0]!==own)return;
 const requested=new URL(sender.url).searchParams.get('id');if(requested&&requested!==message.id)return;
 let work=resolving.get(message.id);
 if(!work){work=(async()=>{
  if(!requested&&(await db.contentCaptures.orderBy('updatedAt').last())?.id!==message.id)return;
  const previous=await db.contentCaptures.get(message.id);if(!previous||previous.platform!=='x')return;
  const repositories=await resolveBrowserShortLinks(previous.links);if(!repositories.length)return;
  await db.transaction('rw',db.contentCaptures,async()=>{
   const current=await db.contentCaptures.get(message.id);if(!current||current.sourceUrl!==previous.sourceUrl||JSON.stringify(current.links)!==JSON.stringify(previous.links))return;
   const next=withResolvedProjects(current,repositories);await db.contentCaptures.update(current.id,{links:next.links,githubLinks:next.githubLinks,warnings:next.warnings,updatedAt:Date.now()});
  });
 })().finally(()=>resolving.delete(message.id));resolving.set(message.id,work);}
 void work.then(()=>respond({ok:true})).catch(()=>respond({ok:false}));return true;
});
