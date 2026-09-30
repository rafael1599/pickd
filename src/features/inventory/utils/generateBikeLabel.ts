import {
  computeLabelFace,
  computeSdNumberFace,
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
 * 6×4" bike/part labels. Layout (font fitting, positions, codes) is computed by
 * the shared `computeLabelFace` engine.
 *
 * Every label is horizontal with its QR and its Code 128 (Rafael, 30 Sep 2026:
 * "todos los labels se imprimirán en horizontal ahora, con su serial y qr"); the
 * item's own layout / code switches are ignored. A S/D unit prints its label
 * once and then a page with its number (`#n`); anything else prints two copies.
 */
export async function generateBikeLabels(items: LabelItem[]): Promise<string> {
  const [{ default: jsPDF }, QRCode] = await Promise.all([import('jspdf'), import('qrcode')]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [6, 4] });
  const measure = createJsPdfMeasurer(doc as unknown as Parameters<typeof createJsPdfMeasurer>[0]);
  const baseUrl =
    typeof window !== 'undefined'
      ? import.meta.env.VITE_APP_URL || window.location.origin
      : 'https://app.pickd.cloud';

  let isFirstPage = true;
  const newPage = (width: number, height: number) => {
    if (!isFirstPage) doc.addPage([width, height], 'landscape');
    isFirstPage = false;
  };

  for (const raw of items) {
    const item: LabelItem = {
      ...raw,
      layout: 'standard',
      withQr: true,
      withBarcode: true,
      withCodes: true,
    };
    const face = computeLabelFace(item, measure, baseUrl);

    let qrDataUrl: string | null = null;
    if (face.withQr && face.qrPayload) {
      qrDataUrl = await QRCode.toDataURL(face.qrPayload, {
        width: 400,
        margin: 1,
        errorCorrectionLevel: 'L',
      });
    }

    if (item.sd_number != null) {
      newPage(face.width, face.height);
      renderFaceToPdf(doc as unknown as JsPdfDoc, face.ops, qrDataUrl);
      newPage(face.width, face.height);
      renderFaceToPdf(
        doc as unknown as JsPdfDoc,
        computeSdNumberFace(item.sd_number, measure),
        null
      );
      continue;
    }

    for (let copy = 0; copy < 2; copy++) {
      newPage(face.width, face.height);
      renderFaceToPdf(doc as unknown as JsPdfDoc, face.ops, qrDataUrl);
    }
  }

  return doc.output('bloburl') as unknown as string;
}
