import { z } from 'zod';
import { BikeConditionEnum, SDCategoryEnum } from './skuMetadata.schema';

/**
 * VIEW TYPES — these are NOT tables.
 *
 * The S/D feature originally lived in a parallel relational structure
 * (products → bike_variants → bike_units). We rolled that back and now
 * S/D fields live directly in `sku_metadata`. The UI components were
 * built against the nested shape below, so we keep these types as a
 * "view contract" and the API adapter (in scratchAndDentApi) maps
 * sku_metadata + inventory rows into this shape.
 *
 * Do not add Insert/Update variants — writes go directly against
 * `sku_metadata` via SKUMetadataInputSchema.
 */

export { BikeConditionEnum, SDCategoryEnum } from './skuMetadata.schema';
export type { BikeCondition, SDCategory } from './skuMetadata.schema';

// Renamed alias kept for backwards-compat in scratch-and-dent UI.
export const BikeUnitCategoryEnum = SDCategoryEnum;
export type BikeUnitCategory = z.infer<typeof BikeUnitCategoryEnum>;

export const BikeUnitStatusEnum = z.enum([
  'available',
  'reserved',
  'sold',
  'transferred',
  'retired',
]);
export type BikeUnitStatus = z.infer<typeof BikeUnitStatusEnum>;

export const BikeUnitSchema = z.object({
  id: z.string(), // = sku
  variant_id: z.string(), // = sku
  sku: z.string().min(1),
  serial_number: z.string().nullable().optional(),
  condition: BikeConditionEnum.nullable().optional(),
  condition_description: z.string().nullable().optional(),
  category: BikeUnitCategoryEnum,
  sd_price: z.number().nullable().optional(),
  pdf_link: z.string().nullable().optional(),
  status: BikeUnitStatusEnum,
  inventory_id: z.number().int().nullable().optional(),
  sold_at: z.coerce.date().nullable().optional(),
  sold_in_picking_list: z.string().uuid().nullable().optional(),
});
export type BikeUnit = z.infer<typeof BikeUnitSchema>;

export const BikeUnitWithCatalogSchema = BikeUnitSchema.extend({
  bike_variants: z.object({
    id: z.string(),
    product_id: z.string(),
    size: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    msrp: z.number().nullable().optional(),
    standard_price: z.number().nullable().optional(),
    products: z.object({
      id: z.string(),
      brand: z.string(),
      product_name: z.string(),
      category: z.string().nullable().optional(),
    }),
  }),
});
export type BikeUnitWithCatalog = z.infer<typeof BikeUnitWithCatalogSchema>;
