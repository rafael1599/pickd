import { describe, it, expect } from 'vitest';
import {
  classifyLowStock,
  getDayOfWeek,
  getLowStockWindow,
  type LowStockSkuRow,
} from '../lowStockWindow';

// Reference: 2026-04-20 is a Monday (dow=1), 2026-04-24 is a Friday (dow=5),
// 2026-04-25 is a Saturday (dow=6).

describe('getDayOfWeek', () => {
  it('returns 1 for Monday 2026-04-20', () => {
    expect(getDayOfWeek('2026-04-20')).toBe(1);
  });
  it('returns 5 for Friday 2026-04-24', () => {
    expect(getDayOfWeek('2026-04-24')).toBe(5);
  });
  it('returns 0 for Sunday 2026-04-26', () => {
    expect(getDayOfWeek('2026-04-26')).toBe(0);
  });
});

describe('getLowStockWindow', () => {
  it('is a single-day window on Monday', () => {
    expect(getLowStockWindow('2026-04-20')).toEqual({
      startDate: '2026-04-20',
      endDate: '2026-04-20',
      label: 'Today',
    });
  });

  it('is a single-day window on Thursday', () => {
    expect(getLowStockWindow('2026-04-23')).toEqual({
      startDate: '2026-04-23',
      endDate: '2026-04-23',
      label: 'Today',
    });
  });

  it('spans Mon-Fri on Friday and labels it "This week"', () => {
    expect(getLowStockWindow('2026-04-24')).toEqual({
      startDate: '2026-04-20',
      endDate: '2026-04-24',
      label: 'This week',
    });
  });

  it('falls back to single-day on Saturday', () => {
    expect(getLowStockWindow('2026-04-25')).toEqual({
      startDate: '2026-04-25',
      endDate: '2026-04-25',
      label: 'Today',
    });
  });

  it('falls back to single-day on Sunday', () => {
    expect(getLowStockWindow('2026-04-26')).toEqual({
      startDate: '2026-04-26',
      endDate: '2026-04-26',
      label: 'Today',
    });
  });
});

describe('classifyLowStock', () => {
  const row = (sku: string, qty: number): LowStockSkuRow => ({
    sku,
    item_name: `Item ${sku}`,
    remaining_qty: qty,
    completions: [],
  });

  it('buckets qty=0 into outOfStock and qty=1 into lastUnit', () => {
    const r = classifyLowStock([row('A', 0), row('B', 1), row('C', 2), row('D', 0)]);
    expect(r.outOfStock.map((x) => x.sku)).toEqual(['A', 'D']);
    expect(r.lastUnit.map((x) => x.sku)).toEqual(['B']);
  });

  it('drops rows with qty > 1', () => {
    const r = classifyLowStock([row('A', 5), row('B', 2), row('C', 10)]);
    expect(r.outOfStock).toEqual([]);
    expect(r.lastUnit).toEqual([]);
  });

  it('ignores negative (defensive) and non-matching qty', () => {
    const r = classifyLowStock([row('A', -1), row('B', 3)]);
    expect(r.outOfStock).toEqual([]);
    expect(r.lastUnit).toEqual([]);
  });

  it('sorts each bucket by SKU', () => {
    const r = classifyLowStock([row('Z', 0), row('A', 0), row('M', 1), row('B', 1)]);
    expect(r.outOfStock.map((x) => x.sku)).toEqual(['A', 'Z']);
    expect(r.lastUnit.map((x) => x.sku)).toEqual(['B', 'M']);
  });

  it('returns empty arrays for empty input', () => {
    expect(classifyLowStock([])).toEqual({ outOfStock: [], lastUnit: [] });
  });
});
