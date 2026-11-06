import { assessQuality, paragraphMap } from '../src/collection/quality';
import { emptyPage, type ContentCapture } from '../src/collection/model';
export const qualityText = Array.from({ length: 4 }, (_, i) => `产品正文段落 ${i}：这是本地模拟的公开产品介绍，研究用户需求、商业模式、付费意愿及获客方式。先访谈目标用户，再做小规模验证，成本与利润属于待验证假设。`).join('\n\n');
export function qualityCapture(url: string, text = qualityText): ContentCapture {
  return { ...emptyPage(url, '模拟公开正文', ''), id: crypto.randomUUID(), originalUrl: url, sourceTabId: null, screenshotIds: [], noteId: null, updatedAt: Date.now(), textOrigin: 'extracted', text, status: 'readable', warnings: [], quality: assessQuality({ text, url, method: 'readability' }), provenance: paragraphMap(text, url, 'page') };
}
