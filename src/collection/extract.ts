import { Readability } from '@mozilla/readability';
import { cleanText, emptyPage, githubProjects, httpUrl, MAX_IMAGES, MAX_LINKS, MAX_TEXT, sourcePlatform, type ExtractedPage, type PageImage, type PageLink } from './model';

const noise = 'script,style,noscript,template,nav,aside,footer,form,button,[role="navigation"],[role="complementary"],[hidden],[aria-hidden="true"],#comments,.comments,.comment-list,.related,.recommendations,.advertisement,[data-testid*="recommend"],#ideaclip-region-selector';

function textOf(root: Element): string {
  const walker = root.ownerDocument.createTreeWalker(root, 5);
  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) parts.push(node.textContent ?? '');
    else if (/^(P|DIV|SECTION|ARTICLE|LI|H[1-6]|PRE|BLOCKQUOTE|BR|TR)$/.test((node as Element).tagName)) parts.push('\n');
  }
  return cleanText(parts.join(''));
}
function visibleClone(root: Element): Element | null {
  const view = root.ownerDocument.defaultView;
  for (let ancestor: Element | null = root; ancestor; ancestor = ancestor.parentElement) {
    const style = view?.getComputedStyle(ancestor);
    if (ancestor.matches('[hidden],[aria-hidden="true"],details:not([open]),input,textarea,select,[contenteditable]:not([contenteditable="false"])') || style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') return null;
  }
  const clone = root.cloneNode(true) as Element;
  const originals = [root, ...root.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  originals.forEach((element, index) => {
    const style = view?.getComputedStyle(element);
    const hidden = element.matches('[hidden],[aria-hidden="true"],input,textarea,select,[contenteditable]:not([contenteditable="false"])') || style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0';
    if (hidden) copies[index].remove();
  });
  if (!clone.parentNode && copies[0].matches('[hidden],[aria-hidden="true"]')) return null;
  const rootStyle = view?.getComputedStyle(root);
  if (rootStyle?.display === 'none' || rootStyle?.visibility === 'hidden') return null;
  clone.querySelectorAll(noise).forEach(node => node.remove());
  // Closed details and collapsed/hidden DOM are not used to bypass access restrictions.
  clone.querySelectorAll('details:not([open])').forEach(node => { const summary = node.querySelector('summary'); node.replaceChildren(...(summary ? [summary] : [])); });
  return clone;
}
function metadata(doc: Document, ...names: string[]) {
  for (const name of names) {
    const value = doc.querySelector(`meta[name="${name}"],meta[property="${name}"]`)?.getAttribute('content');
    if (value?.trim()) return cleanText(value).slice(0, 1000);
  }
  return null;
}
function safeLinks(root: Element, sourceUrl: string): PageLink[] {
  const links = new Map<string, PageLink>();
  for (const node of root.querySelectorAll('a[href]')) {
    const url = httpUrl(node.getAttribute('data-expanded-url') || node.getAttribute('href'), sourceUrl);
    if (!url || url.split('#')[0] === sourceUrl.split('#')[0]) continue;
    if (!links.has(url)) links.set(url, { url, text: cleanText(node.textContent ?? '').slice(0, 500) });
  }
  return [...links.values()];
}
function safeImages(root: Element, sourceUrl: string): PageImage[] {
  const images = new Map<string, PageImage>();
  for (const node of root.querySelectorAll('img,video[poster]')) {
    if (node.closest('[data-testid="Tweet-User-Avatar"],[data-testid="UserAvatar-Container"]')) continue;
    const isVideo = node.tagName === 'VIDEO';
    const url = httpUrl(isVideo ? node.getAttribute('poster') : node.getAttribute('data-src') || node.getAttribute('src'), sourceUrl);
    if (!url || /\/profile_images\//.test(url)) continue;
    const description = cleanText(node.getAttribute('alt') || node.getAttribute('aria-label') || node.closest('figure')?.querySelector('figcaption')?.textContent || '');
    images.set(url, { url, description: description.slice(0, 2000), kind: isVideo || node.closest('[data-testid="videoPlayer"]') ? 'video-cover' : 'image' });
  }
  return [...images.values()];
}

export function extractFromDocument(doc: Document, originalUrl: string): ExtractedPage {
  const page = emptyPage(originalUrl, cleanText(doc.title).slice(0, 1000), ''); page.warnings = [];
  if (!page.sourceUrl) return emptyPage('', page.title, '此页面不是可采集的 HTTP / HTTPS 网页。');
  const url = new URL(page.sourceUrl);
  if (!doc.body || doc.querySelectorAll('*').length > 50_000) return emptyPage(page.sourceUrl, page.title, '页面未加载完成或 DOM 过大，未自动采集。');
  page.siteName = metadata(doc, 'og:site_name') || url.hostname;
  let root: Element | null = null;
  let linkRoot: Element | null = null;
  if (page.platform === 'x') {
    const postId = url.pathname.match(/\/status\/(\d+)/)?.[1];
    if (!postId) return emptyPage(page.sourceUrl, page.title, '请打开具体 X 帖子的原始链接后再提取。');
    const post = [...doc.querySelectorAll('article')].find(article => [...article.querySelectorAll('a[href]')].some(anchor => {
      const href = httpUrl(anchor.getAttribute('href'), page.sourceUrl);
      if (!href) return false;
      const ownTime = anchor.querySelector('time');
      return sourcePlatform(href) === 'x' && new URL(href).pathname.match(/\/status\/(\d+)/)?.[1] === postId && ownTime?.closest('article') === article && !anchor.closest('[data-testid="tweetText"],[data-testid="quoteTweet"]') && !anchor.parentElement?.closest('[role="link"]');
    }));
    if (!post) return emptyPage(page.sourceUrl, page.title, '未找到与当前 URL 帖子 ID 匹配的主帖。页面可能未加载、需登录、不可访问，或 DOM 已变化；没有使用推荐帖代替。');
    const clone = visibleClone(post);
    if (!clone) return emptyPage(page.sourceUrl, page.title, '主帖内容当前不可见，请手动粘贴可读取内容。');
    clone.querySelectorAll('[data-testid="quoteTweet"],article,[role="link"]').forEach(node => {
      if (node.matches('[role="link"]') && !node.querySelector('[data-testid="tweetText"],[data-testid="User-Name"]')) return;
      node.remove();
    });
    clone.querySelectorAll('[data-testid="tweet-text-show-more-link"]').forEach(node => node.remove());
    const rich = clone.querySelector('[data-testid="twitterArticleRichTextView"],[data-testid="longformRichTextComponent"]');
    root = rich || clone.querySelector('[data-testid="tweetText"]');
    const permalink = [...post.querySelectorAll('a[href]')].find(anchor => anchor.querySelector('time') && new URL(httpUrl(anchor.getAttribute('href'), page.sourceUrl) ?? page.sourceUrl).pathname.match(/\/status\/(\d+)/)?.[1] === postId);
    page.author = cleanText(post.querySelector('[data-testid="User-Name"]')?.textContent ?? '') || null;
    page.publishedAt = permalink?.querySelector('time')?.getAttribute('datetime') || null;
    page.images = safeImages(clone, page.sourceUrl);
    linkRoot = root;
    const card = clone.querySelector('[data-testid="card.wrapper"]');
    if (card) page.links.push(...safeLinks(card, page.sourceUrl));
    page.status = 'partial';
    page.warnings.push('仅采集当前主帖已加载、已展开且可见的内容，不包含线程后续帖、引用帖、评论或登录后才能读取的内容。');
    if (post.querySelector('[data-testid="tweet-text-show-more-link"]') || [...post.querySelectorAll('button,a')].some(n => /^(Show more|显示更多|展开|查看更多)$/i.test(cleanText(n.textContent ?? '')))) page.warnings.push('检测到展开入口，正文可能被截断。请在原页面手动展开后重新提取。');
    if (!root) page.warnings.push('未识别到主帖正文节点，可能是纯媒体帖或页面 DOM 已变化，请手动核对。');
  } else if (page.platform === 'github') {
    const parts = url.pathname.split('/').filter(Boolean);
    const repo = githubProjects([page.sourceUrl])[0];
    if (!repo) return emptyPage(page.sourceUrl, page.title, '此页面未识别为 GitHub 仓库，请打开具体仓库页面。');
    page.title = `${parts[0]}/${parts[1]}`; page.author = parts[0];
    page.publishedAt = metadata(doc, 'article:published_time');
    const readme = doc.querySelector('#readme article,article.markdown-body,[data-testid="readme"] .markdown-body,#readme .markdown-body');
    root = readme ? visibleClone(readme) : null; linkRoot = root;
    if (!root) {
      const description = doc.querySelector('[itemprop="about"],.f4.my-3');
      root = description ? visibleClone(description) : null; page.status = 'partial';
      page.warnings.push('没有识别到可读取的 README，仅尝试保留页面可见的仓库简介。');
    }
    page.githubLinks.push(repo);
    page.warnings.push('作者字段记录仓库所有者；未推断 README 作者或仓库创建时间。');
  } else if (page.platform === 'wechat') {
    const content = doc.querySelector('#js_content'); root = content ? visibleClone(content) : null; linkRoot = root;
    page.title = cleanText(doc.querySelector('#activity-name')?.textContent ?? '') || page.title;
    page.author = cleanText(doc.querySelector('#js_author_name,.rich_media_meta_text,#js_name')?.textContent ?? '') || metadata(doc, 'author');
    page.publishedAt = cleanText(doc.querySelector('#publish_time')?.textContent ?? '') || metadata(doc, 'article:published_time');
    if (!root) page.warnings.push('未识别到可读取的微信公众号正文；可能受访问限制或页面结构已变化。');
  } else {
    const cleanBody = visibleClone(doc.body);
    if (cleanBody) {
      const inert = doc.implementation.createHTMLDocument(doc.title); inert.body.replaceWith(cleanBody);
      const base = inert.createElement('base'); base.href = page.sourceUrl; inert.head.append(base);
      try {
        const readable = new Readability<Element>(inert, { charThreshold: 80, maxElemsToParse: 50_000, serializer: node => node as Element, disableJSONLD: true }).parse();
        root = readable?.content ?? null;
        page.author = metadata(doc, 'author', 'article:author') || cleanText(readable?.byline ?? '') || null;
      } catch { page.warnings.push('通用正文识别失败，已尝试语义化正文节点。'); }
    }
    const semantic = doc.querySelector('article,main,[role="main"],.entry-content,.post-content');
    if (!root || !textOf(root)) root = semantic ? visibleClone(semantic) : null;
    if (root && (semantic || textOf(root).length >= 80)) {
      page.platform = 'article'; linkRoot = root;
    } else root = null;
    page.author ||= metadata(doc, 'author', 'article:author');
    page.publishedAt = metadata(doc, 'article:published_time', 'date', 'pubdate') || doc.querySelector('article time[datetime],main time[datetime]')?.getAttribute('datetime') || null;
  }
  page.text = root ? textOf(root) : '';
  if (root && page.platform !== 'x') page.images = safeImages(root, page.sourceUrl);
  if (linkRoot) page.links.push(...safeLinks(linkRoot, page.sourceUrl));
  page.links = [...new Map(page.links.map(link => [link.url, link])).values()];
  page.githubLinks = githubProjects([...page.githubLinks, ...page.links.map(link => link.url), ...(page.text.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/g) ?? [])]);
  if (page.text.length > MAX_TEXT) {
    page.text = page.text.slice(0, MAX_TEXT).replace(/[\uD800-\uDBFF]$/, ''); page.status = 'partial';
    page.warnings.push(`正文超过 ${MAX_TEXT} 字符，已截断，请手动核对。`);
  }
  if (page.links.length > MAX_LINKS || page.images.length > MAX_IMAGES) { page.status = 'partial'; page.warnings.push('链接或图片数量超过上限，列表已截断。'); }
  page.links = page.links.slice(0, MAX_LINKS); page.images = page.images.slice(0, MAX_IMAGES);
  if (!page.text) { page.status = 'unavailable'; page.warnings.push('未提取到正文，可手动粘贴。没有使用导航栏、推荐内容或评论充数。'); }
  else if (page.status !== 'partial') page.status = 'readable';
  if (!page.author) page.warnings.push('作者未识别。');
  if (!page.publishedAt) page.warnings.push('发布时间未识别。');
  page.warnings.push('仅采集当前已加载、可读取的 DOM；未验证全文完整性，不会自动展开、滚动抓取或请求私有接口。');
  return page;
}
