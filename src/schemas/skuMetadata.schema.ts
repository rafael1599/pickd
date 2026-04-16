import { z } from 'zod';

export const BikeConditionEnum = z.enum([
  'new_unbuilt',
  'new_built',
  'ridden_demo',
  'returned',
  'defective_frame',
]);
export type BikeCondition = z.infer<typeof BikeConditionEnum>;

export const SDCategoryEnum = z.enum(['sd', 'demo']);
export type SDCategory = z.infer<typeof SDCategoryEnum>;

export const SKUMetadataSchema = z.object({
  id: z.string().optional(),
  sku: z.string().min(1),
  image_url: z.string().nullable().optional(),
  is_bike: z.boolean().nullable().optional(),
  // DB column has DEFAULT FALSE, so callers may omit on insert/update.
  is_scratch_dent: z.boolean().optional(),
  upc: z.string().nullable().optional(),
  length_in: z.number().nullish().optional(),
  width_in: z.number().nullish().optional(),
  height_in: z.number().nullish().optional(),
  length_ft: z.number().nullish().optional(),
  weight_lbs: z.number().nullish().optional(),
  // S/D extension columns (all NULL for non-S/D items)
  model: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  condition: BikeConditionEnum.nullable().optional(),
  condition_description: z.string().nullable().optional(),
  sd_category: SDCategoryEnum.nullable().optional(),
  msrp: z.number().nullable().optional(),
  standard_price: z.number().nullable().optional(),
  sd_price: z.number().nullable().optional(),
  pdf_link: z.string().nullable().optional(),
  created_at: z.coerce.date().optional(),
  updated_at: z.coerce.date().optional(),
});

export type SKUMetadata = z.infer<typeof SKUMetadataSchema>;

export const SKUMetadataInputSchema = SKUMetadataSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type SKUMetadataInput = z.infer<typeof SKUMetadataInputSchema>;
