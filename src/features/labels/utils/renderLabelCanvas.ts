import { barcodeRects, type LabelFace, type FontStyle } from '../../inventory/utils/labelLayout';

const PT_TO_IN = 1 / 72;

function fontFor(style: FontStyle, px: number): string {
  const weight = style === 'normal' ? 'normal' : 'bold';
  const italic = style === 'bolditalic' ? 'italic ' : '';
  // jsPDF prints Helvetica; mirror it so the canvas matches the PDF.
  return `${italic}${weight} ${px}px Helvetica, Arial, sans-serif`;
}

/**
 * Draw a computed label face onto a canvas at `ppi` pixels-per-inch. Consumes
 * the SAME `DrawOp`s the print path renders to jsPDF (with geometry measured by
 * an offscreen jsPDF doc), so the preview matches the printed PDF.
 */
export function renderLabelFaceToCanvas(
  canvas: HTMLCanvasElement,
  face: LabelFace,
  qrImage: HTMLImageElement | null,
  ppi = 56
): void {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = face.width * ppi;
  const cssH = face.height * ppi;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const s = ppi;

  // White page (the first op is the background rect, but clear anyway).
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cssW, cssH);

  for (const op of face.ops) {
    switch (op.kind) {
      case 'rect':
        ctx.fillStyle = op.fill === 'black' ? '#000' : '#fff';
        ctx.fillRect(op.x * s, op.y * s, op.w * s, op.h * s);
        break;
      case 'line':
        ctx.strokeStyle = '#000';
        ctx.lineWidth = Math.max(1, op.lineWidth * s);
        ctx.beginPath();
        ctx.moveTo(op.x * s, op.y * s);
        ctx.lineTo((op.x + op.w) * s, op.y * s);
        ctx.stroke();
        break;
      case 'text':
        ctx.fillStyle = op.color === 'white' ? '#fff' : '#000';
        ctx.font = fontFor(op.style, op.sizePt * PT_TO_IN * s);
        ctx.textAlign = op.align === 'center' ? 'center' : 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(op.text, op.x * s, op.y * s);
        break;
      case 'barcode':
        ctx.fillStyle = '#000';
        for (const r of barcodeRects(op.bars, op.x, op.y, op.w, op.h)) {
          ctx.fillRect(r.x * s, r.y * s, r.w * s, r.h * s);
        }
        break;
      case 'qr':
        if (qrImage) {
          ctx.drawImage(qrImage, op.x * s, op.y * s, op.size * s, op.size * s);
        }
        break;
    }
  }
}
