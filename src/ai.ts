import { db, getSettings } from './storage';

// Legacy callers cannot bypass per-analysis consent. New requests use AIEngine's one-use preview.
export async function requestAnalysis(database = db): Promise<never> {
  if (!(await getSettings(database)).aiEnabled) throw new Error('AI 分析已关闭。');
  throw new Error('请打开已保存灵感的 AI 分析页面，预览并确认本次发送内容和费用。');
}
