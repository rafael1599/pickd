import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase } from '../../../test/mocks/supabase';

// Must import AFTER the mock is set up
import { searchBikeStock } from '../stockFallback';

/**
 * idea-131 — fallback search over the full bike stock when no consolidation
 * candidate matches the query. Backed by `search_inventory_with_metadata`.
 */
describe('searchBikeStock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockSupabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], error: null });
  });

  it('queries the shared stock-search RPC, bikes only', async () => {
    await searchBikeStock('03398');
    expect(mockSupabase.rpc).toHaveBeenCalledWith('search_inventory_with_metadata', {
      p_search: '03398',
      p_include_inactive: false,
      p_show_parts: false,
      p_only_scratch_dent: false,
      p_only_fedex_returns: false,
      p_offset: 0,
      p_limit: 15,
    });
  });

  it('returns [] without querying when the query is blank', async () => {
    expect(await searchBikeStock('   ')).toEqual([]);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('maps rows to display hits (location, sublocation, qty)', async () => {
    (mockSupabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          id: 'inv-1',
          sku: '03-3982BL',
          item_name: 'TAXI 26',
          location: 'ROW 7',
          sublocation: ['B'],
          quantity: 4,
        },
      ],
      error: null,
    });
    const hits = await searchBikeStock('03398');
    expect(hits).toEqual([
      {
        key: 'inv-1',
        sku: '03-3982BL',
        item_name: 'TAXI 26',
        location: 'ROW 7',
        sublocation: ['B'],
        quantity: 4,
      },
    ]);
  });
});
