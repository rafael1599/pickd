import { supabase } from '../../../lib/supabase';
import {
  InventoryItemSchema,
  InventoryItemInputSchema,
  type InventoryItem,
  type InventoryItemInput,
} from '../../../schemas/inventory.schema';
import {
  SKUMetadataSchema,
  SKUMetadataInputSchema,
  type SKUMetadata,
  type SKUMetadataInput,
} from '../../../schemas/skuMetadata.schema';
import {
  LocationSchema,
  LocationInputSchema,
  type Location,
  type LocationInput,
} from '../../../schemas/location.schema';
import { validateData, validateArray } from '../../../utils/validate';

/**
 * Service for interacting with Inventory and Locations in Supabase.
 * Provides type-safe methods and centralized validation.
 */
export const inventoryApi = {
  /**
   * OPTIMIZED: Fetch inventory with metadata — paginated with lean column selection.
   * Returns { data, count } for infinite query support.
   */
  async fetchInventoryWithMetadata({
    includeInactive = false,
    showParts = false,
    search = '',
    offset = 0,
    limit = 30,
    warehouse,
  }: {
    includeInactive?: boolean;
    showParts?: boolean;
    search?: string;
    offset?: number;
    limit?: number;
    warehouse?: string;
  } = {}): Promise<{ data: InventoryItem[]; count: number | null }> {
    const metadataCols = 'sku, image_url, length_in, width_in, height_in, weight_lbs, is_bike';

    let query = supabase
      .from('inventory')
      .select(
        `
        id, sku, quantity, location, location_id, item_name,
        warehouse, is_active, internal_note, distribution, created_at,
        location_sort_key,
        sku_metadata!inner ( ${metadataCols} )
        `,
        { count: 'exact' }
      )
      .order('location_sort_key', { ascending: true })
      .order('sku', { ascending: true })
      .range(offset, offset + limit - 1);

    if (warehouse) {
      query = query.eq('warehouse', warehouse);
    }

    if (!includeInactive) {
      query = query.eq('is_active', true).gt('quantity', 0);
    }

    if (search) {
      query = query.or(
        `sku.ilike.%${search}%,item_name.ilike.%${search}%,location.ilike.%${search}%`
      );
    }

    // Filter by is_bike: bikes when false, parts when true
    query = query.eq('sku_metadata.is_bike', !showParts);

    const { data, error, count } = await query;

    if (error) throw error;
    return { data: (data || []) as unknown as InventoryItem[], count };
  },

  /**
   * Update or create SKU metadata
   */
  async upsertMetadata(metadata: SKUMetadataInput): Promise<SKUMetadata> {
    const validated = validateData(SKUMetadataInputSchema, metadata);

    const { data, error } = await supabase
      .from('sku_metadata')
      .upsert([validated], { onConflict: 'sku' })
      .select()
      .single();

    if (error) throw error;
    return validateData(SKUMetadataSchema, data);
  },

  /**
   * Fetch all warehouse locations
   */
  async fetchLocations(): Promise<Location[]> {
    const { data, error } = await supabase.from('locations').select('*');

    if (error) throw error;
    return validateArray(LocationSchema, data || []);
  },

  /**
   * Update quantity for a specific inventory record
   */
  async updateQuantity(id: string | number, quantity: number): Promise<InventoryItem> {
    if (!id || isNaN(Number(id))) {
      console.error('Critical Error: Attempted update on invalid ID', { id, quantity });
      throw new Error(`Operation aborted: Invalid ID (${id})`);
    }
    const { data, error } = await supabase
      .from('inventory')
      .update({ quantity: quantity })
      .eq('id', Number(id))
      .select()
      .single();

    if (error) throw error;
    return validateData(InventoryItemSchema, data);
  },

  /**
   * Create or update an inventory item
   */
  async upsertItem(item: InventoryItemInput): Promise<InventoryItem> {
    const validated = validateData(InventoryItemInputSchema, item);

    const { data, error } = await supabase
      .from('inventory')
      .upsert([validated], { onConflict: 'sku,warehouse,location' })
      .select()
      .single();

    if (error) throw error;
    return validateData(InventoryItemSchema, data);
  },

  /**
   * Delete an inventory item
   */
  async deleteItem(id: string | number): Promise<void> {
    if (!id || isNaN(Number(id))) {
      console.error('Critical Error: Attempted delete on invalid ID', { id });
      throw new Error(`Operation aborted: Invalid ID (${id})`);
    }
    const { error } = await supabase.from('inventory').delete().eq('id', Number(id));

    if (error) throw error;
  },

  /**
   * Create a new location
   */
  async createLocation(location: LocationInput): Promise<Location> {
    const validated = validateData(LocationInputSchema, location);

    const { data, error } = await supabase.from('locations').insert([validated]).select().single();

    if (error) throw error;
    return validateData(LocationSchema, data);
  },

  /**
   * Find item by unique SKU/Warehouse/Location combination
   */
  async findItem(sku: string, warehouse: string, location: string): Promise<InventoryItem | null> {
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .eq('sku', sku)
      .eq('warehouse', warehouse)
      .eq('location', location)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return validateData(InventoryItemSchema, data);
  },
};
