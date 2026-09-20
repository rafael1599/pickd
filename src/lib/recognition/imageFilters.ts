/**
 * Image processing filters for barcode enhancement (A3h / R11).
 *
 * Deterministic signal transformations:
 * 1. Laplacian Variance (LapVar) blur measurement.
 * 2. CLAHE (Contrast Limited Adaptive Histogram Equalization).
 * 3. Unsharp Masking (high-frequency detail restoration).
 * 4. Lanczos-3 upsampling (extends sub-pixel resolution down to 1.13 px/mod).
 *
 * ZERO generative AI: no hallucinated bars or mutated check digits.
 */

export function createCompatibleImageData(
  dataOrWidth: Uint8ClampedArray | number,
  widthOrHeight: number,
  heightOpt?: number
): ImageData {
  if (typeof dataOrWidth === 'number') {
    const width = dataOrWidth;
    const height = widthOrHeight;
    if (typeof ImageData !== 'undefined') {
      return new ImageData(width, height);
    }
    return {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: 'srgb',
    } as ImageData;
  } else {
    const data = dataOrWidth;
    const width = widthOrHeight;
    const height = heightOpt!;
    if (typeof ImageData !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new (ImageData as any)(data, width, height);
    }
    return {
      data,
      width,
      height,
      colorSpace: 'srgb',
    } as ImageData;
  }
}

/**
 * Computes the Laplacian Variance (LapVar) of an image (R11 §2.2).
 * Measures optical focus/sharpness using standard 3x3 discrete cross-Laplacian.
 *
 * Reference values from R11:
 * - Sharp / in-focus images: LapVar > 120 (typically 245 - 2200)
 * - Moderate blur / reading threshold: LapVar 50 - 120
 * - Severe optical blur / macro distance: LapVar < 50 (Galaxy S25 Ultra measured at 9.2 - 46.5)
 */
export function computeLaplacianVariance(imageData: ImageData): number {
  const { width: W, height: H, data } = imageData;
  if (W < 3 || H < 3) return 0;

  const gray = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // Integer luminance: (77*R + 150*G + 29*B) >> 8
    gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }

  let sum = 0;
  let sumSq = 0;
  const innerW = W - 2;
  const innerH = H - 2;
  const N = innerW * innerH;
  if (N <= 0) return 0;

  for (let y = 1; y < H - 1; y++) {
    const rowOffset = y * W;
    const rowPrev = (y - 1) * W;
    const rowNext = (y + 1) * W;
    for (let x = 1; x < W - 1; x++) {
      const val =
        gray[rowOffset + x + 1] +
        gray[rowOffset + x - 1] +
        gray[rowNext + x] +
        gray[rowPrev + x] -
        4 * gray[rowOffset + x];
      sum += val;
      sumSq += val * val;
    }
  }

  const mean = sum / N;
  const variance = sumSq / N - mean * mean;
  return Math.max(0, variance);
}

/**
 * Classifies a Laplacian Variance value into human-readable focus status.
 */
export function classifyLapVar(lapVar: number): string {
  if (lapVar < 50) {
    return `${lapVar.toFixed(1)} [Desenfoque severo / Macro - barrera óptica] (umbral: <50 desenfocada, >120 nítida)`;
  }
  if (lapVar < 120) {
    return `${lapVar.toFixed(1)} [Desenfoque moderado / límite de lectura] (umbral: <50 desenfocada, >120 nítida)`;
  }
  return `${lapVar.toFixed(1)} [Nítida] (umbral: <50 desenfocada, >120 nítida)`;
}

export interface ClaheOptions {
  clipLimit?: number;
  gridCols?: number;
  gridRows?: number;
}

/**
 * Contrast Limited Adaptive Histogram Equalization (CLAHE) (R11 §2.3).
 * Enhances local contrast in shadowed/faded barcode regions without blowing out noise.
 */
export function applyClahe(imageData: ImageData, options?: ClaheOptions): ImageData {
  const { width: W, height: H, data } = imageData;
  const clipLimit = options?.clipLimit ?? 3.0;
  let cols = options?.gridCols ?? 8;
  let rows = options?.gridRows ?? 8;

  // Adapt grid size for small ROI crops
  cols = Math.max(1, Math.min(cols, Math.floor(W / 16)));
  rows = Math.max(1, Math.min(rows, Math.floor(H / 16)));

  const gray = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }

  const tileW = W / cols;
  const tileH = H / rows;

  // Compute CDF lookup table for each tile (cols * rows * 256)
  const luts = new Uint8Array(cols * rows * 256);

  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor(r * tileH);
    const y1 = Math.min(H, Math.floor((r + 1) * tileH));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * tileW);
      const x1 = Math.min(W, Math.floor((c + 1) * tileW));
      const tilePixels = (x1 - x0) * (y1 - y0);

      // Histogram
      const hist = new Int32Array(256);
      for (let y = y0; y < y1; y++) {
        const offset = y * W;
        for (let x = x0; x < x1; x++) {
          hist[gray[offset + x]]++;
        }
      }

      // Clip histogram
      const clipVal = Math.max(1, Math.floor((clipLimit * tilePixels) / 256));
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clipVal) {
          excess += hist[i] - clipVal;
          hist[i] = clipVal;
        }
      }

      // Redistribute excess
      const bonus = Math.floor(excess / 256);
      let rem = excess % 256;
      for (let i = 0; i < 256; i++) {
        hist[i] += bonus;
        if (rem > 0) {
          hist[i]++;
          rem--;
        }
      }

      // CDF
      let cdf = 0;
      const lutOffset = (r * cols + c) * 256;
      for (let i = 0; i < 256; i++) {
        cdf += hist[i];
        luts[lutOffset + i] = Math.min(255, Math.max(0, Math.round((cdf * 255) / tilePixels)));
      }
    }
  }

  // Bilinear interpolation for each pixel
  const out = createCompatibleImageData(W, H);
  const outData = out.data;

  for (let y = 0; y < H; y++) {
    const yPos = (y - tileH / 2) / tileH;
    let r1 = Math.floor(yPos);
    let r2 = r1 + 1;
    const yWeight = yPos - r1;

    r1 = Math.max(0, Math.min(rows - 1, r1));
    r2 = Math.max(0, Math.min(rows - 1, r2));

    const rowOffset = y * W;

    for (let x = 0; x < W; x++) {
      const xPos = (x - tileW / 2) / tileW;
      let c1 = Math.floor(xPos);
      let c2 = c1 + 1;
      const xWeight = xPos - c1;

      c1 = Math.max(0, Math.min(cols - 1, c1));
      c2 = Math.max(0, Math.min(cols - 1, c2));

      const g = gray[rowOffset + x];

      const v11 = luts[(r1 * cols + c1) * 256 + g];
      const v12 = luts[(r1 * cols + c2) * 256 + g];
      const v21 = luts[(r2 * cols + c1) * 256 + g];
      const v22 = luts[(r2 * cols + c2) * 256 + g];

      // Bilinear
      const top = v11 * (1 - xWeight) + v12 * xWeight;
      const bot = v21 * (1 - xWeight) + v22 * xWeight;
      const val = Math.round(top * (1 - yWeight) + bot * yWeight);

      const outIdx = (rowOffset + x) * 4;
      outData[outIdx] = val;
      outData[outIdx + 1] = val;
      outData[outIdx + 2] = val;
      outData[outIdx + 3] = 255;
    }
  }

  return out;
}

export interface UnsharpOptions {
  amount?: number;
}

/**
 * Unsharp masking to sharpen edges of blurred barcode lines (R11 §2.3).
 * Uses a fast separable Gaussian [1, 2, 1] kernel on luminance.
 */
export function applyUnsharpMask(imageData: ImageData, options?: UnsharpOptions): ImageData {
  const { width: W, height: H, data } = imageData;
  const amount = options?.amount ?? 1.2;

  const gray = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }

  // Separable blur: horizontal
  const temp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const offset = y * W;
    temp[offset] = gray[offset];
    temp[offset + W - 1] = gray[offset + W - 1];
    for (let x = 1; x < W - 1; x++) {
      temp[offset + x] =
        (gray[offset + x - 1] + (gray[offset + x] << 1) + gray[offset + x + 1]) >> 2;
    }
  }

  // Separable blur: vertical
  const blur = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    blur[x] = temp[x];
    blur[(H - 1) * W + x] = temp[(H - 1) * W + x];
    for (let y = 1; y < H - 1; y++) {
      blur[y * W + x] =
        (temp[(y - 1) * W + x] + (temp[y * W + x] << 1) + temp[(y + 1) * W + x]) >> 2;
    }
  }

  const out = createCompatibleImageData(W, H);
  const outData = out.data;

  for (let i = 0; i < W * H; i++) {
    const diff = gray[i] - blur[i];
    const sharpened = Math.min(255, Math.max(0, Math.round(gray[i] + amount * diff)));
    const outIdx = i * 4;
    outData[outIdx] = sharpened;
    outData[outIdx + 1] = sharpened;
    outData[outIdx + 2] = sharpened;
    outData[outIdx + 3] = 255;
  }

  return out;
}

/** Sinc function with zero-safe handling. */
function sinc(x: number): number {
  if (Math.abs(x) < 1e-6) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Lanczos-3 kernel window. */
function lanczos3(x: number): number {
  const ax = Math.abs(x);
  if (ax === 0) return 1;
  if (ax < 3) return sinc(ax) * sinc(ax / 3);
  return 0;
}

/**
 * Pure Lanczos 3x upsampling (R11 §2.3).
 * Extends the readable X-dimension from 1.45 px/module down to 1.13 px/module
 * using a 6-tap separable sinc-windowed kernel.
 */
export function lanczos3Upsample(imageData: ImageData, scale: number = 3): ImageData {
  if (scale <= 1) return imageData;
  const { width: srcW, height: srcH, data: srcData } = imageData;

  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  // Convert src to grayscale
  const srcGray = new Uint8Array(srcW * srcH);
  for (let i = 0, j = 0; i < srcData.length; i += 4, j++) {
    srcGray[j] = (srcData[i] * 77 + srcData[i + 1] * 150 + srcData[i + 2] * 29) >> 8;
  }

  // Intermediate buffer for horizontal pass: dstW * srcH
  const horiz = new Float32Array(dstW * srcH);

  // Precompute horizontal weights for each dst x
  for (let dx = 0; dx < dstW; dx++) {
    const center = (dx + 0.5) / scale - 0.5;
    const minX = Math.floor(center - 3);
    const maxX = Math.ceil(center + 3);

    const weights: { x: number; w: number }[] = [];
    let wSum = 0;
    for (let sx = minX; sx <= maxX; sx++) {
      const w = lanczos3(sx - center);
      if (w !== 0) {
        weights.push({ x: Math.max(0, Math.min(srcW - 1, sx)), w });
        wSum += w;
      }
    }
    const invWSum = wSum !== 0 ? 1 / wSum : 1;

    for (let sy = 0; sy < srcH; sy++) {
      let acc = 0;
      const rowOffset = sy * srcW;
      for (const entry of weights) {
        acc += srcGray[rowOffset + entry.x] * entry.w;
      }
      horiz[sy * dstW + dx] = acc * invWSum;
    }
  }

  // Vertical pass: dstW * dstH
  const out = createCompatibleImageData(dstW, dstH);
  const outData = out.data;

  for (let dy = 0; dy < dstH; dy++) {
    const center = (dy + 0.5) / scale - 0.5;
    const minY = Math.floor(center - 3);
    const maxY = Math.ceil(center + 3);

    const weights: { y: number; w: number }[] = [];
    let wSum = 0;
    for (let sy = minY; sy <= maxY; sy++) {
      const w = lanczos3(sy - center);
      if (w !== 0) {
        weights.push({ y: Math.max(0, Math.min(srcH - 1, sy)), w });
        wSum += w;
      }
    }
    const invWSum = wSum !== 0 ? 1 / wSum : 1;

    for (let dx = 0; dx < dstW; dx++) {
      let acc = 0;
      for (const entry of weights) {
        acc += horiz[entry.y * dstW + dx] * entry.w;
      }
      const val = Math.min(255, Math.max(0, Math.round(acc * invWSum)));
      const outIdx = (dy * dstW + dx) * 4;
      outData[outIdx] = val;
      outData[outIdx + 1] = val;
      outData[outIdx + 2] = val;
      outData[outIdx + 3] = 255;
    }
  }

  return out;
}

/**
 * Full preprocessing pipeline for cropped ROI regions (A3h / R11 §2.3):
 * 1. Lanczos-3 upsampling (if width < 300 px or height < 100 px).
 * 2. CLAHE (Contrast Limited Adaptive Histogram Equalization).
 * 3. Unsharp Masking.
 */
export function preprocessRoi(imageData: ImageData): {
  processed: ImageData;
  scaleApplied: number;
} {
  let img = imageData;
  let scaleApplied = 1;

  // If the crop is small, upscale 3x with Lanczos to cross the 1.45 px/module barrier
  if (img.width < 300 || img.height < 100) {
    img = lanczos3Upsample(img, 3);
    scaleApplied = 3;
  }

  // Apply CLAHE for local contrast normalization
  img = applyClahe(img, { clipLimit: 3.0, gridCols: 4, gridRows: 4 });

  // Apply Unsharp Masking to sharpen bar boundaries
  img = applyUnsharpMask(img, { amount: 1.2 });

  return { processed: img, scaleApplied };
}
