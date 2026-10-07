import { describe, expect, it } from 'vitest';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  generateSdAs400ReviewDoc,
  sdAs400ReviewRows,
  type SdAs400ReviewLine,
} from '../generateSdAs400ReviewPdf';

const lines: SdAs400ReviewLine[] = [
  {
    sku: '01-2990',
    sd_number: 50,
    item_name: 'Renegade C1 56 S/D',
    serial_number: 'Y22G002555',
    as400_description: null,
    as400_serial: null,
    action: 'CREATE',
    reason: null,
  },
  {
    sku: '01-0370',
    sd_number: 1,
    item_name: 'HUDSON E2 18 Deep blue S/D',
    serial_number: 'Y22B008841',
    as400_description: 'S/D HUDSON E2 18 BLUE         Y21A003411',
    as400_serial: 'Y21A003411',
    action: 'UPDATE',
    reason: 'SERIAL OF Y21A003411',
  },
  {
    sku: '01-0169CO',
    sd_number: 62,
    item_name: 'COMET 58 TEAM RED S/D',
    serial_number: '01-0169CO',
    as400_description: 'S/D ALLEGRO A3 S/O 14" MING   G220310857',
    as400_serial: 'G220310857',
    action: 'UPDATE',
    reason: 'PICKD HAS NO SERIAL',
  },
];

describe('S/D AS400 review, 6×4', () => {
  it('creates first, then updates with the box serial; a placeholder serial is no serial', () => {
    const { create, update } = sdAs400ReviewRows(lines);
    expect(create).toEqual([['01-2990\n#50', 'Renegade C1 56 S/D', 'Y22G002555']]);
    expect(update[0]).toEqual([
      '01-0370\n#1',
      'S/D HUDSON E2 18 BLUE Y21A003411',
      'Y22B008841',
      'SERIAL OF Y21A003411',
    ]);
    expect(update[1][2]).toBe('—');
  });

  it('one page per section on a 6×4 landscape label', () => {
    const doc = generateSdAs400ReviewDoc(jsPDF, autoTable, lines);
    expect(doc.getNumberOfPages()).toBe(2);
    const { width, height } = doc.internal.pageSize;
    expect(Math.round(width)).toBe(152);
    expect(Math.round(height)).toBe(102);
  });
});
