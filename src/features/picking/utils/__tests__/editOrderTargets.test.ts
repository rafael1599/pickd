import { describe, expect, it } from 'vitest';
import {
  buildOrderTabs,
  defaultAddTarget,
  rowOfLine,
  type OrderTaggedLine,
} from '../editOrderTargets';

type Line = OrderTaggedLine & { sku: string };

// A group of two FedEx orders that both ordered the same part.
const orders = new Map([
  ['881513', 'row-513'],
  ['881514', 'row-514'],
]);
const bike: Line = { sku: '03-4463BR', source_order: '881513', source_list_id: 'row-513' };
const partOf513: Line = { sku: '12-9833', source_order: '881513', source_list_id: 'row-513' };
const partOf514: Line = { sku: '12-9833', source_order: '881514', source_list_id: 'row-514' };

describe('rowOfLine', () => {
  it('reads the row off the line itself, so a shared SKU goes to its own order', () => {
    expect(rowOfLine(partOf513, orders, 'row-513')).toBe('row-513');
    expect(rowOfLine(partOf514, orders, 'row-513')).toBe('row-514');
  });

  it('falls back to the order number when the line carries no row', () => {
    expect(rowOfLine({ source_order: '881514' }, orders, 'row-513')).toBe('row-514');
  });

  it('falls back to the list being edited for a single order', () => {
    expect(rowOfLine({}, new Map(), 'row-solo')).toBe('row-solo');
  });
});

describe('buildOrderTabs', () => {
  it('gives each order its lines and its issues, newest number first', () => {
    const tabs = buildOrderTabs(
      [bike, partOf513, partOf514],
      new Set([partOf514]),
      orders,
      'row-513'
    );
    expect(tabs).toEqual([
      { rowId: 'row-514', orderNumber: '881514', lines: 1, issues: 1 },
      { rowId: 'row-513', orderNumber: '881513', lines: 2, issues: 0 },
    ]);
  });

  it('keeps the tab of an order with no lines left, so something can be added to it', () => {
    const tabs = buildOrderTabs([bike], new Set(), orders, 'row-513');
    expect(tabs.find((t) => t.orderNumber === '881514')?.lines).toBe(0);
  });
});

describe('defaultAddTarget', () => {
  const tabs = buildOrderTabs([bike, partOf514], new Set(), orders, 'row-513');

  it('is the order on screen', () => {
    expect(defaultAddTarget('row-514', tabs)).toBe('row-514');
  });

  it('is nobody while every order is on screen — that is when the operator is asked', () => {
    expect(defaultAddTarget(null, tabs)).toBeNull();
  });

  it('is the only order when there is one', () => {
    const single = buildOrderTabs([bike], new Set(), new Map([['881513', 'row-513']]), 'row-513');
    expect(defaultAddTarget(null, single)).toBe('row-513');
  });
});
