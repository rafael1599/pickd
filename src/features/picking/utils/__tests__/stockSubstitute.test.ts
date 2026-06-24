import { describe, it, expect } from 'vitest';
import { pickBestStockRow, type StockRow } from '../stockSubstitute';

const row = (over: Partial<StockRow>): StockRow => ({
  sku: '03-3768BLD',
  location: 'ROW 43',
  warehouse: 'LUDLOW',
  item_name: 'DIVIDE S/O 12X27 2025 RIPTIDE',
  quantity: 155,
  ...over,
});

describe('pickBestStockRow', () => {
  it('returns null when no row for the SKU has stock', () => {
    const rows = [
      row({ sku: '03-3768BLD', quantity: 0, location: 'ROW 41' }),
      row({ sku: '03-3768BLD', quantity: 0, location: 'FLORIDA' }),
    ];
    expect(pickBestStockRow(rows, '03-3768BLD', 'LUDLOW')).toBeNull();
  });

  it('picks the in-stock row with the most units', () => {
    const rows = [
      row({ quantity: 0, location: 'ROW 41' }),
      row({ quantity: 155, location: 'ROW 43' }),
      row({ quantity: 12, location: 'ROW 9' }),
    ];
    const best = pickBestStockRow(rows, '03-3768BLD', 'LUDLOW');
    expect(best?.location).toBe('ROW 43');
    expect(best?.quantity).toBe(155);
  });

  it('ignores rows for other SKUs', () => {
    const rows = [
      row({ sku: '03-3768BL', quantity: 999 }),
      row({ sku: '03-3768BLD', quantity: 155 }),
    ];
    const best = pickBestStockRow(rows, '03-3768BLD', 'LUDLOW');
    expect(best?.sku).toBe('03-3768BLD');
    expect(best?.quantity).toBe(155);
  });

  it('ignores rows in a different warehouse', () => {
    const rows = [
      row({ warehouse: 'ATS', quantity: 999 }),
      row({ warehouse: 'LUDLOW', quantity: 155 }),
    ];
    const best = pickBestStockRow(rows, '03-3768BLD', 'LUDLOW');
    expect(best?.warehouse).toBe('LUDLOW');
    expect(best?.quantity).toBe(155);
  });
});
