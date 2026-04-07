import { z } from 'zod';

export const SKUMetadataSchema = z.object({
  id: z.string().optional(),
  sku: z.string().min(1),
  image_url: z.string().nullable().optional(),
  is_bike: z.boolean().nullable().optional(),
  upc: z.string().nullable().optional(),
  length_in: z.number().nullish().optional(),
  width_in: z.number().nullish().optional(),
  height_in: z.number().nullish().optional(),
  weight_lbs: z.number().nullish().optional(),
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
