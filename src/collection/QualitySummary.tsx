import { useState } from 'react';
import './quality.css';
import { QUALITY_LABELS, validProvenance, paragraphUrl, type TextQuality, type ContentProvenance } from './quality';

export function QualitySummary({ quality, provenance, text, url }: { quality?: TextQuality; provenance?: ContentProvenance; text: string; url: string }) {
  const [limit, setLimit] = useState(12); const valid = validProvenance(provenance, text, url);
  return <section className="quality-summary"><h3>正文质量：{quality ? QUALITY_LABELS[quality.state] : text ? '旧记录或手动内容，来源待核对' : '不可读取'}</h3>
    <p>来源校验：{valid && provenance?.origin === 'page' ? '匹配采集时的正文与 URL（不代表事实已核验）' : '待核对；不会自动发送，可逐次确认手动分析'}</p>
    {quality && <><p>质量参考分 {quality.score}/100 · {quality.metrics.characters} 字符 · {quality.metrics.paragraphs} 个有效段落 · 链接密度 {Math.round(quality.metrics.linkDensity * 100)}%</p><ul>{quality.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
    <p className="muted">完整仅指当前所选可读范围，不保证网站全文完整或事实真实。自动分析只接收与来源一致、质量完整且未经修改的当前网页采集；手动补充、旧记录和恢复数据仍可保存，并在 AI 页面逐次预览确认。</p>
    {valid && provenance && <details><summary>段落与来源定位（{provenance.paragraphs.length}{provenance.paragraphs.length === 512 ? '，达到显示上限' : ''} 段）</summary><p>来源：{provenance.url} · {provenance.origin === 'page' ? '网页采集快照' : provenance.origin === 'backup' ? '恢复的快照，不作为自动发送授权' : '用户编辑后的本地快照'}</p><p>原网页定位使用浏览器文本片段；网页改变或不支持时可能无法定位，以保存快照为准。DOM 路径只作位置线索，不执行选择器，也不代表事实已核验。</p>{provenance.paragraphs.slice(0, limit).map(p => <article key={p.id}><strong>{p.id} · 正文字符 {p.start}–{p.end}</strong><p className="preserve-text">{p.quote}</p>{provenance.origin === 'page' && <a href={paragraphUrl(provenance, p) ?? undefined} target="_blank" rel="noreferrer">在原网页查找此段 ↗</a>}<p className="muted">{p.domPath ? '已匹配采集时的可见 DOM 段落' : '仅快照段落，未确认对应 DOM'}</p></article>)}{provenance.paragraphs.length > limit && <button type="button" onClick={() => setLimit(n => n + 12)}>显示更多段落</button>}</details>}
    {provenance && !valid && <p className="notice">正文或来源已经改变，旧段落位置已失效，不用于定位或自动分析。</p>}
  </section>;
}
