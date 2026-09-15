import { describe, it, expect } from 'vitest';
import {
  buildSkuLabelEntry,
  pickItemName,
  type SkuLabelMetadata,
  type SkuLabelRequest,
} from '../skuLabelEntry';

const req: SkuLabelRequest = {
  sku: '03-4149BR',
  location: 'ROW 37',
  stock: 1,
  quantity: 1,
  layout: 'vertical',
  withQr: true,
  withBarcode: false,
  withUpc: false,
};

const meta: SkuLabelMetadata = {
  color: 'COPPER TONE',
  size: '48',
  model: 'RENEGADE S2',
  upc: '845436091594',
  serial_number: null,
  category: null,
  is_bike: true,
};

describe('buildSkuLabelEntry (idea-212)', () => {
  it('always carries the color and size, whatever screen asked', () => {
    const e = buildSkuLabelEntry(req, meta, 'RENEGADE S2 48 COPPER TONE');
    expect(e.color).toBe('COPPER TONE');
    expect(e.size).toBe('48');
    expect(e.itemName).toBe('RENEGADE S2 48 COPPER TONE');
  });

  it('keeps the UPC on the tag and prints it only when asked', () => {
    expect(buildSkuLabelEntry(req, meta, null)).toMatchObject({
      upc: '845436091594',
      withUpc: false,
    });
    expect(buildSkuLabelEntry({ ...req, withUpc: true }, meta, null).withUpc).toBe(true);
  });

  it('a value typed and not saved wins; an empty one does not erase the stored one', () => {
    const e = buildSkuLabelEntry(
      { ...req, overrides: { color: 'Copper', itemName: '  ', size: '' } },
      meta,
      'RENEGADE S2 48 COPPER TONE'
    );
    expect(e.color).toBe('Copper');
    expect(e.itemName).toBe('RENEGADE S2 48 COPPER TONE');
    expect(e.size).toBe('48');
  });

  it('a frame keeps its category so its size prints as a frame size', () => {
    const e = buildSkuLabelEntry(req, { ...meta, category: 'frame', is_bike: false }, null);
    expect(e.category).toBe('frame');
    expect(e.isBike).toBe(false);
  });

  it('with no catalogue row it still prints the SKU', () => {
    const e = buildSkuLabelEntry(req, null, null);
    expect(e).toMatchObject({ sku: '03-4149BR', color: null, upc: null, itemName: null });
  });
});

describe('pickItemName', () => {
  const rows = [
    { item_name: 'RENEGADE S2 48 2026 COPPER TONE', location: 'ROW 38', quantity: 5 },
    { item_name: 'RENEGADE S2 48 COPPER TONE', location: 'ROW 37', quantity: 1 },
    { item_name: null, location: 'RETURN TO STOCK', quantity: 0 },
  ];

  it('prefers the row being printed', () => {
    expect(pickItemName(rows, 'row 37')).toBe('RENEGADE S2 48 COPPER TONE');
  });

  it('else the row with the most units', () => {
    expect(pickItemName(rows, 'RETURN TO STOCK')).toBe('RENEGADE S2 48 2026 COPPER TONE');
    expect(pickItemName(rows, null)).toBe('RENEGADE S2 48 2026 COPPER TONE');
  });

  it('no named row → null', () => {
    expect(pickItemName([{ item_name: ' ', location: 'X', quantity: 1 }], 'X')).toBeNull();
  });
});
