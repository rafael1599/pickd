import {
  computeLabelFace,
  createJsPdfMeasurer,
  barcodeRects,
  type DrawOp,
  type LabelItem,
} from './labelLayout';

export type { LabelItem } from './labelLayout';

export const VALID_TRANSITIONS: Record<string, string[]> = {
  printed: ['in_stock'],
  in_stock: ['allocated', 'lost'],
  allocated: ['picked', 'in_stock'],
  picked: ['shipped'],
  shipped: [],
  lost: [],
};

type JsPdfDoc = {
  setFillColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setLineWidth(w: number): void;
  setFont(family: string, style: string): void;
  setFontSize(size: number): void;
  rect(x: number, y: number, w: number, h: number, style: string): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  text(text: string, x: number, y: number, opts?: { align: string }): void;
  addImage(data: string, fmt: string, x: number, y: number, w: number, h: number): void;
};

/** Render one computed label face to a jsPDF page (print path). */
function renderFaceToPdf(doc: JsPdfDoc, ops: DrawOp[], qrDataUrl: string | null): void {
  for (const op of ops) {
    switch (op.kind) {
      case 'rect': {
        const v = op.fill === 'black' ? 0 : 255;
        doc.setFillColor(v, v, v);
        doc.rect(op.x, op.y, op.w, op.h, 'F');
        break;
      }
      case 'line':
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(op.lineWidth);
        doc.line(op.x, op.y, op.x + op.w, op.y);
        break;
      case 'text': {
        doc.setFont('helvetica', op.style);
        doc.setFontSize(op.sizePt);
        const c = op.color === 'white' ? 255 : 0;
        doc.setTextColor(c, c, c);
        if (op.align === 'center') doc.text(op.text, op.x, op.y, { align: 'center' });
        else doc.text(op.text, op.x, op.y);
        break;
      }
      case 'barcode':
        doc.setFillColor(0, 0, 0);
        for (const r of barcodeRects(op.bars, op.x, op.y, op.w, op.h)) {
          doc.rect(r.x, r.y, r.w, r.h, 'F');
        }
        break;
      case 'qr':
        if (qrDataUrl) doc.addImage(qrDataUrl, 'PNG', op.x, op.y, op.size, op.size);
        break;
    }
  }
}

/**
 * 4×6" bike/part labels. Layout (font fitting, positions, codes) is computed by
 * the shared `computeLabelFace` engine — the same one the Label Studio preview
 * uses — so the on-screen preview matches the printed PDF exactly.
 *
 * QR and barcode are independent per item (`withQr` / `withBarcode`); `withCodes`
 * is the legacy single switch. With no QR the text fills the whole label.
 */
export async function generateBikeLabels(items: LabelItem[]): Promise<string> {
  const [{ default: jsPDF }, QRCode] = await Promise.all([import('jspdf'), import('qrcode')]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [6, 4] });
  const measure = createJsPdfMeasurer(doc as unknown as Parameters<typeof createJsPdfMeasurer>[0]);
  const baseUrl =
    typeof window !== 'undefined'
      ? import.meta.env.VITE_APP_URL || window.location.origin
      : 'https://roman-app.vercel.app';

  let isFirstPage = true;

  for (const item of items) {
    const face = computeLabelFace(item, measure, baseUrl);

    let qrDataUrl: string | null = null;
    if (face.withQr && face.qrPayload) {
      qrDataUrl = await QRCode.toDataURL(face.qrPayload, {
        width: 400,
        margin: 1,
        errorCorrectionLevel: 'L',
      });
    }

    const isVertical = item.layout === 'vertical';
    const orientation = isVertical ? 'portrait' : 'landscape';

    // Two copies per item.
    for (let copy = 0; copy < 2; copy++) {
      if (!isFirstPage) {
        doc.addPage([face.width, face.height], orientation);
      } else if (isVertical) {
        // The doc opens as a 6×4 landscape page; swap it for the portrait one.
        doc.deletePage(1);
        doc.addPage([face.width, face.height], orientation);
      }
      isFirstPage = false;
      renderFaceToPdf(doc as unknown as JsPdfDoc, face.ops, qrDataUrl);
    }
  }

  return doc.output('bloburl') as unknown as string;
}
