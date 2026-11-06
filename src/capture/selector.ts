// Everything used here must be inside the function: Chrome serializes it for injection.
export function installSelector(previewTabId: number | null, draftId: string | null = null) {
  const scope = globalThis as typeof globalThis & { __ideaClipCancel?: () => void };
  scope.__ideaClipCancel?.();
  const initial = { width: innerWidth, height: innerHeight, scrollX, scrollY, dpr: devicePixelRatio, scale: visualViewport?.scale ?? 1, href: location.href };
  if (initial.scale !== 1) throw new Error('请先退出触控捏合缩放，再选择区域。');
  const host = document.createElement('div');
  host.id = 'ideaclip-region-selector';
  host.setAttribute('popover', 'manual');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;z-index:2147483647!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{all:initial}*{box-sizing:border-box}.overlay{position:fixed;inset:0;cursor:crosshair;background:#12291c55;touch-action:none;user-select:none}.box{position:absolute;border:2px solid #d6ff9b;background:transparent;box-shadow:0 0 0 100vmax #12291c55;display:none;pointer-events:none}.help{position:absolute;top:16px;left:50%;transform:translateX(-50%);font:14px/1.5 sans-serif;color:#fff;background:#203b2b;padding:12px 20px;border-radius:10px;pointer-events:none;white-space:nowrap}.overlay.dragging{background:transparent}';
  const overlay = document.createElement('div'); overlay.className = 'overlay';
  const box = document.createElement('div'); box.className = 'box';
  const help = document.createElement('div'); help.className = 'help'; help.textContent = '拖动选择截图区域 · Esc / 右键取消';
  overlay.append(box, help); shadow.append(style, overlay);
  const previousFocus = document.activeElement;
  document.documentElement.append(host); host.showPopover();
  let start: { x: number; y: number } | undefined;
  let timer: ReturnType<typeof setTimeout>;
  host.tabIndex = -1; host.focus({ preventScroll: true });
  function cleanup() {
    clearTimeout(timer); host.remove();
    window.removeEventListener('keydown', keydown, true);
    window.removeEventListener('wheel', block, true);
    window.removeEventListener('scroll', cancel, true);
    window.removeEventListener('resize', cancel);
    window.removeEventListener('pagehide', cancel);
    document.removeEventListener('visibilitychange', visibility);
    if (scope.__ideaClipCancel === cleanup) delete scope.__ideaClipCancel;
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  }
  function cancel() { cleanup(); }
  function visibility() { if (document.hidden) cleanup(); }
  function block(event: Event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { block(event); cleanup(); }
    else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) block(event);
  }
  const point = (event: PointerEvent) => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
  const rect = (end: { x: number; y: number }) => ({ x: Math.min(start!.x, end.x), y: Math.min(start!.y, end.y), width: Math.abs(end.x - start!.x), height: Math.abs(end.y - start!.y) });
  overlay.addEventListener('pointerdown', event => {
    block(event); if (event.button !== 0) return;
    start = point(event); overlay.setPointerCapture(event.pointerId); overlay.classList.add('dragging'); box.style.display = 'block';
    box.style.cssText += `;left:${start.x}px;top:${start.y}px;width:0;height:0;`;
  });
  overlay.addEventListener('pointermove', event => {
    block(event); if (!start) return;
    const r = rect(point(event)); Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    help.textContent = `${Math.round(r.width)} × ${Math.round(r.height)} · 松开鼠标截图 · Esc 取消`;
  });
  overlay.addEventListener('pointerup', async event => {
    block(event); if (!start || event.button !== 0) return;
    const selected = rect(point(event));
    if (selected.width < 2 || selected.height < 2) { start = undefined; box.style.display = 'none'; help.textContent = '区域太小，请重新拖动 · Esc 取消'; return; }
    cleanup();
    // Let the compositor paint the page without the selector before asking Chrome to capture.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      const response = await chrome.runtime.sendMessage({ type: 'IC_CAPTURE_REGION', rect: selected, viewport: initial, previewTabId, draftId });
      if (!response?.ok) alert(response?.error ?? '截图失败，请重新打开 IdeaClip。');
    } catch { alert('截图中断，请重新打开 IdeaClip 再试。'); }
  });
  overlay.addEventListener('pointercancel', cleanup);
  overlay.addEventListener('contextmenu', event => { block(event); cleanup(); });
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('wheel', block, { capture: true, passive: false });
  window.addEventListener('scroll', cancel, true);
  window.addEventListener('resize', cancel);
  window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', visibility);
  scope.__ideaClipCancel = cleanup;
  timer = setTimeout(cleanup, 120_000);
}
