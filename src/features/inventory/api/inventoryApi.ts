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
import type { ScratchDentMetadataRow } from '../utils/scratchDentExport';

/**
 * Service for interacting with Inventory and Locations in Supabase.
 * Provides type-safe methods and centralized validation.
 */
export const inventoryApi = {
  /**
   * Fetch inventory with metadata — paginated, searchable (incl. serial_number).
   * Delegates to the `search_inventory_with_metadata` RPC so the search can OR
   * across inventory + sku_metadata columns with normalized matching.
   * Keeps the { data, count } shape and re-nests sku_metadata so callers are
   * unchanged.
   *
   * `showParts: null` means "bikes and parts together" — one call that covers
   * the whole catalogue, with an exact `count`. Used by search, where splitting
   * into per-bucket calls made the totals overlap and the offsets skip rows.
   */
  async fetchInventoryWithMetadata({
    includeInactive = false,
    showParts = false,
    onlyScratchDent = false,
    onlyFedexReturns = false,
    search = '',
    offset = 0,
    limit = 30,
    warehouse,
  }: {
    includeInactive?: boolean;
    showParts?: boolean | null;
    onlyScratchDent?: boolean;
    onlyFedexReturns?: boolean;
    search?: string;
    offset?: number;
    limit?: number;
    warehouse?: string;
  } = {}): Promise<{ data: InventoryItem[]; count: number | null }> {
    const { data, error } = await supabase.rpc('search_inventory_with_metadata', {
      p_search: search,
      p_warehouse: warehouse ?? undefined,
      p_include_inactive: includeInactive,
      p_show_parts: showParts,
      p_only_scratch_dent: onlyScratchDent,
      p_only_fedex_returns: onlyFedexReturns,
      p_offset: offset,
      p_limit: limit,
    });

    if (error) throw error;

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const count = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;

    const reshaped = rows.map((row) => {
      const {
        total_count: _tc,
        image_url,
        length_in,
        width_in,
        height_in,
        weight_lbs,
        is_bike,
        is_scratch_dent,
        serial_number,
        upc,
        model,
        condition_description,
        pdf_link,
        sd_price,
        condition,
        size,
        category,
        fedex_tracking_number,
        fedex_return_id,
        fedex_return_status,
        ...inventoryCols
      } = row;
      return {
        ...inventoryCols,
        fedex_tracking_number,
        fedex_return_id,
        fedex_return_status,
        sku_metadata: {
          sku: inventoryCols.sku,
          image_url,
          length_in,
          width_in,
          height_in,
          weight_lbs,
          is_bike,
          is_scratch_dent,
          serial_number,
          upc,
          model,
          condition_description,
          pdf_link,
          sd_price,
          condition,
          size,
          category,
        },
      };
    });

    return { data: reshaped as unknown as InventoryItem[], count };
  },

  /**
   * Every S/D catalogue row with all its shelf rows, for the Excel export.
   * Not paginated like the Stock list: the whole set is ~200 rows, and a
   * spreadsheet that silently stops at a page limit is a wrong spreadsheet.
   */
  async fetchScratchDentExport(): Promise<ScratchDentMetadataRow[]> {
    const { data, error } = await supabase
      .from('sku_metadata')
      .select(
        `sku, category, condition, condition_description, serial_number,
         upc, msrp, standard_price, sd_price, as400_description, received_year, image_url,
         pdf_link,
         inventory!left ( id, warehouse, location, quantity, is_active,
           item_name, internal_note )`
      )
      .eq('is_scratch_dent', true)
      .range(0, 9999);
    if (error) throw error;
    return (data ?? []) as unknown as ScratchDentMetadataRow[];
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
