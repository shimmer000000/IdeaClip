import { db, getSettings } from './storage';

// Future providers must pass this gate before accessing note content or making requests.
export async function requestAnalysis(database = db): Promise<never> {
  if (!(await getSettings(database)).aiEnabled) throw new Error('AI 分析已关闭。');
  throw new Error('AI 服务尚未接入，当前不会发送任何笔记。');
}
