export interface Viewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  dpr: number;
  scale: number;
  href: string;
}
export interface Rect { x: number; y: number; width: number; height: number }

export function pixelRect(rect: Rect | undefined, viewport: Viewport, imageWidth: number, imageHeight: number): Rect {
  if (![viewport.width, viewport.height, imageWidth, imageHeight].every(n => Number.isFinite(n) && n > 0)) throw new Error('无法确定截图尺寸，请重试。');
  if (viewport.scale !== 1) throw new Error('请先退出触控捏合缩放，再截图。浏览器菜单中的页面缩放受支持。');
  if (!rect) return { x: 0, y: 0, width: imageWidth, height: imageHeight };
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 2 || rect.height < 2 || rect.x < 0 || rect.y < 0 || rect.x + rect.width > viewport.width + 1 || rect.y + rect.height > viewport.height + 1) throw new Error('选择区域无效，请重新拖动。');
  // Use actual capture dimensions rather than assuming screenshot pixels equal CSS pixels × DPR.
  const sx = imageWidth / viewport.width;
  const sy = imageHeight / viewport.height;
  const x = Math.floor(rect.x * sx);
  const y = Math.floor(rect.y * sy);
  const right = Math.min(imageWidth, Math.ceil((rect.x + rect.width) * sx));
  const bottom = Math.min(imageHeight, Math.ceil((rect.y + rect.height) * sy));
  return { x, y, width: right - x, height: bottom - y };
}

export function sameViewport(a: Viewport, b: Viewport): boolean {
  return (['width', 'height', 'scrollX', 'scrollY', 'dpr', 'scale', 'href'] as const).every(key => a[key] === b[key]);
}

// Self-contained: serialized by chrome.scripting.executeScript into the isolated world.
export async function readViewport(): Promise<Viewport> {
  (globalThis as typeof globalThis & { __ideaClipCancel?: () => void }).__ideaClipCancel?.();
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return { width: innerWidth, height: innerHeight, scrollX, scrollY, dpr: devicePixelRatio, scale: visualViewport?.scale ?? 1, href: location.href };
}
