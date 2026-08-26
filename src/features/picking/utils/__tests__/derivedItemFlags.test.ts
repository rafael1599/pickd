import { describe, it, expect } from 'vitest';
import { mergeDerivedItemFlags } from '../derivedItemFlags';

interface LocalItem {
  sku: string;
  pickingQty: number;
  picked: boolean;
  location: string;
  sku_not_found?: boolean;
}

const item = (sku: string, over: Partial<LocalItem> = {}): LocalItem => ({
  sku,
  pickingQty: 1,
  picked: false,
  location: 'ROW 43',
  ...over,
});

describe('mergeDerivedItemFlags', () => {
  // 2026-08-26: 010517 registered from Double Check while order 881294 still
  // carried sku_not_found=true from intake. The DB re-stamps the row; the open
  // session has to take the flag from it.
  it('clears a stale not-found once the row says the SKU is registered', () => {
    const local = [item('010517', { sku_not_found: true }), item('03-4665GN')];
    const merged = mergeDerivedItemFlags(local, [
      { sku: '010517', sku_not_found: false },
      { sku: '03-4665GN', sku_not_found: false },
    ]);
    expect(merged?.[0].sku_not_found).toBe(false);
    expect(merged?.[1]).toBe(local[1]); // untouched objects keep identity
  });

  it('raises the flag when the DB says the SKU is not in the catalog', () => {
    // A hand-added item under a SKU nobody registered used to carry false.
    const merged = mergeDerivedItemFlags(
      [item('01-9999XX')],
      [{ sku: '01-9999XX', sku_not_found: true }]
    );
    expect(merged?.[0].sku_not_found).toBe(true);
  });

  it('returns null when nothing would change, so no state write is scheduled', () => {
    const local = [
      item('03-4665GN', { sku_not_found: false }),
      item('010517', { sku_not_found: true }),
    ];
    expect(
      mergeDerivedItemFlags(local, [
        { sku: '03-4665GN', sku_not_found: false },
        { sku: '010517', sku_not_found: true },
      ])
    ).toBeNull();
    expect(mergeDerivedItemFlags(local, [{ sku: '03-4665GN' }])).toBeNull();
  });

  it('touches only the flag — picked, quantities and shelves stay as the session has them', () => {
    const local = [
      item('010517', { sku_not_found: true, picked: true, pickingQty: 3, location: 'ROW 9' }),
    ];
    const merged = mergeDerivedItemFlags(local, [
      { sku: '010517', sku_not_found: false, picked: false, pickingQty: 1, location: 'ROW 43' },
    ]);
    expect(merged?.[0]).toMatchObject({ picked: true, pickingQty: 3, location: 'ROW 9' });
  });

  it('matches by sku whatever the order, including split picks of one SKU', () => {
    const local = [
      item('03-3768BL', { sku_not_found: true, location: 'ROW 43' }),
      item('03-3768BL', { sku_not_found: true, location: 'ROW 42 BURIED' }),
      item('010517', { sku_not_found: true }),
    ];
    const merged = mergeDerivedItemFlags(local, [
      { sku: '010517', sku_not_found: true },
      { sku: '03-3768BL', sku_not_found: false },
    ]);
    expect(merged?.map((i) => i.sku_not_found)).toEqual([false, false, true]);
  });

  it('ignores a row that is not a populated array of items', () => {
    const local = [item('010517', { sku_not_found: true })];
    expect(mergeDerivedItemFlags(local, null)).toBeNull();
    expect(mergeDerivedItemFlags(local, 'oops')).toBeNull();
    expect(mergeDerivedItemFlags(local, [])).toBeNull();
    expect(mergeDerivedItemFlags(local, [42, { nope: true }])).toBeNull();
    expect(mergeDerivedItemFlags([], [{ sku: '010517', sku_not_found: false }])).toBeNull();
  });
});
