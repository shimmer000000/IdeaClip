import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { ReportView } from './AnalysisPage';
import { BUILTINS, BUSINESS_ID, LEAN_ID } from '../skills/model';
import { mockReport } from '../../tests/ai-fixture';
import type { Analysis } from '../storage';

const base: Analysis = { id: 'report', noteId: 'note', content: '# 原始全文\n\n不修改导出内容。', createdAt: 1 };
const business = BUILTINS.find(s => s.id === BUSINESS_ID)!;
const lean = BUILTINS.find(s => s.id === LEAN_ID)!;
const custom = { ...lean, id: 'custom', name: '自定义分析', builtin: false, sections: lean.sections.slice(0, 3) };
for (const [name, template, count] of [['15栏', business, 15], ['6栏', lean, 6], ['自定义3栏', custom, 3]] as const) {
  it(`0.2.9 ${name}默认折叠，标题/编号/条目数及严格分类内容保留`, () => {
    const analysis: Analysis = { ...base, template, skillReport: { schemaVersion: 2, sections: Object.fromEntries(template.sections.map(s => [s.key, [{ kind: 'hypothesis', text: '待验证的需求', evidence: null }]])) } };
    const original = JSON.stringify(analysis);
    const doc = new JSDOM(renderToStaticMarkup(createElement(ReportView, { analysis }))).window.document;
    expect(doc.querySelectorAll('.ai-section-toggle')).toHaveLength(count);
    expect(doc.querySelectorAll('.ai-section-toggle[aria-expanded="false"]')).toHaveLength(count);
    expect(doc.querySelectorAll('.ai-section-content[hidden]')).toHaveLength(count);
    expect(doc.querySelector('.ai-section-number')?.textContent).toBe('01');
    expect(doc.querySelectorAll('.ai-section-number')[count - 1].textContent).toBe(String(count).padStart(2, '0'));
    expect(doc.querySelector('.ai-section-count')?.textContent).toBe('1 条');
    for (const button of doc.querySelectorAll('.ai-section-toggle')) expect(doc.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull();
    expect(doc.querySelectorAll('.ai-claim.hypothesis')).toHaveLength(count);
    expect(JSON.stringify(analysis)).toBe(original);
  });
}
it('0.2.9旧版15栏报告同样折叠，原文/推测/假设分类及转义保留', () => {
  const report = mockReport();
  report.sections.summary = [{ kind: 'fact', text: '<script>不得执行</script>', evidence: '逐字证据' }, { kind: 'inference', text: '推测内容', evidence: null }];
  const doc = new JSDOM(renderToStaticMarkup(createElement(ReportView, { analysis: { ...base, report } }))).window.document;
  expect(doc.querySelectorAll('.ai-section-content[hidden]')).toHaveLength(15);
  expect(doc.querySelector('.ai-section-count')?.textContent).toBe('2 条');
  expect(doc.querySelector('.ai-claim.fact blockquote')?.textContent).toContain('逐字证据');
  expect(doc.querySelector('.ai-claim.inference')).not.toBeNull(); expect(doc.querySelector('script')).toBeNull();
  expect(doc.querySelector('.ai-claim.fact p')?.textContent).toBe('<script>不得执行</script>');
});
it('0.2.9历史纯Markdown沿用原始pre，不加结构化折叠控件', () => {
  const doc = new JSDOM(renderToStaticMarkup(createElement(ReportView, { analysis: base }))).window.document;
  expect(doc.querySelector('pre')?.textContent).toBe(base.content);
  expect(doc.querySelector('.ai-report-controls')).toBeNull(); expect(doc.querySelector('.ai-section-toggle')).toBeNull();
});
