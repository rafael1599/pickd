import { describe, expect, it } from 'vitest';
import { parseRpcSlotId, slotsToRpcInput } from '../slotsToRpcInput';
import type { SlotGroup } from '../types';

const towerGroup = (id: string, sameSku: boolean, count = 2): SlotGroup => ({
  id,
  same_sku: sameSku,
  slots: Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    type: 'tower' as const,
    min_qty: 30,
    max_qty: 35,
  })),
});

const lineGroup = (id: string, sameSku: boolean, count: number): SlotGroup => ({
  id,
  same_sku: sameSku,
  slots: Array.from({ length: count }, (_, i) => ({
    id: `l${i + 1}`,
    type: 'line' as const,
    min_qty: 4,
    max_qty: 7,
  })),
});

describe('slotsToRpcInput', () => {
  it('emits one entry per slot when same_sku is false', () => {
    const out = slotsToRpcInput([lineGroup('g1', false, 3)]);
    expect(out).toHaveLength(3);
    expect(out.every((s) => s.min_qty === 4 && s.max_qty === 7)).toBe(true);
    expect(out.map((s) => s.slot_id)).toEqual(['g1:l1', 'g1:l2', 'g1:l3']);
  });

  it('collapses same_sku groups into a single aggregated slot', () => {
    // 2 towers same SKU → 30+30 .. 35+35 = 60..70
    const out = slotsToRpcInput([towerGroup('g1', true, 2)]);
    expect(out).toEqual([{ slot_id: 'g1:agg', min_qty: 60, max_qty: 70 }]);
  });

  it('handles mixed groups (one same_sku + one independent) in one payload', () => {
    const out = slotsToRpcInput([towerGroup('g1', true, 2), lineGroup('g2', false, 2)]);
    expect(out).toHaveLength(3); // 1 agg + 2 lines
    expect(out[0]).toMatchObject({ slot_id: 'g1:agg', min_qty: 60, max_qty: 70 });
    expect(out[1].slot_id).toBe('g2:l1');
    expect(out[2].slot_id).toBe('g2:l2');
  });

  it('skips groups that have zero slots (defensive)', () => {
    const empty: SlotGroup = { id: 'g0', same_sku: false, slots: [] };
    const out = slotsToRpcInput([empty, lineGroup('g1', false, 1)]);
    expect(out).toHaveLength(1);
    expect(out[0].slot_id).toBe('g1:l1');
  });

  it('preserves slot order within a non-same_sku group', () => {
    const g: SlotGroup = {
      id: 'g1',
      same_sku: false,
      slots: [
        { id: 'x', type: 'line', min_qty: 4, max_qty: 7 },
        { id: 'y', type: 'tower', min_qty: 30, max_qty: 35 },
        { id: 'z', type: 'custom', min_qty: 10, max_qty: 15 },
      ],
    };
    const out = slotsToRpcInput([g]);
    expect(out.map((s) => s.slot_id)).toEqual(['g1:x', 'g1:y', 'g1:z']);
  });
});

describe('parseRpcSlotId', () => {
  it('returns null for malformed ids', () => {
    expect(parseRpcSlotId('no-colon')).toBeNull();
  });

  it('parses aggregated ids', () => {
    expect(parseRpcSlotId('g1:agg')).toEqual({ groupId: 'g1', kind: 'aggregated' });
  });

  it('parses per-slot ids', () => {
    expect(parseRpcSlotId('g1:l3')).toEqual({ groupId: 'g1', kind: 'slot', slotId: 'l3' });
  });

  it('handles slot ids that themselves contain hyphens', () => {
    expect(parseRpcSlotId('g-1:s-42-abc')).toEqual({
      groupId: 'g-1',
      kind: 'slot',
      slotId: 's-42-abc',
    });
  });
});
