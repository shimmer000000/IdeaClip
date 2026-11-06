export function announceAIChange() {
  if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('ideaclip-ai-change'); channel.postMessage('cancel'); channel.close(); }
  if (globalThis.chrome?.runtime?.id) void chrome.runtime.sendMessage({ type: 'IC_AI_CHANGED' }).catch(() => {});
}
