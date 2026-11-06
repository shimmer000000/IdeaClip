import { SECTIONS, type Report } from '../src/ai/report';
export function mockReport(): Report {
  return { schemaVersion: 1, sections: Object.fromEntries(Object.keys(SECTIONS).map(key => [key, [{ kind: 'hypothesis', text: `${SECTIONS[key as keyof typeof SECTIONS]}：假设存在需求，先访谈五位目标用户验证。`, evidence: null }]])) as Report['sections'] };
}
export function mockCompletion(report: unknown = mockReport()) { return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(report) } }], usage: { prompt_tokens: 321, completion_tokens: 654 } }; }
