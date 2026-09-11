import { describe, expect, it } from 'vitest';
import {
  pendingResolutions,
  resolveLiveItem,
  resolveRowItems,
  sortByLocation,
  type LiveResolvable,
  type LiveStock,
} from '../liveResolution';

const stock = (over: Partial<LiveStock> = {}): LiveStock => ({
  preferredLocation: {},
  sublocations: {},
  totalStock: () => undefined,
  reservedElsewhere: () => 0,
  isRegistered: () => true,
  ...over,
});

const line = (
  sku: string,
  location: string | null,
  pickingQty = 1,
  extra: Partial<LiveResolvable> = {}
): LiveResolvable => ({ sku, location, warehouse: 'LUDLOW', pickingQty, ...extra });

describe('resolveLiveItem', () => {
  it('gives a line with no address the preferred shelf and its square', () => {
    const out = resolveLiveItem(
      line('03-4463BR', null),
      stock({
        preferredLocation: { '03-4463BR': 'ROW 28' },
        sublocations: { '03-4463BR-ROW 28': ['E'] },
      })
    );
    expect(out).toMatchObject({ location: 'ROW 28', sublocation: ['E'] });
  });

  it('leaves a line that already has an address where it is', () => {
    const out = resolveLiveItem(
      line('03-4463BR', 'ROW 27'),
      stock({ preferredLocation: { '03-4463BR': 'ROW 28' } })
    );
    expect(out).toBeNull();
  });

  it('clears LOW STOCK when the stock, less what others hold, covers the line', () => {
    const out = resolveLiveItem(
      line('12-9833', 'FDX STATION', 1, { insufficient_stock: true }),
      stock({ totalStock: () => 18, reservedElsewhere: () => 1 })
    );
    expect(out?.insufficient_stock).toBe(false);
  });

  it('keeps LOW STOCK when it does not', () => {
    const out = resolveLiveItem(
      line('12-9833', 'FDX STATION', 3, { insufficient_stock: true }),
      stock({ totalStock: () => 3, reservedElsewhere: () => 1 })
    );
    expect(out).toBeNull();
  });

  it('settles both at once: the 11 sep part, stock added while it had no address', () => {
    const out = resolveLiveItem(
      line('12-9833', null, 1, { insufficient_stock: true }),
      stock({ preferredLocation: { '12-9833': 'FDX STATION' }, totalStock: () => 18 })
    );
    expect(out).toMatchObject({ location: 'FDX STATION', insufficient_stock: false });
  });

  it('stops reading UNREG once the SKU has an inventory row', () => {
    const out = resolveLiveItem(
      line('01-0530', 'ROW 3', 1, { sku_not_found: true }),
      stock({ isRegistered: () => true })
    );
    expect(out?.sku_not_found).toBe(false);
  });
});

describe('resolveRowItems', () => {
  it('reports no change when the row already says what the stock says', () => {
    const items = [line('12-9833', 'FDX STATION')];
    const out = resolveRowItems(items, stock({ preferredLocation: { '12-9833': 'FDX STATION' } }));
    expect(out.changed).toBe(false);
    expect(out.items).toEqual(items);
  });

  it('resolves and keeps the row sorted by location', () => {
    const out = resolveRowItems(
      [line('03-4463BR', 'ROW 28'), line('12-9833', null)],
      stock({ preferredLocation: { '12-9833': 'FDX STATION' } })
    );
    expect(out.changed).toBe(true);
    expect(out.items.map((i) => i.location)).toEqual(['FDX STATION', 'ROW 28']);
  });
});

describe('pendingResolutions', () => {
  // The cart of 11 sep: #881513's bike and #881514's part, merged for display.
  const cart = [
    line('03-4463BR', 'ROW 28', 1, { source_list_id: 'row-513' }),
    line('12-9833', null, 1, { source_list_id: 'row-514', insufficient_stock: true }),
  ];
  const live = stock({ preferredLocation: { '12-9833': 'FDX STATION' }, totalStock: () => 18 });

  it('sends the part to the row it came from, not to the one on screen', () => {
    const out = pendingResolutions(cart, 'row-513', live, new Set());
    expect([...out.keys()]).toEqual(['row-514']);
  });

  it('falls back to the list on screen for a single order, whose lines carry no tag', () => {
    const out = pendingResolutions([line('12-9833', null)], 'row-514', live, new Set());
    expect([...out.keys()]).toEqual(['row-514']);
  });

  it('skips what is already settled — the echo that wrote #881513 120 times', () => {
    const first = pendingResolutions(cart, 'row-513', live, new Set());
    const settled = new Set(first.get('row-514'));
    expect(pendingResolutions(cart, 'row-513', live, settled).size).toBe(0);
  });

  it('asks again when the stock gives a different answer', () => {
    const first = pendingResolutions(cart, 'row-513', live, new Set());
    const settled = new Set(first.get('row-514'));
    const moved = stock({
      preferredLocation: { '12-9833': 'RETURN TO STOCK' },
      totalStock: () => 18,
    });
    expect([...pendingResolutions(cart, 'row-513', moved, settled).keys()]).toEqual(['row-514']);
  });
});

describe('sortByLocation', () => {
  it('orders rows numerically, then by first square', () => {
    const out = sortByLocation([
      line('A', 'ROW 10', 1, { sublocation: ['K'] }),
      line('B', 'ROW 9'),
      line('C', 'ROW 10', 1, { sublocation: ['J'] }),
    ]);
    expect(out.map((i) => i.sku)).toEqual(['B', 'C', 'A']);
  });
});
