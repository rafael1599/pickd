import { z } from 'zod';

/**
 * Enum for log action types - prevents typos like 'DEDIT' instead of 'DEDUCT'
 */
export const LogActionType = z.enum([
  'MOVE',
  'ADD',
  'EDIT',
  'DEDUCT',
  'DELETE',
  'SYSTEM_RECONCILIATION',
  'PHYSICAL_DISTRIBUTION',
]);

/**
 * Schema for inventory logs from the database
 */
export const InventoryLogSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  from_warehouse: z.string().nullable(),
  from_location: z.string().nullable(),
  to_warehouse: z.string().nullable(),
  to_location: z.string().nullable(),
  quantity_change: z.coerce.number().int(),
  prev_quantity: z.coerce.number().int().nullable(),
  new_quantity: z.coerce.number().int().nullable(),
  is_reversed: z.boolean().default(false),
  action_type: LogActionType,
  performed_by: z.string(),
  created_at: z.coerce.date(),
  previous_sku: z.string().optional().nullable(),
  item_id: z.union([z.string(), z.number()]).optional().nullable(),
  // UUID-ish columns are written by external actors too (watchdog daemon via
  // service_role) that don't honor this contract — coerce invalid values to
  // null instead of rejecting the whole row (one bad row was killing the
  // entire 100-row logs fetch and with it the velocity suggestions).
  location_id: z.string().uuid().optional().nullable().catch(null),
  to_location_id: z.string().uuid().optional().nullable().catch(null),
  snapshot_before: z.any().optional().nullable(), // For offline resilience snapshots
  list_id: z.string().uuid().optional().nullable().catch(null),
  order_number: z.string().optional().nullable(),
  user_id: z.string().uuid().optional().nullable().catch(null),
  note: z.string().optional().nullable(),
});

/**
 * Schema for creating new logs
 */
export const InventoryLogInputSchema = z.object({
  sku: z.string().min(1),
  from_warehouse: z.string().optional(),
  from_location: z.string().optional(),
  to_warehouse: z.string().optional(),
  to_location: z.string().optional(),
  quantity_change: z.coerce.number().int(),
  prev_quantity: z.coerce.number().int().optional(),
  new_quantity: z.coerce.number().int().optional(),
  is_reversed: z.boolean().optional(),
  action_type: LogActionType,
  performed_by: z.string().optional(),
  previous_sku: z.string().optional().nullable(),
  item_id: z.union([z.string(), z.number()]).optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  to_location_id: z.string().uuid().optional().nullable(),
  snapshot_before: z.any().optional().nullable(),
  list_id: z.string().uuid().optional().nullable(),
  order_number: z.string().optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
});

// Type exports
export type InventoryLog = z.infer<typeof InventoryLogSchema>;
export type InventoryLogInput = z.infer<typeof InventoryLogInputSchema>;
export type LogActionTypeValue = z.infer<typeof LogActionType>;
