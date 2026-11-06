import { emptyPage, type ExtractedPage } from './model';
import { storeExtraction } from './storage';

let collecting = false;
export async function collectActivePage() {
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
  const id = await storeExtraction(page, tab?.id ?? null);
  try { await chrome.tabs.create({ url: chrome.runtime.getURL(`collection.html?id=${encodeURIComponent(id)}`) }); }
  catch { throw new Error('采集草稿已保存在本地，但预览打开失败。请重新点击插件中的“最近采集”。'); }
  return id;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'IC_COLLECT_START' || sender.id !== chrome.runtime.id || sender.url?.split('?')[0] !== chrome.runtime.getURL('popup.html')) return;
  if (collecting) { respond({ ok: false, error: '正在提取网页，请稍候。' }); return; }
  collecting = true;
  void collectActivePage().then(id => respond({ ok: true, id })).catch(e => respond({ ok: false, error: e instanceof Error ? e.message : '采集失败，请重试。' })).finally(() => { collecting = false; });
  return true;
});
