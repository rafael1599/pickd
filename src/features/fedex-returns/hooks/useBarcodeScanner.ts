import { useCallback, useState } from 'react';

/**
 * Scans an image file for barcodes (CODE_128, CODE_39) using native BarcodeDetector
 * with zxing fallback. Designed for FedEx tracking label scanning.
 *
 * FedEx tracking numbers are typically 12-15 digits.
 */
export async function scanImageForBarcodes(file: File): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(bitmap.width * scale, bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // Try native BarcodeDetector first
  if ('BarcodeDetector' in window) {
    try {
      const detector = new (window as any).BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'upc_a'],
      });
      const results = await detector.detect(canvas);
      if (results.length > 0) {
        return [...new Set(results.map((r: { rawValue: string }) => r.rawValue))] as string[];
      }
    } catch {
      /* native failed, fallback */
    }
  }

  // Fallback: zxing (lazy loaded)
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13,
      BarcodeFormat.UPC_A,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const result = await reader.decodeFromImageElement(img);
    URL.revokeObjectURL(url);
    return result ? [result.getText()] : [];
  } catch {
    return [];
  }
}

/** Hook version for React components */
export function useBarcodeScanner() {
  const [isScanning, setIsScanning] = useState(false);
  const [lastResults, setLastResults] = useState<string[]>([]);

  const scan = useCallback(async (file: File) => {
    setIsScanning(true);
    try {
      const results = await scanImageForBarcodes(file);
      setLastResults(results);
      return results;
    } finally {
      setIsScanning(false);
    }
  }, []);

  return { scan, isScanning, lastResults };
}
