import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase } from '../../../../test/mocks/supabase';

// Must import AFTER the mock is set up
import { inventoryApi } from '../inventoryApi';

/**
 * Tests for inventoryApi.fetchInventoryWithMetadata — now backed by the
 * `search_inventory_with_metadata` RPC. The RPC ORs across inventory +
 * sku_metadata columns (including serial_number) with normalized matching.
 */
describe('inventoryApi.fetchInventoryWithMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockSupabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      error: null,
    });
  });

  it('calls the search_inventory_with_metadata RPC with the expected params', async () => {
    await inventoryApi.fetchInventoryWithMetadata({
      search: 'TRAIL',
      warehouse: 'LUDLOW',
      includeInactive: true,
      showParts: false,
      onlyScratchDent: false,
      offset: 30,
      limit: 15,
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('search_inventory_with_metadata', {
      p_search: 'TRAIL',
      p_warehouse: 'LUDLOW',
      p_include_inactive: true,
      p_show_parts: false,
      p_only_scratch_dent: false,
      p_offset: 30,
      p_limit: 15,
    });
  });

  it('passes an empty search term verbatim (RPC handles empty on the server)', async () => {
    await inventoryApi.fetchInventoryWithMetadata({ search: '' });

    const call = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('search_inventory_with_metadata');
    expect(call[1].p_search).toBe('');
  });

  it('defaults to p_include_inactive=false, p_show_parts=false, p_only_scratch_dent=false', async () => {
    await inventoryApi.fetchInventoryWithMetadata();

    const call = (mockSupabase.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].p_include_inactive).toBe(false);
    expect(call[1].p_show_parts).toBe(false);
    expect(call[1].p_only_scratch_dent).toBe(false);
    expect(call[1].p_offset).toBe(0);
    expect(call[1].p_limit).toBe(30);
  });

  it('re-nests flat RPC rows back into { ..., sku_metadata: {...} } shape', async () => {
    (mockSupabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [
        {
          id: 1,
          sku: '03-4083BK',
          quantity: 5,
          location: 'ROW 1',
          location_id: null,
          sublocation: null,
          item_name: 'Test bike',
          warehouse: 'LUDLOW',
          is_active: true,
          internal_note: null,
          distribution: [],
          created_at: '2026-04-22T00:00:00Z',
          location_sort_key: 101,
          image_url: 'https://example.com/img.webp',
          length_in: 60,
          width_in: 20,
          height_in: 30,
          weight_lbs: 40,
          is_bike: true,
          is_scratch_dent: false,
          serial_number: '01-1111',
          total_count: 42,
        },
      ],
      error: null,
    });

    const result = await inventoryApi.fetchInventoryWithMetadata({ search: '01-1111' });

    expect(result.data).toHaveLength(1);
    expect(result.count).toBe(42);
    const [item] = result.data as unknown as Array<
      Record<string, unknown> & { sku_metadata: Record<string, unknown> }
    >;
    expect(item.sku).toBe('03-4083BK');
    expect(item.quantity).toBe(5);
    // Metadata fields are re-nested under sku_metadata
    expect(item.sku_metadata).toEqual({
      sku: '03-4083BK',
      image_url: 'https://example.com/img.webp',
      length_in: 60,
      width_in: 20,
      height_in: 30,
      weight_lbs: 40,
      is_bike: true,
      is_scratch_dent: false,
      serial_number: '01-1111',
    });
    // Flat metadata fields should not leak onto the top-level row
    expect(item).not.toHaveProperty('image_url');
    expect(item).not.toHaveProperty('serial_number');
    expect(item).not.toHaveProperty('total_count');
  });

  it('returns count=0 when the RPC returns no rows', async () => {
    (mockSupabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const result = await inventoryApi.fetchInventoryWithMetadata({ search: 'no-match' });

    expect(result.data).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  it('surfaces RPC errors by throwing', async () => {
    (mockSupabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: null,
      error: { message: 'boom' },
    });

    await expect(inventoryApi.fetchInventoryWithMetadata({ search: 'x' })).rejects.toBeTruthy();
  });
});
