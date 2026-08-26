import { describe, it, expect } from 'vitest';
import { diagnoseStockIssue, type StockIssueInput } from '../stockIssue';
import { toPickingOrderMap } from '../pickLocation';

const base = (over: Partial<StockIssueInput> = {}): StockIssueInput => ({
  sku: '03-3768BLD',
  pickingQty: 1,
  warehouse: 'LUDLOW',
  registered: true,
  rows: [],
  reservedElsewhere: 0,
  ...over,
});

describe('diagnoseStockIssue', () => {
  // 2026-08-26, order 881288: 03-3768BLD ordered, 0 under that name, 145 on
  // ROW 43 under 03-3768BL. The one case that resolves itself.
  it('auto-swaps to the sibling that covers the line', () => {
    const issue = diagnoseStockIssue(
      base({
        rows: [{ location: 'FLORIDA', warehouse: 'LUDLOW', quantity: 0 }],
        siblingRows: [
          { sku: '03-3768BL', location: 'ROW 43', warehouse: 'LUDLOW', quantity: 145 },
          { sku: '03-3768BLD', location: 'FLORIDA', warehouse: 'LUDLOW', quantity: 0 },
        ],
      })
    );
    expect(issue.kind).toBe('auto_swap');
    if (issue.kind === 'auto_swap') {
      expect(issue.to.sku).toBe('03-3768BL');
      expect(issue.headline).toBe('Same bike under 03-3768BL: 145 in ROW 43');
    }
  });

  it('says ok when live stock covers the line, whatever the badge said', () => {
    const issue = diagnoseStockIssue(
      base({ pickingQty: 2, rows: [{ location: 'ROW 43', warehouse: 'LUDLOW', quantity: 5 }] })
    );
    expect(issue.kind).toBe('ok');
  });

  it('names an unregistered SKU and still points at the closest stock', () => {
    const issue = diagnoseStockIssue(
      base({
        sku: '01-0530',
        registered: false,
        similar: { sku: '01-0529', location: 'ROW 22', quantity: 1, item_name: 'Allegro' },
      })
    );
    expect(issue.kind).toBe('unregistered');
    if (issue.kind === 'unregistered') {
      expect(issue.headline).toBe('Not in PickD — this SKU has no catalog entry');
      expect(issue.detail).toBe('Closest match with stock: 01-0529 · 1 in ROW 22');
      expect(issue.similar?.sku).toBe('01-0529');
    }
  });

  it('distinguishes "registered, nothing anywhere" from "not registered"', () => {
    const issue = diagnoseStockIssue(
      base({ rows: [{ location: 'ROW 41', warehouse: 'LUDLOW', quantity: 0 }] })
    );
    expect(issue.kind).toBe('no_stock');
    if (issue.kind === 'no_stock')
      expect(issue.headline).toBe('Registered, but 0 units in any location');
  });

  it('reports units that exist but are held by other open orders, naming them', () => {
    const issue = diagnoseStockIssue(
      base({
        pickingQty: 2,
        rows: [{ location: 'ROW 41', warehouse: 'LUDLOW', quantity: 3 }],
        reservedElsewhere: 3,
        reservingOrders: ['881290', '881291'],
      })
    );
    expect(issue.kind).toBe('reserved');
    if (issue.kind === 'reserved') {
      expect(issue.headline).toBe(
        '3 on the shelf — ROW 41 (3) — but 3 already reserved by 881290, 881291'
      );
      expect(issue.detail).toBe('None left for this order');
      expect(issue.orders).toEqual(['881290', '881291']);
    }
  });

  it('reports a partial pick with the shelves and what is reserved', () => {
    const issue = diagnoseStockIssue(
      base({
        pickingQty: 5,
        rows: [
          { location: 'ROW 43', warehouse: 'LUDLOW', quantity: 2 },
          { location: 'ROW 9', warehouse: 'LUDLOW', quantity: 1 },
          { location: 'ATS-E1', warehouse: 'ATS', quantity: 40 }, // other warehouse: not ours
        ],
        reservedElsewhere: 1,
        reservingOrders: ['881290'],
      })
    );
    expect(issue.kind).toBe('partial');
    if (issue.kind === 'partial') {
      expect(issue.available).toBe(2);
      expect(issue.headline).toBe('Only 2 available of 5 — ROW 43 (2), ROW 9 (1)');
      expect(issue.detail).toBe('1 of the 3 reserved by 881290');
    }
  });

  it('offers a sibling that has some stock but not enough, without swapping', () => {
    const issue = diagnoseStockIssue(
      base({
        pickingQty: 5,
        rows: [{ location: 'ROW 41', warehouse: 'LUDLOW', quantity: 0 }],
        siblingRows: [{ sku: '03-3768BL', location: 'ROW 43', warehouse: 'LUDLOW', quantity: 2 }],
      })
    );
    expect(issue.kind).toBe('no_stock');
    if (issue.kind === 'no_stock') {
      expect(issue.sibling?.sku).toBe('03-3768BL');
      expect(issue.detail).toBe('Same bike under 03-3768BL: 2 in ROW 43 (need 5)');
    }
  });

  it('never treats the SKU itself or another colour as a sibling', () => {
    const issue = diagnoseStockIssue(
      base({
        rows: [{ location: 'ROW 41', warehouse: 'LUDLOW', quantity: 0 }],
        siblingRows: [
          { sku: '03-3768BLD', location: 'ROW 43', warehouse: 'LUDLOW', quantity: 50 },
          { sku: '03-3768BK', location: 'ROW 43', warehouse: 'LUDLOW', quantity: 50 },
        ],
      })
    );
    expect(issue.kind).toBe('no_stock');
    if (issue.kind === 'no_stock') expect(issue.sibling).toBeNull();
  });

  it('keeps a buried pallet out of the auto-swap while a shelf covers the line', () => {
    const order = toPickingOrderMap([
      { warehouse: 'LUDLOW', location: 'ROW 42 BURIED', picking_order: 9999 },
      { warehouse: 'LUDLOW', location: 'ROW 43', picking_order: 43 },
    ]);
    const issue = diagnoseStockIssue(
      base({
        pickingQty: 2,
        rows: [],
        pickingOrder: order,
        siblingRows: [
          { sku: '03-3768BL', location: 'ROW 42 BURIED', warehouse: 'LUDLOW', quantity: 100 },
          { sku: '03-3768BLT', location: 'ROW 43', warehouse: 'LUDLOW', quantity: 5 },
        ],
      })
    );
    expect(issue.kind).toBe('auto_swap');
    if (issue.kind === 'auto_swap') expect(issue.to.location).toBe('ROW 43');
  });
});
