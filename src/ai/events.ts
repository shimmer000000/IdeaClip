export function announceAIChange() {
  if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('ideaclip-ai-change'); channel.postMessage('cancel'); channel.close(); }
}
