import { describe, expect, it } from 'vitest';
import {
  bikeSkusOf,
  heldCaptures,
  inFlightCaptures,
  isRequestable,
  isWatcherAlive,
  pendingCaptures,
  summarize,
  type DoorCapture,
} from '../useAs400Door';

const row = (over: Partial<DoorCapture> = {}): DoorCapture => ({
  order_number: '881390',
  status: 'pending',
  hold_reason: null,
  source: 'auto_scan',
  captured_at: '2026-09-08T17:00:00Z',
  updated_at: '2026-09-08T17:00:00Z',
  customer: 'SHREWSBURY BICYCLES INC.',
  ship_to: null,
  as400_account_number: null,
  order_date: null,
  item_count: 2,
  total_units: 6,
  subtotal: null,
  total_mismatch: false,
  items: [],
  requested_by: null,
  requested_at: null,
  last_error: null,
  ...over,
});

describe('isRequestable — mirrors request_as400_capture so the button never lies', () => {
  it('offers a pending row', () => {
    expect(isRequestable(row())).toBe(true);
  });
  it('offers a held row only for the reasons a person can clear', () => {
    expect(isRequestable(row({ status: 'held', hold_reason: 'stale' }))).toBe(true);
    expect(isRequestable(row({ status: 'held', hold_reason: 'waiting_locked' }))).toBe(true);
  });
  it('never offers a lost page — it needs a re-capture on Bay 2, not a tap', () => {
    expect(isRequestable(row({ status: 'held', hold_reason: 'total_mismatch' }))).toBe(false);
  });
  it('never offers a row already in flight', () => {
    expect(isRequestable(row({ status: 'requested' }))).toBe(false);
    expect(isRequestable(row({ status: 'sending' }))).toBe(false);
  });
});

describe('isWatcherAlive', () => {
  const now = Date.parse('2026-09-08T17:00:00Z');
  it('is alive within a minute of the last pulse', () => {
    expect(isWatcherAlive({ seen_at: '2026-09-08T16:59:30Z', version: 'x' }, now)).toBe(true);
  });
  it('is gone after a minute, and when there was never a pulse', () => {
    expect(isWatcherAlive({ seen_at: '2026-09-08T16:58:00Z', version: 'x' }, now)).toBe(false);
    expect(isWatcherAlive(null, now)).toBe(false);
  });
});

describe('the three lists', () => {
  const rows = [
    row({ order_number: '1', status: 'pending' }),
    row({ order_number: '2', status: 'held', hold_reason: 'stale' }),
    row({ order_number: '3', status: 'requested' }),
    row({ order_number: '4', status: 'sending' }),
  ];
  it('split by what a person is waiting on', () => {
    expect(pendingCaptures(rows).map((r) => r.order_number)).toEqual(['1']);
    expect(heldCaptures(rows).map((r) => r.order_number)).toEqual(['2']);
    expect(inFlightCaptures(rows).map((r) => r.order_number)).toEqual(['3', '4']);
  });
});

describe('summarize — the card says what the board will say', () => {
  const items = [
    { sku: '03-3684BR', pickingQty: 5, sku_metadata: { is_bike: true } },
    { sku: '99-3604', pickingQty: 9, sku_metadata: { is_bike: false } },
  ];
  it('reads the embedded is_bike, needing no lookup', () => {
    expect([...bikeSkusOf(items)]).toEqual(['03-3684BR']);
  });
  it('five bikes are a truck; the nine parts do not count toward it', () => {
    const s = summarize(row({ items }));
    expect(s.lane).toBe('regular');
    expect(s.bikes).toBe(5);
    expect(s.parts).toBe(9);
    expect(s.units).toBe(14);
    // One bike pallet plus the parts' own container — calculatePalletsWithBikeAwareness
    // never stacks parts onto a bike pallet. (The watchdog's old port said the
    // opposite; that port is being deleted, this is the rule.)
    expect(s.pallets).toBe(2);
  });
  it('four bikes are FedEx, however many parts ride along', () => {
    const s = summarize(row({ items: [{ ...items[0], pickingQty: 4 }, items[1]] }));
    expect(s.lane).toBe('fedex');
  });
  it('a bike whose flag the watchdog could not embed counts as a part, and says so by lane', () => {
    // The trap the embedded flag exists to avoid: no flag → part → FedEx.
    const s = summarize(row({ items: [{ sku: '03-3684BR', pickingQty: 6 }] }));
    expect(s.lane).toBe('fedex');
    expect(s.parts).toBe(6);
  });
});
