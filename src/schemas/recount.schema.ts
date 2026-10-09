import { z } from 'zod';

export const RecountRequestStatusSchema = z.enum(['open', 'closed']);
export type RecountRequestStatus = z.infer<typeof RecountRequestStatusSchema>;

export const RecountRequestSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().min(1),
  warehouse: z.string().default('LUDLOW'),
  location: z.string(),
  reason: z.string(),
  requested_by: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  status: RecountRequestStatusSchema,
  first_counted_by: z.string().uuid().nullable().optional(),
  first_counted_qty: z.number().int().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  closed_by: z.string().uuid().nullable().optional(),
  counted_qty: z.number().int().nullable().optional(),
  expected_qty: z.number().int().nullable().optional(),
  applied_delta: z.number().int().nullable().optional(),
  /** Open orders holding this SKU at this location (v_recount_requests_open); 0 = countable now. */
  held_by_orders: z.number().int().nullable().optional(),
});
export type RecountRequest = z.infer<typeof RecountRequestSchema>;

export const RecountResultTypeSchema = z.enum(['applied', 'matched', 'second_count']);
export type RecountResultType = z.infer<typeof RecountResultTypeSchema>;

export const SubmitRecountResultSchema = z.object({
  result: RecountResultTypeSchema,
  counted: z.number().int(),
  system: z.number().int(),
  delta: z.number().int(),
});
export type SubmitRecountResult = z.infer<typeof SubmitRecountResultSchema>;

export const UnitsHeldByOpenOrdersResultSchema = z.object({
  list_id: z.string().uuid(),
  order_number: z.string(),
  units: z.number().int(),
});
export type UnitsHeldByOpenOrdersResult = z.infer<typeof UnitsHeldByOpenOrdersResultSchema>;
