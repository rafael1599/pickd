import { useEffect, useMemo, useRef, useState } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus';
import {
  computeLabelFace,
  createJsPdfMeasurer,
  type LabelFace,
  type LabelField,
  type LabelItem,
} from '../../inventory/utils/labelLayout';
import { renderLabelFaceToCanvas } from '../utils/renderLabelCanvas';
import type { LabelEntry } from '../hooks/useGenerateLabels';

const MAX_PPI = 64;
const MAX_H = 300;

interface LabelPreviewProps {
  entry: Partial<LabelEntry>;
  /** Tap on a label field → edit it (SKU-level routes to Item Detail upstream). */
  onEditField?: (field: LabelField) => void;
  /** The "＋" button → add label data (per-tag fields). */
  onAddData?: () => void;
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
 * WYSIWYG preview that doubles as the editor: it renders the exact printed label
 * (same engine as the PDF) on a canvas, and overlays invisible tap-zones on each
 * editable field so a tap maps back to that field. Sizes to its container so the
 * tap-zones (which share the computed PPI) always line up with the canvas.
 */
export function LabelPreview({ entry, onEditField, onAddData }: LabelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [face, setFace] = useState<LabelFace | null>(null);
  const [qrImage, setQrImage] = useState<HTMLImageElement | null>(null);
  const [availW, setAvailW] = useState(0);

  const layout = entry.layout ?? 'standard';
  const withQr = entry.withQr ?? true;
  const withBarcode = entry.withBarcode ?? true;

  // Track the available width so the label scales to fit (mobile-friendly).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setAvailW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute the label face + QR image whenever the content changes.
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

      const measureDoc = new jsPDF({ unit: 'in', format: [6, 4], orientation: 'landscape' });
      const measure = createJsPdfMeasurer(
        measureDoc as unknown as Parameters<typeof createJsPdfMeasurer>[0]
      );
      const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
      const computed = computeLabelFace(item, measure, baseUrl);
      if (cancelled) return;
      setFace(computed);

      if (computed.withQr && computed.qrPayload) {
        try {
          const dataUrl = await QRCode.toDataURL(computed.qrPayload, {
            width: 400,
            margin: 1,
            errorCorrectionLevel: 'L',
          });
          if (cancelled) return;
          setQrImage(await loadImage(dataUrl));
        } catch {
          if (!cancelled) setQrImage(null);
        }
      } else if (!cancelled) {
        setQrImage(null);
      }
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

  const ppi = useMemo(() => {
    if (!face || availW <= 0) return 0;
    return Math.max(24, Math.min(MAX_PPI, availW / face.width, MAX_H / face.height));
  }, [face, availW]);

  // Draw the canvas at the current PPI.
  useEffect(() => {
    if (!face || ppi <= 0) return;
    const canvas = canvasRef.current;
    if (canvas) renderLabelFaceToCanvas(canvas, face, qrImage, ppi);
  }, [face, qrImage, ppi]);

  const cssW = face ? face.width * ppi : 0;
  const cssH = face ? face.height * ppi : 0;

  return (
    <div ref={containerRef} className="w-full flex flex-col items-center gap-2">
      <div className="relative" style={{ width: cssW || undefined, height: cssH || undefined }}>
        <canvas
          ref={canvasRef}
          className="border border-gray-300 rounded-lg bg-white shadow-sm block"
        />

        {/* Tap-zones over each editable field */}
        {ppi > 0 &&
          face?.regions.map((r) => (
            <button
              key={r.field}
              type="button"
              onClick={() => onEditField?.(r.field)}
              title="Tap to edit"
              className="absolute rounded-sm hover:bg-accent/15 hover:ring-1 hover:ring-accent/50 active:bg-accent/25 transition-colors"
              style={{
                left: r.x * ppi - 3,
                top: r.y * ppi - 2,
                width: r.w * ppi + 6,
                height: r.h * ppi + 4,
              }}
            />
          ))}

        {/* Add label data */}
        {onAddData && cssW > 0 && (
          <button
            type="button"
            onClick={onAddData}
            title="Add label data"
            className="absolute -bottom-2 -right-2 w-9 h-9 rounded-full bg-accent text-main flex items-center justify-center shadow-lg active:scale-90 transition-all"
          >
            <Plus size={18} strokeWidth={3} />
          </button>
        )}
      </div>
      <p className="text-[10px] text-muted text-center">
        Tap a value to edit · <span className="text-accent font-bold">＋</span> add label data
      </p>
    </div>
  );
}
