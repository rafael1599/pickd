import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase } from '../../../../test/mocks/supabase';

// Must import AFTER the mock is set up
import { inventoryApi } from '../inventoryApi';

/**
 * Regression tests for inventory search (PostgREST queries).
 *
 * Bug reference: commit 655d7a2 introduced `sku_metadata ( sku, name, image_url )`
 * but the `name` column does not exist in the sku_metadata table, causing
 * PostgREST to return 400 on ALL inventory queries — breaking search entirely.
 */
describe('inventoryApi.fetchInventoryWithMetadata', () => {
  let queryResult: { data: unknown[]; error: null; count: number };

  beforeEach(() => {
    vi.clearAllMocks();

    queryResult = { data: [], error: null, count: 0 };

    // Build a chainable mock that supports all PostgREST builder methods.
    // Every method returns `mockSupabase` for chaining.
    // `await query` resolves via the custom `then`.
    const chainMethods = [
      'from',
      'select',
      'eq',
      'neq',
      'not',
      'or',
      'order',
      'range',
      'ilike',
      'like',
      'in',
      'gt',
      'gte',
      'lte',
      'limit',
    ];
    for (const method of chainMethods) {
      (mockSupabase as Record<string, unknown>)[method] = vi.fn().mockReturnValue(mockSupabase);
    }

    // Make the mock thenable so `await query` resolves with queryResult
    (mockSupabase as Record<string, unknown>).then = vi.fn((resolve: (value: unknown) => void) =>
      resolve(queryResult)
    );
  });

  const SKU_METADATA_REAL_COLUMNS = [
    'sku',
    'image_url',
    'is_bike',
    'upc',
    'weight_lbs',
    'length_in',
    'width_in',
    'height_in',
    'length_ft',
    'created_at',
  ];

  it('should only reference existing sku_metadata columns in the select', async () => {
    await inventoryApi.fetchInventoryWithMetadata({ search: 'test' });

    const selectCall = (mockSupabase.select as ReturnType<typeof vi.fn>).mock.calls[0];
    const selectString: string = selectCall[0];

    // Parse embedded resource columns: sku_metadata[!inner] ( col1, col2, ... )
    const match = selectString.match(/sku_metadata(?:!inner)?\s*\(\s*([^)]+)\)/);
    expect(match).toBeTruthy();

    const requestedColumns = match![1].split(',').map((c: string) => c.trim());
    for (const col of requestedColumns) {
      expect(
        SKU_METADATA_REAL_COLUMNS,
        `Column "${col}" does not exist in sku_metadata table`
      ).toContain(col);
    }
  });

  it('should apply ilike search filter on sku, item_name, and location', async () => {
    await inventoryApi.fetchInventoryWithMetadata({ search: 'TRAIL' });

    expect(mockSupabase.or).toHaveBeenCalledWith(
      'sku.ilike.%TRAIL%,item_name.ilike.%TRAIL%,location.ilike.%TRAIL%'
    );
  });

  it('should not apply search filter when search is empty', async () => {
    await inventoryApi.fetchInventoryWithMetadata({ search: '' });

    const orCalls = (mockSupabase.or as ReturnType<typeof vi.fn>).mock.calls;
    const searchOrCalls = orCalls.filter((call: string[][]) => call[0].includes('ilike'));
    expect(searchOrCalls).toHaveLength(0);
  });

  it('should paginate with offset and limit', async () => {
    await inventoryApi.fetchInventoryWithMetadata({ offset: 30, limit: 15 });

    expect(mockSupabase.range).toHaveBeenCalledWith(30, 44);
  });

  it('should filter active items with quantity > 0 by default', async () => {
    await inventoryApi.fetchInventoryWithMetadata();

    expect(mockSupabase.eq).toHaveBeenCalledWith('is_active', true);
    expect(mockSupabase.gt).toHaveBeenCalledWith('quantity', 0);
  });

  it('should return data and count from response', async () => {
    queryResult = {
      data: [
        {
          id: 1,
          sku: '03-4083BK',
          quantity: 5,
          location: 'ROW 1',
          sku_metadata: { sku: '03-4083BK', image_url: null },
        },
      ],
      error: null,
      count: 42,
    };

    const result = await inventoryApi.fetchInventoryWithMetadata({ search: '4083' });

    expect(result.data).toHaveLength(1);
    expect(result.count).toBe(42);
  });
});
