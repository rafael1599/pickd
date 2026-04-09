import { z } from 'zod';
import { InventoryItemSchema } from './inventory.schema';

/**
 * Zod schema for Picking List items (items column in picking_lists)
 */
export const PickingListItemSchema = InventoryItemSchema.extend({
  pickingQty: z.number().int().positive(),
  checked: z.boolean().optional(),
});

export type PickingListItem = z.infer<typeof PickingListItemSchema>;

/**
 * Zod schema for combine_meta (auto-combined orders provenance)
 */
export const CombineMetaSchema = z
  .object({
    is_combined: z.boolean(),
    source_orders: z.array(
      z.object({
        order_number: z.string(),
        added_at: z.string(),
        item_count: z.number().optional(),
        pdf_hash: z.string().optional(),
        file_name: z.string().optional(),
      })
    ),
  })
  .nullable()
  .optional();

export type CombineMeta = z.infer<typeof CombineMetaSchema>;

/**
 * Zod schema for the picking_lists table
 */
export const PickingListSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  customer_id: z.string().uuid().nullable(),
  order_number: z.string().nullable(),
  pallets_qty: z.number().int().nonnegative().nullable(),
  status: z.enum([
    'active',
    'ready_to_double_check',
    'double_checking',
    'needs_correction',
    'completed',
    'cancelled',
    'reopened',
  ]),
  items: z.array(PickingListItemSchema).nullable(),
  correction_notes: z.string().nullable(),
  checked_by: z.string().uuid().nullable(),
  combine_meta: CombineMetaSchema,
  source: z.string().nullable().optional(),
  is_addon: z.boolean().nullable().optional(),
  group_id: z.string().uuid().nullable().optional(),
  total_weight_lbs: z.number().nonnegative().nullable().optional(),
  completed_snapshot: z.array(PickingListItemSchema).nullable().optional(),
  reopened_by: z.string().uuid().nullable().optional(),
  reopened_at: z.string().nullable().optional(),
  reopen_count: z.number().int().nonnegative().optional(),
  pallet_photos: z.array(z.string()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type PickingList = z.infer<typeof PickingListSchema>;
