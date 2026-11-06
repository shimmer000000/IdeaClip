import { pixelRect, type Rect, type Viewport } from './geometry';

export const MAX_EDGE = 2560;
export const MAX_BYTES = 2 * 1024 * 1024;

export function decodeCapture(dataUrl: string): Blob {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('浏览器返回了无法识别的截图。');
  const bytes = Uint8Array.from(atob(dataUrl.slice(prefix.length)), char => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

export async function compressCapture(dataUrl: string, viewport: Viewport, rect?: Rect) {
  const original = decodeCapture(dataUrl);
  const bitmap = await createImageBitmap(original);
  try {
    if (bitmap.width * bitmap.height > 100_000_000) throw new Error('页面分辨率过大，请降低窗口分辨率后重试。');
    const crop = pixelRect(rect, viewport, bitmap.width, bitmap.height);
    const ratio = Math.min(1, MAX_EDGE / Math.max(crop.width, crop.height));
    let width = Math.max(1, Math.round(crop.width * ratio));
    let height = Math.max(1, Math.round(crop.height * ratio));
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器无法处理截图。');
      context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      const webp = await canvas.convertToBlob({ type: 'image/webp', quality: attempt === 0 ? 0.86 : 0.72 });
      const png = await canvas.convertToBlob({ type: 'image/png' });
      const blob = png.size < webp.size ? png : webp;
      if (blob.size <= MAX_BYTES) return { blob, width, height, originalBytes: original.size, crop, imageWidth: bitmap.width, imageHeight: bitmap.height };
      width = Math.max(1, Math.round(width * 0.75));
      height = Math.max(1, Math.round(height * 0.75));
    }
    throw new Error('压缩后图片仍过大，请缩小截图区域。');
  } finally { bitmap.close(); }
}
