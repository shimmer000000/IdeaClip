import { db } from '../storage';
import { cleanText, githubProjects, httpUrl, MAX_IMAGES, MAX_LINKS, MAX_TEXT, type ContentCapture, type ExtractedPage } from './model';

export async function storeExtraction(page: ExtractedPage, sourceTabId: number | null, database = db) {
  const record: ContentCapture = { ...page, originalUrl: page.sourceUrl, id: crypto.randomUUID(), sourceTabId, screenshotIds: [], noteId: null, updatedAt: Date.now(), textOrigin: page.text ? 'extracted' : 'empty' };
  try { await database.contentCaptures.add(record); }
  catch { throw new Error('采集草稿保存失败，可能是空间不足或本地数据库不可用。已有笔记和截图不会被删除。'); }
  return record.id;
}

export type CaptureEdits = Pick<ContentCapture, 'title' | 'sourceUrl' | 'author' | 'publishedAt' | 'text' | 'links' | 'images' | 'screenshotIds'>;
export async function saveCaptureEdits(id: string, edits: CaptureEdits, database = db) {
  const sourceUrl = httpUrl(edits.sourceUrl);
  if (!sourceUrl) throw new Error('请填写有效的 HTTP / HTTPS 原始网址。');
  if (!edits.title.trim() || edits.title.length > 1000) throw new Error('请填写标题，最多 1000 字符。');
  if (edits.text.length > MAX_TEXT) throw new Error(`正文最多 ${MAX_TEXT} 字符，请分段保存。`);
  if (edits.images.length > MAX_IMAGES || edits.links.length > MAX_LINKS) throw new Error('图片或链接数量超过上限，请减少后保存。');
  if (edits.links.some(link => !httpUrl(link.url)) || edits.images.some(image => !httpUrl(image.url))) throw new Error('图片及链接仅允许有效的 HTTP / HTTPS URL，不能使用脚本、data 或本地文件地址。');
  try {
    await database.transaction('rw', database.contentCaptures, database.screenshots, async () => {
      const previous = await database.contentCaptures.get(id);
      if (!previous) throw new Error('采集草稿不存在，请重新提取。');
      const screenshotIds = [...new Set(edits.screenshotIds)];
      for (const screenshotId of screenshotIds) if (!await database.screenshots.get(screenshotId)) throw new Error('所选截图已不存在，请取消选择后重试。');
      await database.contentCaptures.update(id, {
        title: cleanText(edits.title), sourceUrl, author: cleanText(edits.author ?? '').slice(0, 1000) || null, publishedAt: cleanText(edits.publishedAt ?? '').slice(0, 1000) || null,
        text: edits.text, links: edits.links.map(link => ({ url: httpUrl(link.url)!, text: cleanText(link.text).slice(0, 500) })),
        images: edits.images.map(image => ({ url: httpUrl(image.url)!, description: cleanText(image.description).slice(0, 2000), kind: image.kind === 'video-cover' ? 'video-cover' : 'image' })),
        screenshotIds, githubLinks: githubProjects([...edits.links.map(link => link.url), ...(edits.text.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/g) ?? []), ...(previous.platform === 'github' ? [sourceUrl] : [])]),
        updatedAt: Date.now(), textOrigin: !edits.text ? 'empty' : edits.text === previous.text || previous.textOrigin === 'manual' ? previous.textOrigin : previous.text ? 'edited' : 'manual',
      });
    });
  } catch (e) {
    if (e instanceof Error && /不存在/.test(e.message)) throw e;
    throw new Error('修改保存失败，可能是空间不足或数据库不可用。输入仍保留在页面中，请重试。');
  }
}
