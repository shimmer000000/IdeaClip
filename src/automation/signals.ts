export function signalQueue(taskId?: string) {
  if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('ideaclip-auto-queue'); channel.postMessage({ taskId: taskId ?? null }); channel.close(); }
}
export function wakeQueue() {
  signalQueue();
  if (globalThis.chrome?.runtime?.id) void chrome.runtime.sendMessage({ type: 'IC_QUEUE_WAKE' }).catch(() => {});
}
export async function sessionId(): Promise<string> {
  if (!globalThis.chrome?.runtime?.id) throw new Error('自动队列仅可在真实扩展环境中运行。');
  const result = await chrome.runtime.sendMessage({ type: 'IC_QUEUE_SESSION' });
  if (!result?.ok || typeof result.id !== 'string') throw new Error('无法建立本浏览器会话，自动任务保持暂停。');
  return result.id;
}
