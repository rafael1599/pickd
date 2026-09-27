import { z } from 'zod';

export const PalletDimSchema = z.object({
  pallet: z.number().int().positive(),
  length_in: z.number().positive().nullable(),
  width_in: z.number().positive().nullable(),
  height_in: z.number().positive().nullable(),
  units: z.number().int().nonnegative(),
  measured_by: z.string().nullable().optional(),
  measured_at: z.string().nullable().optional(),
});

export type PalletDim = z.infer<typeof PalletDimSchema>;

export const ShipmentSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  customer_id: z.string().uuid().nullable().optional(),
  ship_to_address_id: z.string().uuid().nullable().optional(),
  transport_company: z.string().nullable().optional(),
  load_number: z.string().nullable().optional(),
  pallets_qty: z.number().int().nonnegative(),
  total_weight_lbs: z.number().nonnegative().nullable().optional(),
  pallet_dims: z.array(PalletDimSchema).nullable().optional(),
  pallet_photos: z.array(z.string()).nullable().optional(),
  is_shipped: z.boolean(),
  shipped_at: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Shipment = z.infer<typeof ShipmentSchema>;
