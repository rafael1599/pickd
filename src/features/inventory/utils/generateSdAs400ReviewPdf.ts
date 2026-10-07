/**
 * The S/D AS400 review on 6×4" thermal labels, like History's AS400 Sync
 * (Rafael, 7 Oct 2026: «la quiero imprimible en 4x6 como en las otras
 * imprimibles que tenemos»). What to type in AS400 for the S/D on the floor,
 * from `v_sd_as400_review` (idea-257 P3): the numbers to CREATE, then the
 * descriptions to UPDATE with the serial on the box. Black & white only.
 */
import { guardPdfText } from '../../../utils/pdfText';
import { sdCode } from '../../../utils/sdCode';

export interface SdAs400ReviewLine {
  sku: string;
  sd_number: number | null;
  item_name: string | null;
  serial_number: string | null;
  as400_description: string | null;
  as400_serial: string | null;
  action: string;
  reason: string | null;
}

// 6×4" landscape thermal label (copied from generateDailyHistoryPdf.ts).
const PAGE_W = 152.4;
const PAGE_H = 101.6;
const MARGIN = 3;

type Doc = InstanceType<typeof import('jspdf').default>;
type AutoTable = typeof import('jspdf-autotable').default;
type CellStyles = Partial<import('jspdf-autotable').Styles>;

const num = (n: number | null) => (n == null ? '' : `#${sdCode(n)}`);
const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
/** A serial PickD only holds as a placeholder (the SKU without its dash) is no serial. */
const realSerial = (l: SdAs400ReviewLine) => {
  const s = clean(l.serial_number).toUpperCase();
  return s && s !== l.sku.replace(/[^A-Za-z0-9]/g, '').toUpperCase() && s !== l.sku ? s : '';
};

export function sdAs400ReviewRows(lines: readonly SdAs400ReviewLine[]) {
  const create = lines
    .filter((l) => l.action === 'CREATE')
    .map((l) => [`${l.sku}\n${num(l.sd_number)}`, clean(l.item_name), realSerial(l) || '—']);
  const update = lines
    .filter((l) => l.action === 'UPDATE')
    .map((l) => [
      `${l.sku}\n${num(l.sd_number)}`,
      clean(l.as400_description),
      realSerial(l) || '—',
      clean(l.reason),
    ]);
  return { create, update };
}

export function generateSdAs400ReviewDoc(
  jsPDFInstance: typeof import('jspdf').default,
  autoTable: AutoTable,
  lines: readonly SdAs400ReviewLine[],
  now = new Date()
): Doc {
  const doc = new jsPDFInstance({ orientation: 'landscape', unit: 'mm', format: [PAGE_W, PAGE_H] });
  guardPdfText(doc);
  const { create, update } = sdAs400ReviewRows(lines);
  const date = now.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const REG = 11;
  const styles: CellStyles = {
    font: 'helvetica',
    fontSize: REG,
    cellPadding: 0.8,
    textColor: [0, 0, 0],
    lineColor: [0, 0, 0],
    lineWidth: 0.25,
    valign: 'middle',
  };
  const headStyles: CellStyles = {
    fontStyle: 'bold',
    fontSize: REG,
    fillColor: [255, 255, 255],
    textColor: [0, 0, 0],
    lineWidth: 0.3,
  };
  const margin = { left: MARGIN, right: MARGIN, top: MARGIN + 12, bottom: MARGIN };

  const header = (subtitle: string) => {
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('S/D · AS400 review', MARGIN, MARGIN + 4.5);
    doc.text(
      `${lines.length} ${lines.length === 1 ? 'LINE' : 'LINES'}`,
      PAGE_W - MARGIN,
      MARGIN + 4.5,
      {
        align: 'right',
      }
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(REG);
    doc.text(subtitle, MARGIN, MARGIN + 9.5);
  };

  if (lines.length === 0) {
    header(`${date} · nothing to change in AS400`);
    return doc;
  }

  let first = true;
  const section = (
    subtitle: string,
    head: string[],
    body: string[][],
    columnStyles: Record<number, CellStyles>
  ) => {
    if (!body.length) return;
    if (!first) doc.addPage();
    first = false;
    header(subtitle);
    autoTable(doc, {
      startY: MARGIN + 12,
      margin,
      head: [head],
      body,
      theme: 'grid',
      styles,
      headStyles,
      columnStyles,
      didDrawPage: (data) => {
        if (data.pageNumber > 1) header(`${subtitle} (cont.)`);
      },
    });
  };

  section(
    `${date} · CREATE these numbers in AS400 (${create.length})`,
    ['SKU', 'NAME', 'SERIAL ON BOX'],
    create,
    {
      0: { fontStyle: 'bold', cellWidth: 26 },
      2: { fontStyle: 'bold', cellWidth: 32 },
    }
  );
  section(
    `${date} · UPDATE description and serial (${update.length})`,
    ['SKU', 'AS400 SAYS', 'BOX SERIAL', 'WHY'],
    update,
    {
      0: { fontStyle: 'bold', cellWidth: 24 },
      2: { fontStyle: 'bold', cellWidth: 28 },
      3: { cellWidth: 26, fontSize: REG - 2 },
    }
  );
  return doc;
}
