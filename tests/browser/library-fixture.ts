import type { Page } from '@playwright/test';
import { noteDefaults } from '../../src/inspiration/model';

export async function seedLibrary(page: Page, count = 60, large = false) {
  await page.evaluate(async ({ count, large, defaults }) => {
    const connection = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('ideaclip'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    if (large) {
      const data = ctx.createImageData(canvas.width, canvas.height); let seed = 123456;
      for (let index = 0; index < data.data.length; index += 4) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; data.data[index] = seed & 255; data.data[index + 1] = seed >>> 8 & 255; data.data[index + 2] = seed >>> 16 & 255; data.data[index + 3] = 255; }
      ctx.putImageData(data, 0, 0);
    } else { ctx.fillStyle = '#315b43'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    const first = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/webp', 0.8));
    ctx.fillStyle = '#b15b45'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const second = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/webp', 0.8));
    const tx = connection.transaction(['notes', 'noteCatalog', 'noteSearch', 'libraryState', 'screenshots', 'contentCaptures', 'noteDrafts', 'draftCatalog'], 'readwrite');
    const completed = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    const normalize = (value: string) => value.normalize('NFKC').toLowerCase();
    for (let index = 0; index < 48; index++) tx.objectStore('screenshots').put({ id: `image-${index + 1}`, blob: index % 2 ? second : first, kind: 'visible', width: 1280, height: 800, originalBytes: first.size, sourceTabId: 0, sourceUrl: 'https://fixture.example', sourceTitle: `模拟截图 ${index + 1}`, createdAt: index });
    for (let index = 0; index < count; index++) {
      const id = `n-${String(index).padStart(5, '0')}`;
      const url = large ? `https://example.com/${index}` : index % 2 ? `https://x.com/fixture/status/${index}` : `https://github.com/fixture/project-${index}`;
      const createdAt = large ? Date.now() - (count - index) * 60000 : new Date(2026, 10, 1 + index % 6, 12).getTime() + index;
      const note = { ...defaults, id, title: `${!large && (index === 1 || index === 2) ? '批量候选' : '灵感'} ${String(index).padStart(5, '0')}`, url, platform: large ? 'web' : index % 2 ? 'x' : 'github', author: index % 2 ? '作者甲' : '作者乙', body: `感悟${index}：观察用户需求。` + (index === 7 ? '长'.repeat(300) + '尾部感悟词' : ''), content: large ? '产品研究与需求验证。'.repeat(220) + (index === 7777 ? '独特研究词' : '') : `正文${index}：有价值的网页内容。`, tags: [index % 3 ? '商业' : '设计'], category: index % 2 ? '产品' : '研究', favorite: index % 4 === 0, saveState: large || index % 10 ? 'saved' : 'draft', status: 'inbox', screenshotIds: (large && index === 7777) || (!large && index === 7) ? [] : index === 5 ? ['image-1', 'image-2'] : [`image-${index % 48 + 1}`], captureIds: [], researchQuestions: '下一步如何验证？', createdAt, updatedAt: createdAt, revision: 1, sourcePageUrl: url };
      tx.objectStore('notes').put(note);
      tx.objectStore('noteCatalog').put({ id, title: note.title, url, site: new URL(url).hostname, platform: note.platform, author: note.author, category: note.category, tags: note.tags, favorite: note.favorite, saveState: note.saveState, createdAt, updatedAt: createdAt, bodySummary: note.body.slice(0, 240), screenshotIds: note.screenshotIds });
      tx.objectStore('noteSearch').put({ id, title: normalize(note.title), body: normalize(note.body), content: normalize(note.content), tags: normalize(note.tags.join('\n')), author: normalize(note.author) });
      if (!large && index === 2) {
        tx.objectStore('noteDrafts').put({ id, entryKey: `note:${id}`, input: { title: note.title, url, platform: note.platform, author: note.author, publishedAt: null, content: note.content, body: '编辑中，不能覆盖', researchQuestions: '', category: note.category, tagsText: note.tags.join(', '), screenshotIds: note.screenshotIds, captureIds: [], favorite: note.favorite, status: 'inbox' }, baseRevision: 1, sourceTabId: null, sourcePageUrl: url, pendingCaptureId: null, hasChanges: true, createdAt, updatedAt: Date.now() });
        tx.objectStore('draftCatalog').put({ id, title: note.title, updatedAt: Date.now(), pending: 1 });
      }
    }
    tx.objectStore('contentCaptures').put({ id: 'fixture-capture', noteId: 'n-00001', screenshotIds: ['image-1'], sourceUrl: 'https://fixture.example', originalUrl: 'https://fixture.example', title: '原始采集', text: '采集原文', platform: 'web', siteName: 'fixture.example', author: null, publishedAt: null, collectedAt: 1, updatedAt: 1, status: 'readable', warnings: [], images: [], links: [], githubLinks: [], sourceTabId: null, textOrigin: 'extracted' });
    tx.objectStore('libraryState').put({ id: 'notes', revision: 1 }); await completed; connection.close();
  }, { count, large, defaults: noteDefaults() });
}
