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
  // Set by the DB whenever a dimension changes value, so callers never send it.
  // Distinguishes a measured carton from one the defaults trigger filled in —
  // the FedEx export ships only verified rows. See 20260820170000.
  dimensions_verified: z.boolean().optional(),
  /** When a dimension was last measured; compared against the last FedEx export. */
  dimensions_measured_at: z.string().nullish(),
  // True once a scale was involved. Same owner and same rules as
  // dimensions_verified — set by the trigger on a value change or on an explicit
  // true from a form that just weighed the box, and never lowered. Tells a real
  // 45 lbs apart from the 45 the defaults trigger writes. See 20260901204403.
  weight_verified: z.boolean().optional(),
  // S/D extension columns (all NULL for non-S/D items)
  model: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  // Relaxed from BikeConditionEnum in idea-083 so the generic "Details"
  // section can store general values (new | used | damaged | refurbished)
  // alongside legacy S/D-specific ones (new_unbuilt, defective_frame, …).
  // The DB column stores free-form text; UI dropdowns validate per context.
  condition: z.string().nullable().optional(),
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
