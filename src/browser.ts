export async function currentPage(): Promise<{ title: string; url: string } | null> {
  if (!globalThis.chrome?.tabs?.query) return null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) return null;
  return { title: tab.title ?? '', url: tab.url };
}
export async function openPage(page: 'notes' | 'settings') {
  if (globalThis.chrome?.runtime?.id) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`${page}.html`) });
  } else window.location.href = `${page}.html`;
}
