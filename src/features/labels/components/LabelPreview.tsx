import { useEffect, useRef } from 'react';
import {
  computeLabelFace,
  createJsPdfMeasurer,
  type LabelItem,
} from '../../inventory/utils/labelLayout';
import { renderLabelFaceToCanvas } from '../utils/renderLabelCanvas';
import { useLabelCodeOptions } from '../hooks/useLabelPrintOptions';
import type { LabelEntry } from '../hooks/useGenerateLabels';

interface LabelPreviewProps {
  entry: Partial<LabelEntry>;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * WYSIWYG preview: renders the SAME label face the printer produces, onto a
 * canvas. Geometry is measured with an offscreen jsPDF doc (the exact engine the
 * PDF uses), so the preview matches the printed label — including the real QR,
 * Code 128 barcode, font fitting, and the codeless "fill the label" mode.
 */
export function LabelPreview({ entry }: LabelPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [codes] = useLabelCodeOptions();

  const layout = entry.layout ?? 'standard';
  const withQr = codes.withQr;
  const withBarcode = codes.withBarcode;

  useEffect(() => {
    let cancelled = false;

    const item: LabelItem = {
      sku: entry.sku ?? '',
      item_name: entry.itemName ?? null,
      short_code: '',
      public_token: '',
      extra: entry.extra ?? null,
      prefix: entry.prefix ?? null,
      layout,
      upc: entry.upc ?? null,
      color: entry.color ?? null,
      serial_number: entry.serialNumber ?? null,
      made_in: entry.madeIn ?? null,
      po_number: entry.poNumber ?? null,
      withQr,
      withBarcode,
    };

    const timer = setTimeout(async () => {
      const [{ default: jsPDF }, QRCode] = await Promise.all([import('jspdf'), import('qrcode')]);
      if (cancelled) return;

      // Offscreen doc used ONLY to measure text exactly like the printed PDF.
      const measureDoc = new jsPDF({ unit: 'in', format: [6, 4], orientation: 'landscape' });
      const measure = createJsPdfMeasurer(
        measureDoc as unknown as Parameters<typeof createJsPdfMeasurer>[0]
      );
      const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
      const face = computeLabelFace(item, measure, baseUrl);

      let qrImage: HTMLImageElement | null = null;
      if (face.withQr && face.qrPayload) {
        try {
          const dataUrl = await QRCode.toDataURL(face.qrPayload, {
            width: 400,
            margin: 1,
            errorCorrectionLevel: 'L',
          });
          if (cancelled) return;
          qrImage = await loadImage(dataUrl);
        } catch {
          qrImage = null;
        }
        if (cancelled) return;
      }

      const canvas = canvasRef.current;
      if (canvas) renderLabelFaceToCanvas(canvas, face, qrImage);
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    entry.sku,
    entry.itemName,
    entry.prefix,
    entry.extra,
    entry.upc,
    entry.color,
    entry.serialNumber,
    entry.madeIn,
    entry.poNumber,
    layout,
    withQr,
    withBarcode,
  ]);

  return (
    <div className="flex justify-center">
      <canvas
        ref={canvasRef}
        className="border border-gray-300 rounded-lg bg-white shadow-sm max-w-full"
      />
    </div>
  );
}
