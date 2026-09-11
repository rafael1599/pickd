import { describe, expect, it } from 'vitest';
import { verificationProgress } from '../verificationProgress';
import { mergeGroupOrders } from '../mergeGroupOrders';
import type { PickingList } from '../../../hooks/useDoubleCheckList';

const line = (sku: string, location: string | null, qty: number, isBike: boolean) => ({
  sku,
  location,
  pickingQty: qty,
  qty,
  sku_metadata: { is_bike: isBike },
});
const bike = (sku: string, location: string, qty = 1) => line(sku, location, qty, true);
const part = (sku: string, location: string | null, qty = 1) => line(sku, location, qty, false);

function order(over: Partial<Record<keyof PickingList, unknown>> = {}): PickingList {
  return {
    id: 'a',
    order_number: '881500',
    status: 'double_checking',
    items: [bike('03-4805RD', 'ROW 11'), bike('03-4808BK', 'ROW 4', 2), bike('03-4809RD', 'ROW 5')],
    created_at: '2026-09-11T15:00:00Z',
    updated_at: '2026-09-11T15:00:00Z',
    user_id: 'u',
    checked_by: 'picker',
    verified_item_keys: [],
    ...over,
  } as unknown as PickingList;
}

describe('verificationProgress — the bar every board card draws', () => {
  it('a finished order is full; one nobody has taken up is empty, whatever keys it carries', () => {
    expect(verificationProgress(order({ status: 'completed' }))).toBe(100);
    expect(verificationProgress(order({ is_shipped: true }))).toBe(100);
    const keys = ['1-03-4805RD-ROW 11'];
    expect(
      verificationProgress(order({ status: 'ready_to_double_check', verified_item_keys: keys }))
    ).toBe(0);
    expect(verificationProgress(order({ status: 'active', verified_item_keys: keys }))).toBe(0);
  });

  it('counts the units ticked while the check is on', () => {
    // One bike of four — the key Double Check wrote on the local run of 11 Sep.
    expect(verificationProgress(order({ verified_item_keys: ['1-03-4805RD-ROW 11'] }))).toBe(25);
    expect(
      verificationProgress(
        order({
          verified_item_keys: ['1-03-4805RD-ROW 11', '1-03-4808BK-ROW 4', '1-03-4809RD-ROW 5'],
        })
      )
    ).toBe(100);
  });

  it('reads a FedEx group as one cart: the same keys on every member, over all their lines', () => {
    // Double Check writes the group's keys to every member (flushVerifiedItems
    // by group_id). The FedEx group card had no bar at all until 11 Sep.
    const keys = ['1-03-4704GY-7005N', '1-03-4812BK-ROW 4'];
    const members = [
      order({
        id: 'a',
        order_number: '881461',
        group_id: 'g',
        items: [bike('03-4704GY', '7005N')],
        verified_item_keys: keys,
      }),
      order({
        id: 'b',
        order_number: '881537',
        group_id: 'g',
        items: [
          bike('03-3869BL', 'ROW 41'),
          bike('03-3870BL', 'ROW 41'),
          bike('03-4812BK', 'ROW 4'),
        ],
        verified_item_keys: keys,
      }),
    ];
    expect(verificationProgress(mergeGroupOrders(members))).toBe(50);
  });

  it('a key counts by sku and address, whatever pallet number the cart gave it', () => {
    expect(verificationProgress(order({ verified_item_keys: ['3-03-4805RD-ROW 11'] }))).toBe(25);
  });

  it('a line ticked before it had an address still counts once it gets one (#881529)', () => {
    const items = [part('12-2501', 'D37', 5), part('12-0502', 'D29', 5)];
    expect(
      verificationProgress(
        order({ items, verified_item_keys: ['1-12-2501-null', '1-12-0502-D29'] })
      )
    ).toBe(100);
  });

  it('stops at 95 until every unit is ticked', () => {
    const items = [part('12-0511', 'D34', 99), part('70-0108', 'H19', 1)];
    expect(verificationProgress(order({ items, verified_item_keys: ['1-12-0511-D34'] }))).toBe(95);
  });
});
