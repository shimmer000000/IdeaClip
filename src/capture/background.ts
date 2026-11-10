import { db, saveScreenshot, type Screenshot } from '../storage';
import { readViewport, sameViewport, type Rect, type Viewport } from './geometry';
import { compressCapture } from './image';
import { installSelector } from './selector';
import {longPage} from './long-page';
import {stitchLongPage} from './long';
import {validateCaptureRange,type CaptureRange} from './range';
import {captureBackendInfo} from './request';
import '../collection/background';
import '../inspiration/background';
import '../automation/background';
import { activateDraftSource, showNoteEditor } from '../inspiration/browser';
import { storeDraftScreenshot } from '../inspiration/repository';

let busy = false;
let lastCaptureAt = 0;
const errorText = (e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  if (/MAX_CAPTURE|quota|too many/i.test(message)) return '截图过于频繁，请等待一秒后重试。';
  if (/cannot access|permission|cannot be scripted|extensions gallery|not allowed|No tab/i.test(message)) return '无法访问此页面。请切回普通网页，点击 IdeaClip 图标重新授权后截图。浏览器内部页和扩展商店不支持截图。';
  return message;
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url) || /^(https?:\/\/)(chromewebstore.google.com|chrome.google.com\/webstore|microsoftedge.microsoft.com\/addons)(\/|$)/i.test(tab.url)) throw new Error('此页面不支持截图。请在普通 HTTP / HTTPS 网页中点击插件图标。');
  return tab as chrome.tabs.Tab & { id: number; url: string };
}
async function viewportOf(tabId: number) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: readViewport });
  if (!result?.result) throw new Error('无法读取网页尺寸，请刷新网页后重新点击插件。');
  return result.result;
}
async function showPreview(id: string, previewTabId: number | null, draftId: string | null) {
  if (draftId) { await showNoteEditor(draftId, previewTabId); return; }
  const url = chrome.runtime.getURL(`capture.html?id=${encodeURIComponent(id)}`);
  if (previewTabId !== null) {
    try {
      const existing = await chrome.tabs.get(previewTabId);
      if (existing.url?.startsWith(chrome.runtime.getURL('capture.html'))) {
        await chrome.tabs.update(previewTabId, { url, active: true }); return;
      }
    } catch { /* The user closed the preview: open another one. */ }
  }
  await chrome.tabs.create({ url });
}
async function capture(tab: chrome.tabs.Tab & { id: number; url: string }, previewTabId: number | null, selected?: { rect: Rect; viewport: Viewport }, draftId: string | null = null) {
  const before = await viewportOf(tab.id);
  if (selected && !sameViewport(selected.viewport, before)) throw new Error('页面位置、缩放或尺寸已改变，请重新选择区域。');
  if (before.scale !== 1) throw new Error('请先退出触控捏合缩放，再截图。');
  let changed = false;
  const switched = () => { changed = true; };
  chrome.tabs.onActivated.addListener(switched);
  try {
    const active = await activeTab();
    if (active.id !== tab.id || active.url !== tab.url) throw new Error('当前标签页已改变，请重新截图。');
    const wait = 600 - (Date.now() - lastCaptureAt);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    if (changed) throw new Error('当前标签页已改变，请重新截图。');
    lastCaptureAt = Date.now();
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const after = await viewportOf(tab.id);
    const nowActive = await activeTab();
    if (changed || nowActive.id !== tab.id || nowActive.url !== tab.url || !sameViewport(before, after)) throw new Error('截图过程中页面发生变化，请保持页面位置后重试。');
    const image = await compressCapture(dataUrl, before, selected?.rect);
    const screenshot: Screenshot = { id: crypto.randomUUID(), blob: image.blob, kind: selected ? 'region' : 'visible', width: image.width, height: image.height, originalBytes: image.originalBytes, sourceTabId: tab.id, sourceUrl: tab.url, sourceTitle: tab.title ?? '', createdAt: Date.now() };
    if (draftId) await storeDraftScreenshot(draftId, screenshot);
    else await saveScreenshot(screenshot);
    try { await showPreview(screenshot.id, previewTabId, draftId); }
    catch { throw new Error('截图已保存，但无法打开预览。请重新点击插件中的“最近截图”。'); }
    return screenshot.id;
  } finally { chrome.tabs.onActivated.removeListener(switched); }
}

async function captureLong(tab:chrome.tabs.Tab&{id:number;url:string},previewTabId:number|null,draftId:string|null,segmented=false,previous?:CaptureRange){
 let changed=false;const switched=()=>{changed=true;};chrome.tabs.onActivated.addListener(switched);
 const assertActive=async()=>{const current=await activeTab();if(changed||current.id!==tab.id||current.url!==tab.url)throw new Error('长截图期间切换了页面，已停止；请在原网页重新截图。');};
 try{
  const image=await stitchLongPage(async(action,id,y)=>{const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:longPage,args:[action,id,y??0]});if(!result?.result)throw new Error('长截图控制已中断，请回到网页重新授权。');return result.result;},async()=>{const wait=600-(Date.now()-lastCaptureAt);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));await assertActive();lastCaptureAt=Date.now();return chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});},assertActive,segmented,previous);
  const screenshot:Screenshot={id:crypto.randomUUID(),...image,kind:segmented?'segment':'full',sourceTabId:tab.id,sourceUrl:tab.url,sourceTitle:tab.title??'',createdAt:Date.now()};
  if(draftId)await storeDraftScreenshot(draftId,screenshot);else await saveScreenshot(screenshot);
  try{await showPreview(screenshot.id,previewTabId,draftId);}catch{throw new Error('长图已保存，请点击插件中的“最近截图”查看。');}return screenshot.id;
 }finally{chrome.tabs.onActivated.removeListener(switched);}
}

async function handle(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
  if (busy) throw new Error('正在处理另一张截图，请稍候再试。');
  busy = true;
  try {
    if (message.type === 'IC_CAPTURE_REGION') {
      if (!sender.tab?.id || sender.frameId !== 0) throw new Error('无效的截图来源。');
      const tab = await activeTab();
      if (tab.id !== sender.tab.id) throw new Error('选区所在页面已不是当前页面，请重新截图。');
      if (!message.viewport || !message.rect) throw new Error('区域信息不完整，请重新选择。');
      return await capture(tab, typeof message.previewTabId === 'number' ? message.previewTabId : null, { rect: message.rect as Rect, viewport: message.viewport as Viewport }, typeof message.draftId === 'string' ? message.draftId : null);
    }
    const draftId = typeof message.draftId === 'string' ? message.draftId : null;
    if (!sender.url?.startsWith(chrome.runtime.getURL('')) || sender.tab && !sender.url.startsWith(chrome.runtime.getURL('capture.html')) && !(draftId && sender.url.startsWith(chrome.runtime.getURL('note.html')))) throw new Error('无效的截图请求。');
    if (message.kind !== 'visible' && message.kind !== 'region' && message.kind !== 'full' && message.kind !== 'segment') throw new Error('无效的截图方式。');
    let previousRange:CaptureRange|undefined;
    if(message.nextSegment&&(message.kind!=='segment'||typeof message.screenshotId!=='string'||draftId))throw new Error('缺少可继续的分段截图。');
    let previewTabId: number | null = null;
    if (draftId) {
      await activateDraftSource(draftId); previewTabId = sender.tab?.id ?? null;
    } else if (typeof message.screenshotId === 'string') {
      const previous = await db.screenshots.get(message.screenshotId);
      if (!previous) throw new Error('找不到原截图，请从网页重新打开插件。');
      if(message.nextSegment){if(previous.kind!=='segment')throw new Error('此图片不是分段长图。');previousRange=validateCaptureRange(previous.captureRange);if(previousRange.endY>=previousRange.pageHeight)throw new Error('已截到页面底部，无需继续。');}
      const source = await chrome.tabs.get(previous.sourceTabId).catch(() => { throw new Error('原网页已关闭，请在目标网页重新打开插件。'); });
      if (source.url !== previous.sourceUrl) throw new Error('原网页已关闭或跳转，请在目标网页重新打开插件。');
      await chrome.windows.update(source.windowId, { focused: true });
      await chrome.tabs.update(previous.sourceTabId, { active: true });
      previewTabId = sender.tab?.id ?? null;
    }
    const tab = await activeTab();
    if(message.kind==='full'||message.kind==='segment')return await captureLong(tab,previewTabId,draftId,message.kind==='segment',previousRange);
    if (message.kind === 'region') {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: installSelector, args: [previewTabId, draftId] });
      return null;
    }
    return await capture(tab, previewTabId, undefined, draftId);
  } finally { busy = false; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if(sender.id===chrome.runtime.id&&sender.url?.startsWith(chrome.runtime.getURL(''))&&message?.type==='IC_CAPTURE_CAPABILITIES'){respond(captureBackendInfo());return;}
  if (sender.id !== chrome.runtime.id || !message || !['IC_CAPTURE_START', 'IC_CAPTURE_REGION'].includes(message.type)) return;
  void handle(message, sender).then(id => respond({ ok: true, id })).catch(e => respond({ ok: false, error: errorText(e) }));
  return true;
});
