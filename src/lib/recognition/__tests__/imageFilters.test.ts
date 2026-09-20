import { describe, expect, it } from 'vitest';
import {
  applyClahe,
  applyUnsharpMask,
  classifyLapVar,
  computeLaplacianVariance,
  createCompatibleImageData,
  lanczos3Upsample,
  preprocessRoi,
} from '../imageFilters';

describe('imageFilters (A3h / R11)', () => {
  it('computes LapVar = 0 for flat uniform image', () => {
    const img = createCompatibleImageData(100, 100);
    // Fill with solid gray
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 128;
      img.data[i + 1] = 128;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
    const lapVar = computeLaplacianVariance(img);
    expect(lapVar).toBe(0);
    expect(classifyLapVar(lapVar)).toContain('[Desenfoque severo / Macro - barrera óptica]');
  });

  it('computes high LapVar for high contrast sharp checkerboard pattern', () => {
    const W = 64;
    const H = 64;
    const img = createCompatibleImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const val = (x % 2 === 0 && y % 2 === 0) || (x % 2 === 1 && y % 2 === 1) ? 255 : 0;
        const idx = (y * W + x) * 4;
        img.data[idx] = val;
        img.data[idx + 1] = val;
        img.data[idx + 2] = val;
        img.data[idx + 3] = 255;
      }
    }
    const lapVar = computeLaplacianVariance(img);
    expect(lapVar).toBeGreaterThan(120);
    expect(classifyLapVar(lapVar)).toContain('[Nítida]');
  });

  it('correctly classifies LapVar ranges per R11 specifications', () => {
    expect(classifyLapVar(9.2)).toContain('[Desenfoque severo / Macro - barrera óptica]');
    expect(classifyLapVar(46.5)).toContain('[Desenfoque severo / Macro - barrera óptica]');
    expect(classifyLapVar(60.0)).toContain('[Desenfoque moderado / límite de lectura]');
    expect(classifyLapVar(119.9)).toContain('[Desenfoque moderado / límite de lectura]');
    expect(classifyLapVar(120.1)).toContain('[Nítida]');
    expect(classifyLapVar(350.0)).toContain('[Nítida]');
  });

  it('applies CLAHE without throwing and preserves dimensions', () => {
    const W = 80;
    const H = 40;
    const img = createCompatibleImageData(W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = i % 256;
      img.data[i + 1] = i % 256;
      img.data[i + 2] = i % 256;
      img.data[i + 3] = 255;
    }
    const enhanced = applyClahe(img, { clipLimit: 3.0, gridCols: 4, gridRows: 2 });
    expect(enhanced.width).toBe(W);
    expect(enhanced.height).toBe(H);
    expect(enhanced.data.length).toBe(W * H * 4);
  });

  it('applies unsharp mask and enhances contrast on edges', () => {
    const W = 30;
    const H = 30;
    const img = createCompatibleImageData(W, H);
    // Create a step edge at x = 15
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const val = x < 15 ? 50 : 200;
        const idx = (y * W + x) * 4;
        img.data[idx] = val;
        img.data[idx + 1] = val;
        img.data[idx + 2] = val;
        img.data[idx + 3] = 255;
      }
    }
    const sharpened = applyUnsharpMask(img, { amount: 1.5 });
    expect(sharpened.width).toBe(W);
    expect(sharpened.height).toBe(H);
    // The dark side of the edge (x=14) should overshoot darker (< 50)
    const idxDarkEdge = (15 * W + 14) * 4;
    expect(sharpened.data[idxDarkEdge]).toBeLessThanOrEqual(50);
    // The bright side of the edge (x=15) should overshoot brighter (> 200)
    const idxBrightEdge = (15 * W + 15) * 4;
    expect(sharpened.data[idxBrightEdge]).toBeGreaterThanOrEqual(200);
  });

  it('upsamples with Lanczos-3 to exact 3x dimensions', () => {
    const W = 20;
    const H = 10;
    const img = createCompatibleImageData(W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 100;
      img.data[i + 1] = 100;
      img.data[i + 2] = 100;
      img.data[i + 3] = 255;
    }
    const upscaled = lanczos3Upsample(img, 3);
    expect(upscaled.width).toBe(60);
    expect(upscaled.height).toBe(30);
    expect(upscaled.data.length).toBe(60 * 30 * 4);
  });

  it('preprocessRoi upsamples small crops and applies CLAHE + Unsharp', () => {
    const W = 100;
    const H = 40;
    const img = createCompatibleImageData(W, H);
    const { processed, scaleApplied } = preprocessRoi(img);
    expect(scaleApplied).toBe(3);
    expect(processed.width).toBe(300);
    expect(processed.height).toBe(120);
  });
});
