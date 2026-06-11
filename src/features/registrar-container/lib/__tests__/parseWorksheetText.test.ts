import { describe, it, expect } from 'vitest';
import { parseWorksheetText } from '../parseWorksheetText';

// The real PO 6430N worksheet text (Oyama Factory), as pdfjs extracts it.
const PO_6430N = `2026 Purchase Order Worksheet
Oyama Factory
PO #: 6430N
RECEIVED QTY SKU Size
TAXI PARTS
75 12 - 8341 BL Taxi Part Chainguard 24"
75 12 - 8309 BK Taxi Part Chainguard 24"
150 12 - 8342 BL Taxi Part Chainguard 26"
450 12 - 8324 BK Taxi Part Chainguard 26"
150 12 - 8324 KW Taxi Part Chainguard 26"
100 12 - 8314 Taxi Part Crank Arm 26/24"
20 12 - 8316 Taxi Part Handlebar 26/24"
50 12 - 8339 KW Taxi Part Fork 26"
0 2065 Notes:`;

describe('parseWorksheetText', () => {
  it('extracts the PO number', () => {
    expect(parseWorksheetText(PO_6430N).name).toBe('PO 6430N');
  });

  it('rebuilds canonical SKUs with and without a color', () => {
    const { items } = parseWorksheetText(PO_6430N);
    const bySku = Object.fromEntries(items.map((i) => [i.sku, i.qty]));
    expect(bySku['12-8341BL']).toBe(75);
    expect(bySku['12-8324BK']).toBe(450);
    expect(bySku['12-8324KW']).toBe(150); // same number, different color → distinct SKU
    expect(bySku['12-8314']).toBe(100); // no color
    expect(bySku['12-8339KW']).toBe(50);
  });

  it('captures the item name and tags every line with the PO', () => {
    const item = parseWorksheetText(PO_6430N).items.find((i) => i.sku === '12-8341BL');
    expect(item?.itemName).toBe('Taxi Part Chainguard 24"');
    expect(item?.po).toBe('6430N');
  });

  it('skips headers and the totals/notes row (qty 0)', () => {
    const { items, total } = parseWorksheetText(PO_6430N);
    expect(items).toHaveLength(8); // the 8 part lines, not the headers / '0 2065 Notes:'
    expect(total).toBe(75 + 75 + 150 + 450 + 150 + 100 + 20 + 50);
    expect(items.some((i) => i.sku.includes('2065'))).toBe(false);
  });

  it('does not mistake a mixed-case name word for a color', () => {
    const item = parseWorksheetText('PO #: 1000N\n100 12 - 8314 Taxi Part Crank Arm').items[0];
    expect(item.sku).toBe('12-8314'); // "Taxi" not consumed as a color
    expect(item.itemName).toBe('Taxi Part Crank Arm');
  });
});
