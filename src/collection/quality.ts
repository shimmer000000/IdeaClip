import { cleanText, httpUrl, type Platform, type ContentCapture } from './model';

export type QualityState = 'complete' | 'partial' | 'unreadable';
export interface TextQuality {
  version: 1; state: QualityState; score: number; fingerprint: string;
  method: 'readability' | 'semantic' | 'x' | 'github' | 'wechat' | 'manual';
  reasons: string[];
  metrics: { characters: number; paragraphs: number; linkDensity: number; hiddenRemoved: number };
}
export interface SourceParagraph { id: string; start: number; end: number; quote: string; domPath?: string }
export interface ContentProvenance { version: 1; origin: 'page' | 'edited' | 'backup'; url: string; fingerprint: string; paragraphs: SourceParagraph[] }
export const QUALITY_LABELS = { complete: '完整（当前可读范围）', partial: '部分，待核对', unreadable: '不可读取' };
// Locator fingerprint, not a security signature. Auto gating also compares full
// capture text/URL, and the queue independently uses SHA-256 for its snapshot.
export function textFingerprint(text: string) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return `${text.length}:${(h >>> 0).toString(16)}`; }
export function assessQuality(input: { text: string; url: string; platform?: Platform; method?: TextQuality['method']; linkCharacters?: number; hiddenRemoved?: number; incomplete?: boolean }): TextQuality {
  const text = cleanText(input.text); const characters = text.replace(/\s/g, '').length;
  const paragraphs = text.split(/\n+/).filter(s => s.trim().length >= 8).length;
  const density = Number.isFinite(input.linkCharacters ?? 0) ? Math.max(0, Math.min(1, (input.linkCharacters ?? 0) / Math.max(text.length, 1))) : 1;
  const hiddenRemoved = Math.min(50000, Math.max(0, Math.trunc(input.hiddenRemoved ?? 0) || 0));
  const shortPost = input.platform === 'x'; const enough = shortPost ? characters >= 12 : characters >= 160 && paragraphs >= 2;
  const reasons: string[] = []; let score = 100;
  if (!httpUrl(input.url)) { reasons.push('正文来源 URL 无效或未知。'); score -= 60; }
  if (!characters) { reasons.push('没有可读取正文，允许手动补充。'); score = 0; }
  else if (!enough) { reasons.push(shortPost ? '主帖正文过短，需人工核对。' : '正文长度或有效段落不足，可能仅为简介或页面外壳。'); score -= 45; }
  if (density > 0.45) { reasons.push('链接文本密度偏高，可能包含导航或链接目录。'); score -= 45; }
  if (input.incomplete) { reasons.push('存在未展开、截断或缺少主体的提示。'); score -= 45; }
  if (hiddenRemoved > 0) reasons.push(`已排除 ${hiddenRemoved} 个隐藏或输入区域节点，未将其内容计入正文。`);
  const state: QualityState = !characters ? 'unreadable' : enough && density <= 0.45 && !input.incomplete && !!httpUrl(input.url) ? 'complete' : 'partial';
  if (!reasons.length) reasons.push('长度、段落和链接密度符合当前策略；不代表网站全文或事实已经核验。');
  return { version: 1, state, score: Math.max(0, score), fingerprint: textFingerprint(input.text), method: input.method ?? 'manual', reasons, metrics: { characters, paragraphs, linkDensity: density, hiddenRemoved } };
}
export function paragraphMap(text: string, url: string, origin: ContentProvenance['origin'], doc?: Document): ContentProvenance {
  const paragraphs: SourceParagraph[] = [];
  const candidates = doc ? [...doc.querySelectorAll('p,h1,h2,h3,li,pre,blockquote,[data-testid="tweetText"]')].slice(0, 3000).filter(el => !el.closest('form,input,textarea,select,[hidden],[aria-hidden="true"],[contenteditable]:not([contenteditable="false" i])')) : [];
  const normalize = (s: string) => cleanText(s).replace(/\s+/g, ' ');
  const byText = new Map<string, Element[]>();
  for (const el of candidates) { const key = normalize(el.textContent ?? ''); if (key.length > 100000) continue; const old = byText.get(key) ?? []; old.push(el); byText.set(key, old); }
  for (const match of text.matchAll(/[^\n]+/g)) {
    if (paragraphs.length >= 512) break;
    const item: SourceParagraph = { id: `p${paragraphs.length + 1}`, start: match.index!, end: match.index! + match[0].length, quote: match[0].slice(0, 160) };
    const hits = byText.get(normalize(match[0])); const el = hits?.length === 1 ? hits[0] : null;
    if (el) {
      let visible = true; const path: string[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = doc?.defaultView?.getComputedStyle(node); if (style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') visible = false;
        path.unshift(node.tagName.toLowerCase() + (node.parentElement ? `:nth-child(${[...node.parentElement.children].indexOf(node) + 1})` : ''));
      }
      if (visible && path.length <= 32) item.domPath = path.join(' > ');
    }
    paragraphs.push(item);
  }
  return { version: 1, origin, url, fingerprint: textFingerprint(text), paragraphs };
}
export function validProvenance(source: ContentProvenance | undefined, text: string, url: string): boolean {
  return !!source && source.version === 1 && source.url === url && source.fingerprint === textFingerprint(text) && Array.isArray(source.paragraphs) && source.paragraphs.length > 0 && source.paragraphs.length <= 512 && source.paragraphs.every((p, i) => !!p && p.id === `p${i + 1}` && Number.isSafeInteger(p.start) && Number.isSafeInteger(p.end) && p.start >= 0 && p.end > p.start && p.end <= text.length && (i === 0 || p.start >= source.paragraphs[i - 1].end) && p.quote === text.slice(p.start, p.end).slice(0, 160));
}
export function captureAllowsAuto(capture: ContentCapture, content: string, url: string): boolean {
  const q = capture.quality;
  if (!q || !q.metrics || !Number.isFinite(q.metrics.linkDensity) || q.metrics.linkDensity < 0 || q.metrics.linkDensity > 1 || !httpUrl(url) || q.version !== 1 || q.state !== 'complete' || q.fingerprint !== textFingerprint(content) || capture.textOrigin !== 'extracted' || capture.text !== content || httpUrl(capture.sourceUrl) !== httpUrl(url) || httpUrl(capture.originalUrl) !== httpUrl(url) || capture.provenance?.origin !== 'page' || !validProvenance(capture.provenance, content, capture.sourceUrl)) return false;
  return assessQuality({ text: content, url, platform: capture.platform, method: q.method, linkCharacters: q.metrics.linkDensity * cleanText(content).length, incomplete: capture.warnings.some(w => /展开入口|超过.*截断|仅尝试保留/.test(w)) }).state === 'complete';
}
export function paragraphUrl(source: ContentProvenance, paragraph: SourceParagraph) {
  const url = httpUrl(source.url); if (!url) return null;
  return url.split('#')[0] + '#:~:text=' + encodeURIComponent(paragraph.quote);
}
