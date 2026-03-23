import { describe, it, expect } from 'vitest';
import {
  updateInventoryCache,
  type RealtimeInventoryEvent,
  type PaginatedInventoryData,
} from '../inventorySync';
import type { InventoryItemWithMetadata } from '../../schemas/inventory.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeItem = (overrides: Partial<InventoryItemWithMetadata> = {}): InventoryItemWithMetadata =>
  ({
    id: 1,
    sku: 'SKU-A',
    warehouse: 'LUDLOW',
    location: 'ROW-1',
    quantity: 10,
    is_active: true,
    item_name: null,
    created_at: new Date(),
    ...overrides,
  }) as InventoryItemWithMetadata;

const makeEvent = (
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  newItem: Partial<InventoryItemWithMetadata> | null,
  oldItem: Partial<InventoryItemWithMetadata> = {}
): RealtimeInventoryEvent =>
  ({
    eventType,
    new: newItem,
    old: oldItem,
  }) as RealtimeInventoryEvent;

const defaultFilters = { warehouse: 'LUDLOW', showInactive: false };

// ---------------------------------------------------------------------------
// INSERT
// ---------------------------------------------------------------------------
describe('updateInventoryCache — INSERT', () => {
  it('adds a new item when it matches filters', () => {
    const existing = [makeItem({ id: 1 })];
    const event = makeEvent('INSERT', makeItem({ id: 2, sku: 'SKU-B' }));

    const result = updateInventoryCache(
      existing,
      event,
      defaultFilters
    ) as InventoryItemWithMetadata[];

    expect(result).toHaveLength(2);
    expect(result[0].sku).toBe('SKU-B'); // prepended
  });

  it('does NOT add item when warehouse filter does not match', () => {
    const existing = [makeItem()];
    const event = makeEvent('INSERT', makeItem({ id: 2, warehouse: 'ATS' }));

    const result = updateInventoryCache(
      existing,
      event,
      defaultFilters
    ) as InventoryItemWithMetadata[];

    expect(result).toHaveLength(1);
  });

  it('de-duplicates when optimistic temp ID exists (negative ID)', () => {
    const optimistic = makeItem({ id: -1 as unknown as number, sku: 'SKU-NEW' });
    const existing = [optimistic];
    const event = makeEvent('INSERT', makeItem({ id: 99, sku: 'SKU-NEW' }));

    const result = updateInventoryCache(
      existing,
      event,
      defaultFilters
    ) as InventoryItemWithMetadata[];

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(99); // replaced with real ID
  });

  it('handles null/undefined oldData gracefully', () => {
    const event = makeEvent('INSERT', makeItem());

    expect(updateInventoryCache(null, event, defaultFilters)).toBeNull();
    expect(updateInventoryCache(undefined, event, defaultFilters)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------
describe('updateInventoryCache — UPDATE', () => {
  it('updates an existing item in place', () => {
    const existing = [makeItem({ id: 1, quantity: 10 })];
    const event = makeEvent('UPDATE', makeItem({ id: 1, quantity: 25 }));

    const result = updateInventoryCache(
      existing,
      event,
      defaultFilters
    ) as InventoryItemWithMetadata[];

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(25);
  });

  it('removes item from view if it no longer matches filters after update', () => {
    const existing = [makeItem({ id: 1, warehouse: 'LUDLOW' })];
    const event = makeEvent('UPDATE', makeItem({ id: 1, warehouse: 'ATS' }));

    const result = updateInventoryCache(
      existing,
      event,
      defaultFilters
    ) as InventoryItemWithMetadata[];

    expect(result).toHaveLength(0);
  });

  it('adds item to view if it now matches filters after update', () => {
    const existing = [makeItem({ id: 1 })];
    const event = makeEvent('UPDATE', makeItem({ id: 2, warehouse: 'LUDLOW' }));

    const result = updateInventoryCache(
      existing,
      event,
      defaultFilters
    ) as InventoryItemWithMetadata[];

    expect(result).toHaveLength(2);
  });

  it('ghost update protection — ignores stale remote during local grace period', () => {
    const localItem = makeItem({
      id: 1,
      quantity: 20,
      _lastUpdateSource: 'local',
      _lastLocalUpdateAt: Date.now() - 1000, // 1 second ago
    });
    const existing = [localItem];
    const event = makeEvent('UPDATE', makeItem({ id: 1, quantity: 15 })); // stale remote

    const result = updateInventoryCache(
      existing,
      event,
      defaultFilters
    ) as InventoryItemWithMetadata[];

    expect(result[0].quantity).toBe(20); // local value preserved
  });

  it('accepts remote update after grace period expires', () => {
    const localItem = makeItem({
      id: 1,
      quantity: 20,
      _lastUpdateSource: 'local',
      _lastLocalUpdateAt: Date.now() - 10000, // 10 seconds ago
    });
    const existing = [localItem];
    const event = makeEvent('UPDATE', makeItem({ id: 1, quantity: 15 }));

    const result = updateInventoryCache(
      existing,
      event,
      defaultFilters
    ) as InventoryItemWithMetadata[];

    expect(result[0].quantity).toBe(15); // remote accepted
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe('updateInventoryCache — DELETE', () => {
  it('removes the item by ID', () => {
    const existing = [makeItem({ id: 1 }), makeItem({ id: 2, sku: 'SKU-B' })];
    const event = makeEvent('DELETE', makeItem({ id: 1 }));

    const result = updateInventoryCache(
      existing,
      event,
      defaultFilters
    ) as InventoryItemWithMetadata[];

    expect(result).toHaveLength(1);
    expect(result[0].sku).toBe('SKU-B');
  });

  it('uses old record ID if new is null', () => {
    const existing = [makeItem({ id: 5 })];
    const event = makeEvent('DELETE', null, { id: 5 });

    const result = updateInventoryCache(
      existing,
      event,
      defaultFilters
    ) as InventoryItemWithMetadata[];

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Paginated structure
// ---------------------------------------------------------------------------
describe('updateInventoryCache — paginated data', () => {
  it('handles PaginatedInventoryData structure (INSERT)', () => {
    const paginated: PaginatedInventoryData = {
      data: [makeItem({ id: 1 })],
      count: 1,
    };
    const event = makeEvent('INSERT', makeItem({ id: 2, sku: 'NEW' }));

    const result = updateInventoryCache(paginated, event, defaultFilters) as PaginatedInventoryData;

    expect(result.data).toHaveLength(2);
    expect(result.count).toBe(2);
  });

  it('handles PaginatedInventoryData structure (DELETE)', () => {
    const paginated: PaginatedInventoryData = {
      data: [makeItem({ id: 1 }), makeItem({ id: 2 })],
      count: 2,
    };
    const event = makeEvent('DELETE', makeItem({ id: 1 }));

    const result = updateInventoryCache(paginated, event, defaultFilters) as PaginatedInventoryData;

    expect(result.data).toHaveLength(1);
    expect(result.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Filter matching
// ---------------------------------------------------------------------------
describe('updateInventoryCache — filter matching', () => {
  it('respects search filter', () => {
    const existing: InventoryItemWithMetadata[] = [];
    const event = makeEvent('INSERT', makeItem({ sku: 'WIDGET-100' }));

    const withMatch = updateInventoryCache(existing, event, {
      ...defaultFilters,
      search: 'widget',
    }) as InventoryItemWithMetadata[];

    const withoutMatch = updateInventoryCache(existing, event, {
      ...defaultFilters,
      search: 'gadget',
    }) as InventoryItemWithMetadata[];

    expect(withMatch).toHaveLength(1);
    expect(withoutMatch).toHaveLength(0);
  });

  it('filters out inactive items when showInactive is false', () => {
    const existing: InventoryItemWithMetadata[] = [];
    const event = makeEvent('INSERT', makeItem({ is_active: false }));

    const result = updateInventoryCache(existing, event, {
      ...defaultFilters,
      showInactive: false,
    }) as InventoryItemWithMetadata[];

    expect(result).toHaveLength(0);
  });

  it('includes inactive items when showInactive is true', () => {
    const existing: InventoryItemWithMetadata[] = [];
    const event = makeEvent('INSERT', makeItem({ is_active: false }));

    const result = updateInventoryCache(existing, event, {
      ...defaultFilters,
      showInactive: true,
    }) as InventoryItemWithMetadata[];

    expect(result).toHaveLength(1);
  });
});
