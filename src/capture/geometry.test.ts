import { describe, expect, it } from 'vitest';
import { pixelRect, sameViewport, type Viewport } from './geometry';
import { decodeCapture } from './image';

const viewport: Viewport = { width: 1000, height: 700, scrollX: 0, scrollY: 300, dpr: 2, scale: 1, href: 'https://example.com' };
describe('区域坐标与截图数据', () => {
  it.each([1, 1.25, 1.5, 2, 3])('按真实截图比例映射，比例 %s', factor => {
    expect(pixelRect({ x: 100, y: 120, width: 240, height: 160 }, viewport, 1000 * factor, 700 * factor)).toEqual({ x: 100 * factor, y: 120 * factor, width: 240 * factor, height: 160 * factor });
  });
  it('完整截图不受页面滚动位置影响', () => {
    expect(pixelRect(undefined, viewport, 2000, 1400)).toEqual({ x: 0, y: 0, width: 2000, height: 1400 });
  });
  it('非整数比例向外取整并限制在图片边缘', () => {
    expect(pixelRect({ x: 998, y: 698, width: 2, height: 2 }, viewport, 1333, 933)).toEqual({ x: 1330, y: 930, width: 3, height: 3 });
  });
  it.each([
    { x: -1, y: 0, width: 20, height: 20 },
    { x: 0, y: 0, width: 1, height: 20 },
    { x: 0, y: 0, width: Infinity, height: 20 },
    { x: 990, y: 0, width: 100, height: 20 },
  ])('拒绝越界或无效区域 %#', rect => { expect(() => pixelRect(rect, viewport, 1000, 700)).toThrow(); });
  it('拒绝捏合缩放以免产生偏移', () => { expect(() => pixelRect(undefined, { ...viewport, scale: 2 }, 1000, 700)).toThrow('捏合'); });
  it('发现滚动、缩放、页面跳转或尺寸变化', () => {
    expect(sameViewport(viewport, { ...viewport })).toBe(true);
    for (const change of [{ scrollY: 400 }, { dpr: 1.25 }, { width: 800 }, { href: 'https://other.test' }]) expect(sameViewport(viewport, { ...viewport, ...change })).toBe(false);
  });
  it('解码浏览器 PNG 且拒绝非截图格式', async () => {
    const blob = decodeCapture('data:image/png;base64,AQID');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(blob.type).toBe('image/png');
    expect(() => decodeCapture('https://example.com/image.png')).toThrow();
  });
});
