import Dexie from 'dexie';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { assessQuality, paragraphMap, textFingerprint, validProvenance, captureAllowsAuto, paragraphUrl } from './quality';
import { extractFromDocument } from './extract';
import { qualityCapture, qualityText } from '../../tests/quality-fixture';
import { articleHtml, githubHtml, xHtml, paragraph } from '../../tests/fixtures/pages';
import { IdeaClipDB } from '../storage';
import { portableRow } from '../backup/model';
import { saveCaptureEdits } from './storage';
import { automaticContentProblem } from '../automation/policy';
import { noteDefaults } from '../inspiration/model';
import { exportBackup, prepareBackup, restoreBackup, discardBackup } from '../backup/service';

const url = 'https://example.com/public';
const extract = (html: string, source = url) => { const dom = new JSDOM(html, { url: source }); try { return extractFromDocument(dom.window.document, source); } finally { dom.window.close(); } };
describe('正文质量与来源段落', () => {
  it.each([
    ['文章', articleHtml, url],
    ['工具网站', `<title>SaaS 产品</title><main><h1>公开产品</h1><p>${paragraph.repeat(3)}</p><p>${paragraph.repeat(2)}</p></main>`, url],
    ['GitHub', githubHtml.replace(paragraph.repeat(2), paragraph.repeat(4)), 'https://github.com/example/project'],
  ])('%s 正文长度/段落充分，质量完整且保留来源定位', (_name, html, source) => {
    const capture = extract(html, source); expect(capture.quality?.state).toBe('complete'); expect(capture.provenance?.origin).toBe('page'); expect(validProvenance(capture.provenance, capture.text, source)).toBe(true); expect(capture.provenance!.paragraphs.some(p => !!p.domPath)).toBe(true);
  });
  it('X 仍精确选择当前主帖；未展开为部分，展开后短帖策略可完整', () => {
    const source = 'https://x.com/fixture/status/123'; const partial = extract(xHtml('123'), source); expect(partial.quality?.state).toBe('partial'); expect(partial.text).not.toContain('错误的推荐');
    const complete = extract(xHtml('123').replace('<button data-testid="tweet-text-show-more-link">显示更多</button>', ''), source); expect(complete.quality?.state).toBe('complete'); expect(complete.quality?.method).toBe('x');
  });
  it.each(['', '只有简介', 'a'.repeat(200)])('缺失、短正文或单一段落不允许视为完整', text => { expect(assessQuality({ text, url }).state).toBe(text ? 'partial' : 'unreadable'); });
  it('高链接密度与未知来源均降低质量', () => { expect(assessQuality({ text: qualityText, url, linkCharacters: qualityText.length * 0.8 }).state).toBe('partial'); expect(assessQuality({ text: qualityText, url: 'javascript:bad' }).state).toBe('partial'); });
  it('隐藏/输入内容不增加正文或泄漏到段落地图，不修改 live DOM', () => {
    const dom = new JSDOM(`<main><p>${qualityText.replaceAll('\n', '</p><p>')}</p><div style="display:none"><p>hidden-secret</p></div><textarea>typed-secret</textarea><div contenteditable>editable-secret</div></main>`, { url }); const before = dom.window.document.body.innerHTML; const capture = extractFromDocument(dom.window.document, url);
    expect(JSON.stringify(capture)).not.toMatch(/hidden-secret|typed-secret|editable-secret/); expect(capture.quality!.metrics.hiddenRemoved).toBeGreaterThan(0); expect(dom.window.document.body.innerHTML).toBe(before); dom.window.close();
  });
  it.each(['', 'plaintext-only', 'true'])('contenteditable=%s 及其子节点不进入正文与定位', value => {
    const capture = extract(`<main><p>${qualityText.replaceAll('\n', '</p><p>')}</p><section contenteditable="${value}"><p>editable-private-value</p><p contenteditable="false">nested-private-value</p></section><p contenteditable="FALSE">可读的只读内容保留</p></main>`);
    expect(JSON.stringify(capture)).not.toMatch(/editable-private-value|nested-private-value/); expect(capture.text).toContain('可读的只读内容保留');
  });
  it('段落 offset/quote 一致，内容/来源变更和伪造位置使定位失效', () => {
    const source = paragraphMap(qualityText, url, 'page'); expect(validProvenance(source, qualityText, url)).toBe(true); expect(validProvenance(source, qualityText + '变更', url)).toBe(false); expect(validProvenance(source, qualityText, url + '/other')).toBe(false); source.paragraphs[0].end++; expect(validProvenance(source, qualityText, url)).toBe(false);
  });
  it('段落数量有界，文本片段 URL 只允许 HTTP/S，不执行选择器或脚本', () => { const source = paragraphMap('<script>bad()</script>\n'.repeat(2000), url, 'page'); expect(source.paragraphs).toHaveLength(512); const target = paragraphUrl(source, source.paragraphs[0]); expect(target).toContain('#:~:text=%3Cscript%3E'); expect(paragraphUrl({ ...source, url: 'javascript:bad' }, source.paragraphs[0])).toBeNull(); });
  it.each(['missing', 'partial', 'url', 'text', 'edited', 'backup', 'fingerprint'])('%s 采集不允许自动发送', mode => {
    const capture = qualityCapture(url); if (mode === 'missing') delete capture.quality; if (mode === 'partial') capture.quality!.state = 'partial'; if (mode === 'url') capture.sourceUrl += '/different'; if (mode === 'text') capture.text += '变更'; if (mode === 'edited') capture.textOrigin = 'edited'; if (mode === 'backup') capture.provenance!.origin = 'backup'; if (mode === 'fingerprint') capture.provenance!.fingerprint = 'wrong';
    expect(captureAllowsAuto(capture, qualityText, url)).toBe(false);
  });
  it('完整当前采集允许自动分析，真正未知正文阻止，手动编辑保存后不会保留原自动资格', async () => {
    const database = new IdeaClipDB('quality-edit-' + crypto.randomUUID()); const capture = qualityCapture(url); const note = { ...noteDefaults(url), id: 'n', title: '公开产品', url, body: '', tags: [], status: 'inbox' as const, createdAt: 1, updatedAt: 1, content: qualityText, captureIds: [capture.id] };
    try { await database.contentCaptures.add(capture); expect(await automaticContentProblem(note, database)).toBe(''); expect(await automaticContentProblem({ ...note, captureIds: [] }, database)).toContain('来源待核对'); await saveCaptureEdits(capture.id, { ...capture, text: qualityText + '\n手动补充，不默认为网页原文' }, database); const edited = (await database.contentCaptures.get(capture.id))!; expect(edited.provenance?.origin).toBe('edited'); expect(captureAllowsAuto(edited, edited.text, url)).toBe(false); expect(validProvenance(edited.provenance, edited.text, url)).toBe(true); } finally { await database.delete(); }
  });
  it('备份包含脱敏后的质量和段落，恢复不赋予自动发送资格', () => {
    const capture = qualityCapture(url, qualityText + '\napi_key=private-example-secret'); const restored = portableRow('contentCaptures', capture) as unknown as typeof capture; expect(restored.text).not.toContain('private-example-secret'); expect(restored.provenance?.origin).toBe('backup'); expect(validProvenance(restored.provenance, restored.text, url)).toBe(true); expect(captureAllowsAuto(restored, restored.text, url)).toBe(false); expect(() => portableRow('contentCaptures', { ...capture, quality: { ...capture.quality, version: 99 } })).toThrow('版本');
  });
  it('完整 ZIP 往返保留正文质量和段落关联，但不能把恢复当作自动授权', async () => {
    const source = new IdeaClipDB('quality-zip-' + crypto.randomUUID()); const target = new IdeaClipDB('quality-restored-' + crypto.randomUUID());
    try {
      const capture = qualityCapture(url); await source.contentCaptures.put(capture);
      const prepared = await prepareBackup(await exportBackup(source));
      try { await restoreBackup(prepared, 'merge', target); } finally { await discardBackup(prepared); }
      const restored = (await target.contentCaptures.get(capture.id))!;
      expect(restored.quality?.state).toBe('complete'); expect(restored.provenance?.origin).toBe('backup');
      expect(validProvenance(restored.provenance, restored.text, url)).toBe(true); expect(captureAllowsAuto(restored, restored.text, url)).toBe(false);
    } finally { await source.delete(); await target.delete(); }
  });
  it('损坏的质量指标或段落不导致自动发送，隐藏节点计数有界', () => {
    const capture = qualityCapture(url); capture.quality!.metrics.linkDensity = NaN;
    expect(captureAllowsAuto(capture, qualityText, url)).toBe(false);
    capture.provenance!.paragraphs = [null as never]; expect(validProvenance(capture.provenance, qualityText, url)).toBe(false);
    expect(assessQuality({ text: qualityText, url, hiddenRemoved: 999999 }).metrics.hiddenRemoved).toBe(50000);
  });
  it('schema7 升级8保留旧采集、笔记、任务和预算，旧采集不被伪造为已评估', async () => {
    const name = 'quality-v7-' + crypto.randomUUID(); const old = new Dexie(name); old.version(7).stores({ notes: 'id', contentCaptures: 'id', aiTasks: 'id, &dedupeKey, state', aiUsage: 'id' }); await old.table('notes').put({ id: 'old', body: '旧感悟' }); await old.table('contentCaptures').put({ id: 'old-capture', text: '原文' }); await old.table('aiTasks').put({ id: 'task', dedupeKey: 'old:1', state: 'failed' }); await old.table('aiUsage').put({ id: 'usage', reservedMicros: 123 }); old.close(); const database = new IdeaClipDB(name);
    try { await database.open(); expect(database.verno).toBe(11); expect((await database.notes.get('old'))?.body).toBe('旧感悟'); expect((await database.contentCaptures.get('old-capture'))?.quality).toBeUndefined(); expect((await database.aiTasks.get('task'))?.state).toBe('failed'); expect((await database.aiUsage.get('usage'))?.reservedMicros).toBe(123); } finally { await database.delete(); }
  });
  it('定位指纹明确依赖正文，不作为安全签名', () => { expect(textFingerprint(qualityText)).not.toBe(textFingerprint(qualityText + 'x')); });
});
