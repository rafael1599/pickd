import { z } from 'zod';
import { SKUMetadataSchema } from './skuMetadata.schema';

/**
 * Distribution Item Schema - describes a physical grouping of units
 * Example: { type: 'TOWER', count: 2, units_each: 30, label: 'near door' }
 */
export const DistributionItemSchema = z.object({
  type: z.enum(['TOWER', 'LINE', 'PALLET', 'OTHER']),
  count: z.coerce.number().int().positive(),
  units_each: z.coerce.number().int().positive(),
  label: z.string().optional(),
});

export type DistributionItem = z.infer<typeof DistributionItemSchema>;

/** Storage type labels for UI display */
export const STORAGE_TYPE_LABELS: Record<
  DistributionItem['type'],
  { short: string; icon: string }
> = {
  TOWER: { short: 'T', icon: '🗼' },
  LINE: { short: 'L', icon: '📏' },
  PALLET: { short: 'P', icon: '📦' },
  OTHER: { short: 'O', icon: '🔹' },
};

/**
 * Raw DB Schema - What Supabase returns from the 'inventory' table
 */
export const InventoryItemDBSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer'),
  sku: z
    .string()
    .trim()
    .min(1, 'sku cannot be empty')
    .refine((s) => !s.includes(' '), 'sku cannot contain spaces'),
  quantity: z.coerce.number().int(),
  location: z.string().nullable(),
  location_id: z.string().nullable().optional(),
  sublocation: z
    .string()
    .regex(/^[A-Z]{1,3}$/)
    .nullable()
    .optional(),
  item_name: z.string().nullable().optional(),
  warehouse: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim().toUpperCase() : val),
    z.enum(['LUDLOW', 'ATS', 'DELETED ITEMS'])
  ),
  status: z.string().nullable().optional(),
  capacity: z.coerce.number().int().positive().optional().nullable(),
  is_active: z.boolean().default(true),
  created_at: z.coerce.date(),
  internal_note: z.string().nullable().optional(),
  distribution: z.array(DistributionItemSchema).default([]),
});

/**
 * Frontend Schema
 */
export const InventoryItemSchema = InventoryItemDBSchema;

/**
 * Schema for creating/updating inventory items
 */
export const InventoryItemInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, 'sku is required')
    .transform((s) => s.replace(/\s/g, '')),
  quantity: z.coerce.number().int().nonnegative(),
  location: z.string().trim().min(1, 'location is required'),
  location_id: z.string().uuid().optional().nullable(),
  sublocation: z
    .string()
    .regex(/^[A-Z]{1,3}$/)
    .nullable()
    .optional(),
  item_name: z.string().optional().nullable(),
  warehouse: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim().toUpperCase() : val),
    z.enum(['LUDLOW', 'ATS', 'DELETED ITEMS'])
  ),
  status: z.string().optional().nullable(),
  capacity: z.coerce.number().int().positive().optional(),
  internal_note: z.string().optional().nullable(),
  distribution: z.array(DistributionItemSchema).optional().default([]),
  // Internal/System fields
  force_id: z.coerce.number().int().positive().optional(),
  isReversal: z.boolean().optional(),
});

// Type exports
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export type InventoryItemDB = z.infer<typeof InventoryItemDBSchema>;
export type InventoryItemInput = z.infer<typeof InventoryItemInputSchema>;

/**
 * Form Schema — extends InventoryItemInput with SKU dimension fields.
 * Used by InventoryModal for the combined inventory + metadata form.
 */
export const InventoryFormSchema = InventoryItemInputSchema.extend({
  length_in: z.coerce.number().optional().nullable(),
  width_in: z.coerce.number().optional().nullable(),
  height_in: z.coerce.number().optional().nullable(),
  weight_lbs: z.coerce.number().nonnegative('Weight cannot be negative').optional().nullable(),
});

export type InventoryFormValues = z.infer<typeof InventoryFormSchema>;

export const InventoryItemWithMetadataSchema = InventoryItemSchema.extend({
  sku_metadata: SKUMetadataSchema.nullable().optional(),
  _lastUpdateSource: z.enum(['local', 'remote']).optional(),
  _lastLocalUpdateAt: z.number().optional(),
});

export type InventoryItemWithMetadata = z.infer<typeof InventoryItemWithMetadataSchema>;
