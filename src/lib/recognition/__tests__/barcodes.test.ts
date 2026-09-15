import { describe, it, expect } from 'vitest';
import { mergeReads, tileRects } from '../barcodes';

describe('tileRects', () => {
  it('covers the whole image with overlapping tiles', () => {
    const rects = tileRects(4000, 3000, 3);
    expect(rects).toHaveLength(9);
    expect(Math.min(...rects.map((r) => r.x))).toBe(0);
    expect(Math.min(...rects.map((r) => r.y))).toBe(0);
    expect(Math.max(...rects.map((r) => r.x + r.width))).toBe(4000);
    expect(Math.max(...rects.map((r) => r.y + r.height))).toBe(3000);
    // Neighbours overlap, so a barcode on a seam is whole in at least one tile.
    expect(rects[0].x + rects[0].width).toBeGreaterThan(rects[1].x);
  });

  it('never leaves the image', () => {
    for (const r of tileRects(1001, 777, 2)) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(1001);
      expect(r.y + r.height).toBeLessThanOrEqual(777);
    }
  });
});

describe('mergeReads', () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  it('adds up the passes that saw the same symbol', () => {
    const merged = mergeReads([
      { text: '03-4149BR', format: 'Code39', box, hits: 1 },
      { text: '03-4149BR', format: 'Code39', box, hits: 1 },
      { text: 'R14', format: 'Code39', box, hits: 1 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.text === '03-4149BR')?.hits).toBe(2);
  });
});
