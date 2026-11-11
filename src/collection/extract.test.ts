import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractFromDocument } from './extract';
import { githubProjects, httpUrl, MAX_TEXT, sourcePlatform } from './model';
import { articleHtml, githubHtml, paragraph, wechatHtml, xHtml } from '../../tests/fixtures/pages';

function documentOf(html: string, url = 'https://article.example/story') { return new JSDOM(html, { url }).window.document; }
describe('正文与来源提取', () => {
  it('普通文章保留正文、作者、时间、链接和图片，过滤导航、广告和评论', () => {
    const doc = documentOf(articleHtml); const before = doc.documentElement.outerHTML;
    const result = extractFromDocument(doc, doc.URL);
    expect(result).toMatchObject({ platform: 'article', author: '测试作者', publishedAt: '2026-11-01T08:00:00Z', siteName: '示例站', sourceUrl: doc.URL, status: 'readable' });
    expect(result.text).toContain(paragraph);
    for (const noise of ['导航噪声', '无关评论', '推荐噪声', '不可见私密内容', 'window.shouldNotRun']) expect(result.text).not.toContain(noise);
    expect(result.images).toContainEqual({ url: 'https://article.example/diagram.png', description: '产品流程图', kind: 'image' });
    expect(result.links.map(link => link.url)).toContain('https://article.example/related-source');
    expect(result.githubLinks).toEqual(['https://github.com/example/idea']);
    expect(doc.documentElement.outerHTML).toBe(before);
  });
  it.each(['2083165441074323937', '2082783291162149077'])('本地模拟 X 帖子 %s 只选择当前 URL 主帖', id => {
    const url = `https://x.com/fixture/status/${id}?s=20`;
    const result = extractFromDocument(documentOf(xHtml(id), url), url);
    expect(result).toMatchObject({ sourceUrl: url, platform: 'x', author: '测试作者 @fixture', publishedAt: '2026-11-02T12:00:00Z', status: 'partial' });
    expect(result.text).toContain('这是当前主帖');
    for (const noise of ['错误的推荐', '引用内容', '无关评论', '显示更多']) expect(result.text).not.toContain(noise);
    expect(result.images).toHaveLength(2);
    expect(result.images[1].kind).toBe('video-cover');
    expect(result.links.map(link => link.url)).toEqual(expect.arrayContaining(['https://github.com/example/project', 'https://example.org/tool']));
    expect(result.warnings.join(' ')).toContain('截断');
  });
  it('重新读取展开后的长帖和 DOM 更新，不使用旧文本', () => {
    const url = 'https://twitter.com/fixture/status/123'; const doc = documentOf(xHtml('123'), url);
    extractFromDocument(doc, url);
    doc.querySelectorAll('[data-testid="tweetText"]')[2].textContent = '展开后的长帖内容。'.repeat(500);
    doc.querySelector('button')?.remove();
    const result = extractFromDocument(doc, url);
    expect(result.text).toContain('展开后的长帖内容。'.repeat(100));
    expect(result.warnings.join(' ')).not.toContain('检测到展开入口');
  });
  it('X 目标缺失、未登录或 DOM 改名时不拿推荐帖顶替', () => {
    const url = 'https://x.com/fixture/status/456';
    const missing = extractFromDocument(documentOf(xHtml('123'), url), url);
    expect(missing.status).toBe('unavailable'); expect(missing.text).toBe('');
    const doc = documentOf(xHtml('456').replaceAll('tweetText', 'changedText'), url);
    expect(extractFromDocument(doc, url).text).toBe('');
  });
  it('已识别主帖中的嵌套长文章正文不会被当作引用帖清除', () => {
    const url = 'https://x.com/fixture/status/456';
    const doc = documentOf(`<article data-testid="tweet"><div data-testid="User-Name">主帖作者</div><a href="/fixture/status/456"><time datetime="2026-11-01">日期</time></a><article><div data-testid="twitterArticleRichTextView"><h1>长文章</h1><p>${paragraph.repeat(3)}</p><a href="https://github.com/example/article">文章项目</a><img src="https://example.org/article.png" alt="文章配图"></div></article><article><div data-testid="User-Name">引用作者</div><a href="/other/status/999"><time>日期</time></a><div data-testid="twitterArticleRichTextView">引用文章不能混入正文</div></article></article>`, url);
    const result = extractFromDocument(doc, url);
    expect(result.text).toContain(paragraph);
    expect(result.text).not.toContain('引用文章不能混入正文');
    expect(result.author).toBe('主帖作者');
    expect(result.githubLinks).toContain('https://github.com/example/article');
    expect(result.images).toContainEqual({ url: 'https://example.org/article.png', description: '文章配图', kind: 'image' });
  });
  it.each(['twitterArticleRichTextView', 'longformRichTextComponent'])('长文章 %s 保留可见正文，仍排除引用、独立嵌套帖和隐藏内容', selector => {
    const url = 'https://x.com/fixture/status/456';
    const doc = documentOf(`<article><div data-testid="User-Name">主帖作者</div><a href="/fixture/status/456"><time>日期</time></a><article data-testid="${selector}"><p>${paragraph}</p><article role="link" data-testid="quoteTweet"><div data-testid="${selector}">不能采集的引用文章<img src="https://example.org/quote.png"></div></article><article><a href="/other/status/999"><time>另一条帖</time></a><div data-testid="${selector}">独立嵌套帖不能混入</div></article><p hidden>不能采集的隐藏正文</p></article></article>`, url);
    const result = extractFromDocument(doc, url);
    expect(result.text).toContain(paragraph);
    expect(result.text).not.toContain('不能采集');
    expect(result.text).not.toContain('独立嵌套帖');
    expect(result.images).toEqual([]);
    doc.querySelector(`[data-testid="${selector}"]`)!.setAttribute('hidden', '');
    expect(extractFromDocument(doc, url).text).toBe('');
  });
  it('X 可见CSS背景图片可记录，透明占位图、隐藏媒体、头像和危险URL不成为新媒体', () => {
    const url = 'https://x.com/fixture/status/456';
    const doc = documentOf(`<style>.painted{background-image:url("https://example.org/visible.png")}</style><article><div data-testid="User-Name">作者</div><a href="/fixture/status/456"><time>日期</time></a><div data-testid="tweetText">${paragraph}</div><div class="painted" aria-label="可见文章配图"><img src="https://example.org/transparent-private.png" style="opacity:0"></div><div style="display:none;background-image:url(https://example.org/hidden.png)">隐藏图片</div><div data-testid="UserAvatar-Container" style="background-image:url(https://example.org/avatar.png)"></div><div style="background-image:url(javascript:alert)"></div></article>`, url);
    const result = extractFromDocument(doc, url);
    expect(result.images).toEqual([{url:'https://example.org/visible.png',description:'可见文章配图',kind:'image'}]);
    expect(doc.querySelector('.painted')?.getAttribute('style')).toBeNull();
  });
  it('GitHub 只取仓库 README，不推断创建时间', () => {
    const url = 'https://github.com/example/idea';
    const result = extractFromDocument(documentOf(githubHtml, url), url);
    expect(result).toMatchObject({ platform: 'github', title: 'example/idea', author: 'example', publishedAt: null });
    expect(result.text).toContain('Idea Project'); expect(result.text).not.toContain('Sponsors');
    expect(result.githubLinks).toEqual(expect.arrayContaining([url, 'https://github.com/example/dependency']));
  });
  it('GitHub 无 README 只取可见简介并标记部分内容', () => {
    const url = 'https://github.com/example/idea';
    const result = extractFromDocument(documentOf('<div itemprop="about">只有简介</div>', url), url);
    expect(result.text).toBe('只有简介'); expect(result.status).toBe('partial');
  });
  it('提取允许读取的微信正文、显示日期和懒加载图片', () => {
    const url = 'https://mp.weixin.qq.com/s/test';
    const result = extractFromDocument(documentOf(wechatHtml, url), url);
    expect(result).toMatchObject({ platform: 'wechat', title: '微信文章标题', author: '作者甲', publishedAt: '2026年11月1日 10:00' });
    expect(result.images[0].url).toBe('https://mmbiz.qpic.cn/example.png');
  });
  it('无正文页面不把登录表单、导航和评论当作正文', () => {
    const doc = documentOf('<nav>菜单</nav><form>登录<input value="secret"></form><aside>推荐</aside>');
    const result = extractFromDocument(doc, doc.URL);
    expect(result.text).toBe(''); expect(result.status).toBe('unavailable');
  });
  it('不提取隐藏祖先、折叠内容或表单输入中的正文', () => {
    const url = 'https://mp.weixin.qq.com/s/test';
    const doc = documentOf(`<div style="display:none"><div id="js_content">不能越过隐藏限制读取的正文</div></div>`, url);
    expect(extractFromDocument(doc, url).text).toBe('');
    const ordinary = documentOf(`<main><article><p>${paragraph.repeat(2)}</p><details><summary>展开</summary><p>折叠秘密</p></details><textarea>私密输入</textarea><div contenteditable="plaintext-only">编辑草稿勿收集</div></article></main>`);
    const text = extractFromDocument(ordinary, ordinary.URL).text;
    expect(text).not.toContain('折叠秘密'); expect(text).not.toContain('私密输入');
    expect(text).not.toContain('编辑草稿勿收集');
    const editor = documentOf(`<article contenteditable="">${paragraph.repeat(3)}</article>`);
    expect(extractFromDocument(editor, editor.URL).text).toBe('');
  });
  it('特殊字符按文本保留，长文本截断并提示', () => {
    const doc = documentOf(articleHtml);
    expect(extractFromDocument(doc, doc.URL).text).toContain('<script>alert(1)</script> & 中文 🚀');
    const long = documentOf(`<article><p>${'长文本🚀'.repeat(30000)}</p></article>`);
    const result = extractFromDocument(long, long.URL);
    expect(result.text.length).toBeLessThanOrEqual(MAX_TEXT); expect(result.status).toBe('partial');
    expect(result.warnings.join(' ')).toContain('已截断');
  });
  it('过滤危险 URL 与假冒域名，不请求远程资源', () => {
    const doc = documentOf(`<article><p>${paragraph.repeat(2)}</p><a href="javascript:alert(1)">脚本链接</a><a href="file:///secret">本地</a><img src="data:image/png;base64,AA=="><img src="https://safe.example/image.png" onerror="alert(1)" alt="安全说明"></article>`);
    const result = extractFromDocument(doc, doc.URL);
    expect(result.links).toEqual([]); expect(result.images).toEqual([{ url: 'https://safe.example/image.png', description: '安全说明', kind: 'image' }]);
    expect(sourcePlatform('https://x.com.evil.test/status/123')).toBe('web');
    expect(httpUrl('javascript:alert(1)')).toBeNull();
    expect(githubProjects(['https://github.com/topics/idea', 'https://github.com/example/repo/issues/1', 'https://github.com/example/repo.git'])).toEqual(['https://github.com/example/repo']);
  });
});

it.each(['data-expanded-url','data-full-url','data-url','title','aria-label'])('X %s完整目标可识别，评论与引用不混入',attribute=>{
 const url='https://x.com/test/status/123',doc=documentOf(`<article><a href="/test/status/123"><time></time></a><div data-testid="tweetText">项目免费开源：<a href="https://t.co/fixture" ${attribute}="https://github.com/example/complete">github.com/example/<span aria-hidden="true">…</span></a></div><div data-testid="quoteTweet"><a href="https://github.com/wrong/quote">引用</a></div></article><article><a href="https://github.com/wrong/comment">评论</a></article>`,url);
 expect(extractFromDocument(doc,url).githubLinks).toEqual(['https://github.com/example/complete']);
});
it('X去掉aria-hidden省略号不能把仓库前缀当完整项目',()=>{
 const url='https://x.com/test/status/123',doc=documentOf(`<article><a href="/test/status/123"><time></time></a><div data-testid="tweetText"><a href="https://t.co/fixture">github.com/example/partial<span aria-hidden="true">…</span></a></div></article>`,url);const p=extractFromDocument(doc,url);expect(p.githubLinks).toEqual([]);expect(p.text).toContain('partial…');expect(p.links[0].url).toBe('https://t.co/fixture');expect(p.warnings.join('')).toContain('待核实');
});
