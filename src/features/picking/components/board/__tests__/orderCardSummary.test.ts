import { describe, it, expect } from 'vitest';
import { getOrderUnits } from '../SortableOrderCard';
import type { PickingList } from '../../../hooks/useDoubleCheckList';
import { autoClassifyShippingType } from '../../../../../utils/shippingClassification';

// Minimal PickingList factory — only the fields the helpers read matter.
const makeOrder = (partial: Partial<PickingList>): PickingList =>
  ({
    id: 'list-1',
    order_number: '1001',
    status: 'ready_to_double_check',
    items: [],
    updated_at: '2026-06-10T00:00:00Z',
    user_id: 'u1',
    checked_by: null,
    ...partial,
  }) as PickingList;

describe('getOrderUnits (order card summary)', () => {
  it('sums pickingQty across items', () => {
    const order = makeOrder({
      items: [
        { sku: 'A', qty: 0, pickingQty: 3 },
        { sku: 'B', qty: 0, pickingQty: 1 },
      ] as PickingList['items'],
    });
    expect(getOrderUnits(order)).toBe(4);
  });

  it('falls back to total_units when items have no pickingQty', () => {
    const order = makeOrder({
      items: [{ sku: 'A', qty: 0 }] as PickingList['items'],
      total_units: 7,
    });
    expect(getOrderUnits(order)).toBe(7);
  });

  it('falls back to total_units when items array is empty', () => {
    const order = makeOrder({ items: [], total_units: 5 });
    expect(getOrderUnits(order)).toBe(5);
  });

  it('returns 0 when neither items nor total_units present', () => {
    const order = makeOrder({
      items: null as unknown as PickingList['items'],
      total_units: null,
    });
    expect(getOrderUnits(order)).toBe(0);
  });
});

/**
 * Mirrors the effective-shipping-type resolution used in DoubleCheckView:
 * a persisted override wins, otherwise auto-classify by count/weight.
 */
function effectiveShippingType(
  override: string | null,
  items: { sku: string; pickingQty: number }[]
): 'fedex' | 'regular' {
  return override === 'fedex' || override === 'regular'
    ? override
    : autoClassifyShippingType(items, {});
}

describe('effectiveShippingType (purple FedEx accent)', () => {
  it('uses the persisted override when set', () => {
    // 5 items would auto-classify as regular, but the override forces fedex.
    const items = [{ sku: 'A', pickingQty: 5 }];
    expect(effectiveShippingType('fedex', items)).toBe('fedex');
  });

  it('auto-classifies a small light order as fedex when no override', () => {
    const items = [{ sku: 'A', pickingQty: 2 }];
    expect(effectiveShippingType(null, items)).toBe('fedex');
  });

  it('auto-classifies a 5+ unit order as regular when no override', () => {
    const items = [{ sku: 'A', pickingQty: 5 }];
    expect(effectiveShippingType(null, items)).toBe('regular');
  });
});

/** Mirrors the source_order_date formatting used in the views. */
function formatSourceOrderDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

describe('source_order_date display', () => {
  it('formats an ISO date readably', () => {
    expect(formatSourceOrderDate('2026-03-09')).toBe('Mar 9, 2026');
  });

  it('renders nothing when null', () => {
    expect(formatSourceOrderDate(null)).toBeNull();
  });
});
