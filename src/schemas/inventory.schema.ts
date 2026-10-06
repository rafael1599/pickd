import { z } from 'zod';
import { SKUMetadataSchema } from './skuMetadata.schema';

/**
 * Distribution Item Schema - describes a physical grouping of units
 * Example: { type: 'TOWER', count: 2, units_each: 30, square: 'F' }
 */
export const DistributionItemSchema = z.object({
  type: z.enum(['TOWER', 'LINE', 'PALLET', 'OTHER']),
  count: z.coerce.number().int().positive(),
  units_each: z.coerce.number().int().positive(),
  label: z.string().optional(),
  /**
   * The square of the ROW the group stands in (idea-253, 6 Oct 2026). A
   * square's units are the sum of its groups — never stored apart. Without
   * this key here, Zod would strip it on the first read and the next save
   * would erase every square.
   */
  square: z
    .string()
    .regex(/^[A-Z]$/)
    .optional(),
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
    .array(z.string().regex(/^[A-Z]$/))
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
  // Enrichment fields populated by search_inventory_with_metadata when the
  // row is a FedEx return (unit_kind = return, its SKU the tracking). NULL otherwise.
  fedex_tracking_number: z.string().nullable().optional(),
  // When a return came in (its card's birth, not the row's): the Return list
  // reads newest first (Rafael, 6 oct 2026). NULL for any other unit.
  received_at: z.string().nullable().optional(),
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
    .array(z.string().regex(/^[A-Z]$/))
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
  // Not an inventory column: the type chosen on a New Item form, handed to the
  // sku_metadata shell so the DB trigger picks the right weight and box
  // defaults. Stripped before the inventory insert (inventory.service addItem).
  is_bike: z.boolean().nullish(),
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
  // idea-083: "Details" section — universal extra info per SKU.
  // All stored on sku_metadata (columns already exist for S/D). Accepted for
  // any item regardless of is_bike / is_scratch_dent.
  model: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  serial_number: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  price: z.coerce.number().nonnegative().optional().nullable(),
  condition: z.string().optional().nullable(),
  condition_description: z.string().optional().nullable(),
  pdf_link: z.string().optional().nullable(),
  // S/D card (30 Sep 2026): the rest of what a S/D unit is sold with.
  category: z.string().optional().nullable(),
  msrp: z.coerce.number().nonnegative().optional().nullable(),
  standard_price: z.coerce.number().nonnegative().optional().nullable(),
});

export type InventoryFormValues = z.infer<typeof InventoryFormSchema>;

export const InventoryItemWithMetadataSchema = InventoryItemSchema.extend({
  sku_metadata: SKUMetadataSchema.nullable().optional(),
  _lastUpdateSource: z.enum(['local', 'remote']).optional(),
  _lastLocalUpdateAt: z.number().optional(),
});

export type InventoryItemWithMetadata = z.infer<typeof InventoryItemWithMetadataSchema>;
