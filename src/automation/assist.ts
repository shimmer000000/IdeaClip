import { candidateKind, sensitivePage } from './model';

// Runs only in explicitly registered main-frame hosts. No AI, history API, storage or auto-save.
if (window === window.top && !document.querySelector('[data-ideaclip-assist]')) {
  let enabled = false; let host: HTMLElement | null = null; let dismissed = false; let checks = 0; let timer: ReturnType<typeof setTimeout> | null = null;
  const sensitiveDOM = () => sensitivePage(location.href) || !!document.querySelector('input[type="password"],input[autocomplete^="cc-"],input[autocomplete="one-time-code"]');
  const remove = () => { host?.remove(); host = null; };
  async function refresh() {
    try { enabled = !!(await chrome.runtime.sendMessage({ type: 'IC_ASSIST_POLICY' }))?.enabled; } catch { enabled = false; }
    if (!enabled || sensitiveDOM()) { remove(); return; } inspect();
  }
  function inspect() {
    if (!enabled || dismissed || sensitiveDOM()) { remove(); return; }
    if (host || checks++ >= 10) return;
    const title = document.title.slice(0, 1000);
    const excerpt = (document.querySelector('meta[name="description"]')?.getAttribute('content')?.slice(0, 1000) ?? '') + Array.from(document.querySelectorAll('h1,h2,main p,article p,[data-testid="tweetText"]')).slice(0, 12).map(node => node.textContent?.slice(0, 500) ?? '').join('\n');
    const kind = candidateKind(location.href, title, excerpt); if (!kind) return;
    host = document.createElement('div'); host.dataset.ideaclipAssist = 'local'; const shadow = host.attachShadow({ mode: 'closed' });
    const box = document.createElement('aside'); box.setAttribute('role', 'note');
    box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483646;width:280px;padding:16px;border:1px solid #c8d4c0;border-radius:12px;background:#f8faf5;color:#243b2b;box-shadow:0 6px 24px #0002;font:14px/1.6 system-ui;';
    const heading = document.createElement('strong'); heading.textContent = `IdeaClip · 可研究的${kind}`;
    const detail = document.createElement('p'); detail.textContent = '仅本地规则建议。不会自动保存或上传；进入编辑页后仍需确认保存。';
    const collect = document.createElement('button'); collect.textContent = '确认收藏灵感'; collect.style.cssText = 'padding:7px 12px;background:#315b43;color:white;border:0;border-radius:7px;cursor:pointer;';
    collect.addEventListener('click', event => { if (!event.isTrusted || sensitiveDOM()) return; void (async () => { const result = await chrome.runtime.sendMessage({ type: 'IC_ASSIST_OPEN', url: location.href, title: document.title.slice(0, 1000) }); if (result?.ok) { dismissed = true; remove(); } else { detail.textContent = '当前授权或页面状态已改变，请从插件收藏并核对。'; } })().catch(() => { detail.textContent = '无法打开编辑页，请点击插件图标收藏。'; }); });
    const close = document.createElement('button'); close.textContent = '忽略'; close.style.cssText = 'margin-left:10px;padding:7px 12px;background:transparent;border:0;color:#315b43;cursor:pointer;'; close.addEventListener('click', () => { dismissed = true; remove(); });
    box.append(heading, detail, collect, close); shadow.append(box); document.documentElement.append(host);
  }
  const observer = new MutationObserver(() => { if (sensitiveDOM()) { remove(); return; } if (!timer) timer = setTimeout(() => { timer = null; inspect(); }, 700); });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['type', 'autocomplete'] });
  const port = chrome.runtime.connect({ name: 'IC_LOCAL_ASSIST' }); port.onMessage.addListener(() => { void refresh(); }); port.onDisconnect.addListener(() => { enabled = false; remove(); });
  window.addEventListener('pagehide', () => { observer.disconnect(); if (timer) clearTimeout(timer); port.disconnect(); remove(); }, { once: true });
  void refresh();
}
