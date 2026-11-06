import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => vi.fn().mockResolvedValue('test-draft'));
vi.mock('./storage', () => ({ storeExtraction: store }));
vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn() }, getURL: (path: string) => `chrome-extension://test/${path}` }, tabs: {}, scripting: {} });
const { collectActivePage } = await import('./background');

beforeEach(() => {
  store.mockClear();
  chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com/', title: '示例页面' }]);
  chrome.tabs.get = vi.fn().mockResolvedValue({ id: 1, url: 'https://example.com/' });
  chrome.tabs.create = vi.fn().mockResolvedValue({ id: 2 });
  chrome.scripting.executeScript = vi.fn().mockRejectedValue(new Error('Cannot access contents of url. Extension manifest must request permission'));
});
afterEach(() => vi.restoreAllMocks());
describe('采集权限和页面变化', () => {
  it('权限不足时保存明确失败状态并打开可手动补充的预览', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await collectActivePage();
    expect(store.mock.calls[0][0]).toMatchObject({ status: 'unavailable', text: '' });
    expect(store.mock.calls[0][0].warnings.join(' ')).toContain('权限');
    expect(chrome.tabs.create).toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('内部页面不尝试注入脚本', async () => {
    chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'chrome://extensions/', title: '扩展' }]);
    await collectActivePage();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled(); expect(store.mock.calls[0][0].text).toBe('');
  });
  it('采集时跳转到其他页面则丢弃正文，不串页', async () => {
    chrome.scripting.executeScript = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ result: { sourceUrl: 'https://other.example', text: '不能混入' } }]);
    await collectActivePage();
    expect(store.mock.calls[0][0]).toMatchObject({ status: 'unavailable', text: '' });
    expect(store.mock.calls[0][0].warnings.join(' ')).toContain('跳转');
  });
});
