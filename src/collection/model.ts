import type { TextQuality, ContentProvenance } from './quality';
export type Platform = 'x' | 'github' | 'wechat' | 'article' | 'web';
export const platformNames: Record<Platform, string> = { x: 'X / Twitter', github: 'GitHub', wechat: '微信公众号', article: '文章网站', web: '其他网页' };
export interface PageLink { url: string; text: string }
export interface PageImage { url: string; description: string; kind: 'image' | 'video-cover' }
export interface ExtractedPage {
  sourceUrl: string;
  platform: Platform;
  siteName: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  text: string;
  images: PageImage[];
  links: PageLink[];
  githubLinks: string[];
  collectedAt: number;
  status: 'readable' | 'partial' | 'unavailable';
  warnings: string[];
  quality?: TextQuality;
  provenance?: ContentProvenance;
}
export interface ContentCapture extends ExtractedPage {
  originalUrl: string;
  id: string;
  sourceTabId: number | null;
  screenshotIds: string[];
  noteId: string | null;
  updatedAt: number;
  textOrigin: 'extracted' | 'manual' | 'edited' | 'empty';
}
export const MAX_TEXT = 100_000;
export const MAX_LINKS = 200;
export const MAX_IMAGES = 100;
export function cleanText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').replace(/[\t\u00a0 ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function httpUrl(value: string | null | undefined, base?: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function sourcePlatform(sourceUrl: string): Platform {
  try {
    const host = new URL(sourceUrl).hostname;
    if (/(^|\.)(x|twitter)\.com$/.test(host)) return 'x';
    if (host === 'github.com') return 'github';
    if (host === 'mp.weixin.qq.com') return 'wechat';
  } catch { /* Unknown source is deliberately not inferred. */ }
  return 'web';
}
export function githubProjects(urls: string[]): string[] {
  const results = new Set<string>();
  for (const value of urls) {
    const valid = httpUrl(value); if (!valid) continue;
    const url = new URL(valid);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname !== 'github.com' || parts.length < 2 || /^(features|topics|collections|marketplace|settings|login|signup|orgs|users|search|sponsors|enterprise|about|pricing)$/.test(parts[0])) continue;
    if (!/^[a-z\d-]+$/i.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) continue;
    results.add(`https://github.com/${parts[0]}/${parts[1].replace(/\.git$/, '')}`);
  }
  return [...results].slice(0, MAX_LINKS);
}
export function emptyPage(url: string, title: string, warning: string): ExtractedPage {
  const safe = httpUrl(url) ?? '';
  return { sourceUrl: safe, platform: sourcePlatform(safe), siteName: safe ? new URL(safe).hostname : '无法访问的页面', title, author: null, publishedAt: null, text: '', images: [], links: [], githubLinks: [], collectedAt: Date.now(), status: 'unavailable', warnings: [warning, '无法读取的内容未作推断，可手动粘贴正文。'] };
}
