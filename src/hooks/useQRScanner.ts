import { useCallback, useState } from 'react';

/**
 * Scans an image file for QR codes using native BarcodeDetector with zxing fallback.
 * Returns an array of decoded QR strings (deduplicated).
 *
 * NOTE: zxing BrowserMultiFormatReader.decodeFromImageElement only returns ONE result.
 * For multi-QR detection, native BarcodeDetector is the primary path.
 * The zxing fallback is for single-QR as minimum viable.
 */
export async function scanImageForQRCodes(file: File): Promise<string[]> {
  // 1. Resize image to max 1280px (performance on old phones)
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    bitmap.width * scale,
    bitmap.height * scale,
  );
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // 2. Try native BarcodeDetector first
  if ('BarcodeDetector' in window) {
    try {
      const detector = new (window as any).BarcodeDetector({
        formats: ['qr_code'],
      });
      const results = await detector.detect(canvas);
      if (results.length > 0) {
        return [...new Set(results.map((r: { rawValue: string }) => r.rawValue))] as string[];
      }
    } catch {
      /* native failed, fallback */
    }
  }

  // 3. Fallback: zxing (lazy loaded)
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);

    // Convert canvas to image element for zxing
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
export function useQRScanner() {
  const [isScanning, setIsScanning] = useState(false);
  const [lastResults, setLastResults] = useState<string[]>([]);

  const scan = useCallback(async (file: File) => {
    setIsScanning(true);
    try {
      const results = await scanImageForQRCodes(file);
      setLastResults(results);
      return results;
    } finally {
      setIsScanning(false);
    }
  }, []);

  return { scan, isScanning, lastResults };
}
