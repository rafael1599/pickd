import { supabase } from '../../../lib/supabase';
import {
  BikeUnitWithCatalogSchema,
  type BikeUnit,
  type BikeUnitWithCatalog,
  type BikeUnitCategory,
  type BikeUnitStatus,
} from '../../../schemas/products.schema';
import type { BikeCondition } from '../../../schemas/skuMetadata.schema';
import { validateArray, validateData } from '../../../utils/validate';

export interface CatalogFilters {
  category?: BikeUnitCategory;
  status?: BikeUnitStatus;
  productId?: string; // model name (denormalized)
  size?: string;
  color?: string;
  search?: string;
}

export interface SDUnitInput {
  sku: string;
  model?: string | null;
  size?: string | null;
  color?: string | null;
  category: BikeUnitCategory; // sd_category in DB
  productCategory?: string | null; // category in DB
  serial_number?: string | null;
  condition?: BikeCondition | null;
  condition_description?: string | null;
  msrp?: number | null;
  standard_price?: number | null;
  sd_price?: number | null;
  pdf_link?: string | null;
}

const SELECT_COLS = `
  sku, model, size, color, category, serial_number,
  condition, condition_description, sd_category,
  msrp, standard_price, sd_price, pdf_link, image_url,
  inventory!left ( id, quantity, is_active, location, warehouse )
`;

type SkuRow = {
  sku: string;
  model: string | null;
  size: string | null;
  color: string | null;
  category: string | null;
  serial_number: string | null;
  condition: BikeCondition | null;
  condition_description: string | null;
  sd_category: string | null;
  msrp: number | null;
  standard_price: number | null;
  sd_price: number | null;
  pdf_link: string | null;
  image_url: string | null;
  inventory?: Array<{
    id: number;
    quantity: number | null;
    is_active: boolean | null;
    location: string | null;
    warehouse: string | null;
  }>;
};

/**
 * Adapter: takes a flat sku_metadata row (with joined inventory) and
 * returns the nested BikeUnitWithCatalog shape that the UI components
 * already consume. Lets us keep the frontend untouched after collapsing
 * the parallel structure into sku_metadata.
 */
function mapRowToBikeUnitWithCatalog(row: SkuRow): BikeUnitWithCatalog {
  const invRow = row.inventory?.find((i) => i.is_active !== false && (i.quantity ?? 0) > 0);
  const status: BikeUnitStatus = invRow ? 'available' : 'sold';
  const category: BikeUnitCategory = (row.sd_category as BikeUnitCategory) ?? 'sd';

  return {
    id: row.sku,
    variant_id: row.sku,
    sku: row.sku,
    serial_number: row.serial_number,
    condition: row.condition,
    condition_description: row.condition_description,
    category,
    sd_price: row.sd_price,
    pdf_link: row.pdf_link,
    status,
    inventory_id: invRow?.id ?? null,
    sold_at: null,
    sold_in_picking_list: null,
    bike_variants: {
      id: row.sku,
      product_id: row.sku,
      size: row.size,
      color: row.color,
      msrp: row.msrp,
      standard_price: row.standard_price,
      products: {
        id: row.sku,
        brand: 'JAMIS',
        product_name: row.model ?? row.sku,
        category: row.category,
      },
    },
  };
}

export const scratchAndDentApi = {
  /**
   * Fetch the S/D catalog. Filters by status are applied client-side because
   * status is derived from inventory state, not stored.
   */
  async fetchCatalog(filters: CatalogFilters = {}): Promise<BikeUnitWithCatalog[]> {
    let q = supabase
      .from('sku_metadata')
      .select(SELECT_COLS)
      .eq('is_scratch_dent', true)
      .order('sku', { ascending: true });

    if (filters.category) q = q.eq('sd_category', filters.category);
    if (filters.productId) q = q.eq('model', filters.productId);
    if (filters.size) q = q.eq('size', filters.size);
    if (filters.color) q = q.eq('color', filters.color);
    if (filters.search) {
      const s = filters.search;
      q = q.or(
        `sku.ilike.%${s}%,serial_number.ilike.%${s}%,condition_description.ilike.%${s}%,model.ilike.%${s}%`
      );
    }

    const { data, error } = await q;
    if (error) throw error;

    const mapped = (data as unknown as SkuRow[]).map(mapRowToBikeUnitWithCatalog);
    const wantedStatus = filters.status ?? 'available';
    const filtered = mapped.filter((u) => u.status === wantedStatus);
    return validateArray(BikeUnitWithCatalogSchema, filtered);
  },

  /**
   * Fetch a single S/D unit by SKU. Used by ItemDetailView's S/D section.
   */
  async fetchUnitBySku(sku: string): Promise<BikeUnitWithCatalog | null> {
    const { data, error } = await supabase
      .from('sku_metadata')
      .select(SELECT_COLS)
      .eq('sku', sku)
      .eq('is_scratch_dent', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return validateData(
      BikeUnitWithCatalogSchema,
      mapRowToBikeUnitWithCatalog(data as unknown as SkuRow)
    );
  },

  /**
   * Distinct values for the catalog filter dropdowns. Computed client-side
   * because we don't have a separate `products` table anymore.
   */
  async fetchFilterOptions(): Promise<{
    products: { id: string; product_name: string; category: string | null }[];
    sizes: string[];
    colors: string[];
  }> {
    const { data, error } = await supabase
      .from('sku_metadata')
      .select('model, category, size, color')
      .eq('is_scratch_dent', true);
    if (error) throw error;

    const productsMap = new Map<string, { product_name: string; category: string | null }>();
    const sizes = new Set<string>();
    const colors = new Set<string>();

    for (const r of data ?? []) {
      const model = r.model;
      if (model && !productsMap.has(model)) {
        productsMap.set(model, { product_name: model, category: r.category ?? null });
      }
      if (r.size) sizes.add(r.size);
      if (r.color) colors.add(r.color);
    }

    return {
      products: Array.from(productsMap.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => a.product_name.localeCompare(b.product_name)),
      sizes: Array.from(sizes).sort(),
      colors: Array.from(colors).sort(),
    };
  },

  /**
   * Create or update an S/D unit. Two steps:
   *   1. UPSERT into sku_metadata with all S/D fields (is_scratch_dent=true).
   *   2. Ensure a shadow row in `inventory` (qty=1, ROW 33, LUDLOW) so the
   *      legacy stock view + picking flow keep working unchanged.
   */
  async createUnit(input: SDUnitInput): Promise<BikeUnit> {
    const skuRow = {
      sku: input.sku,
      model: input.model ?? null,
      size: input.size ?? null,
      color: input.color ?? null,
      category: input.productCategory ?? null,
      serial_number: input.serial_number ?? null,
      condition: input.condition ?? null,
      condition_description: input.condition_description ?? null,
      sd_category: input.category,
      msrp: input.msrp ?? null,
      standard_price: input.standard_price ?? null,
      sd_price: input.sd_price ?? null,
      pdf_link: input.pdf_link ?? null,
      is_scratch_dent: true,
    };

    const { error: skuError } = await supabase
      .from('sku_metadata')
      .upsert(skuRow, { onConflict: 'sku' });
    if (skuError) throw skuError;

    // Ensure inventory shadow row (qty=1 in ROW 33 LUDLOW).
    const { data: existingInv } = await supabase
      .from('inventory')
      .select('id')
      .eq('sku', input.sku)
      .eq('warehouse', 'LUDLOW')
      .eq('location', 'ROW 33')
      .maybeSingle();

    let inventoryId: number | null = existingInv?.id ?? null;
    if (!inventoryId) {
      const itemName = [input.model, input.size, input.color].filter(Boolean).join(' ').trim();
      const { data: newInv, error: invError } = await supabase
        .from('inventory')
        .insert([
          {
            sku: input.sku,
            warehouse: 'LUDLOW',
            location: 'ROW 33',
            quantity: 1,
            is_active: true,
            item_name: itemName || input.sku,
          },
        ])
        .select('id')
        .single();
      if (invError) throw invError;
      inventoryId = newInv.id;
    }

    return {
      id: input.sku,
      variant_id: input.sku,
      sku: input.sku,
      serial_number: skuRow.serial_number,
      condition: skuRow.condition,
      condition_description: skuRow.condition_description,
      category: input.category,
      sd_price: skuRow.sd_price,
      pdf_link: skuRow.pdf_link,
      status: 'available',
      inventory_id: inventoryId,
      sold_at: null,
      sold_in_picking_list: null,
    };
  },

  /**
   * Patch an existing S/D unit. SKU is the identity here.
   */
  async updateUnit(sku: string, patch: Partial<SDUnitInput>): Promise<void> {
    const dbPatch: Record<string, unknown> = {};
    if (patch.model !== undefined) dbPatch.model = patch.model;
    if (patch.size !== undefined) dbPatch.size = patch.size;
    if (patch.color !== undefined) dbPatch.color = patch.color;
    if (patch.productCategory !== undefined) dbPatch.category = patch.productCategory;
    if (patch.serial_number !== undefined) dbPatch.serial_number = patch.serial_number;
    if (patch.condition !== undefined) dbPatch.condition = patch.condition;
    if (patch.condition_description !== undefined)
      dbPatch.condition_description = patch.condition_description;
    if (patch.category !== undefined) dbPatch.sd_category = patch.category;
    if (patch.msrp !== undefined) dbPatch.msrp = patch.msrp;
    if (patch.standard_price !== undefined) dbPatch.standard_price = patch.standard_price;
    if (patch.sd_price !== undefined) dbPatch.sd_price = patch.sd_price;
    if (patch.pdf_link !== undefined) dbPatch.pdf_link = patch.pdf_link;

    if (Object.keys(dbPatch).length === 0) return;

    const { error } = await supabase.from('sku_metadata').update(dbPatch).eq('sku', sku);
    if (error) throw error;
  },

  /**
   * "Delete" an S/D unit = unmark as S/D and clear S/D-specific fields.
   * The SKU remains as a regular item in sku_metadata.
   */
  async deleteUnit(sku: string): Promise<void> {
    const { error } = await supabase
      .from('sku_metadata')
      .update({
        is_scratch_dent: false,
        sd_category: null,
        sd_price: null,
        condition: null,
        condition_description: null,
        pdf_link: null,
        serial_number: null,
      })
      .eq('sku', sku);
    if (error) throw error;
  },
};
