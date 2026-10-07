/**
 * The network half of the batch intake (idea-224): corroborate the pile against
 * the catalogue without writing, then write it in one call.
 *
 * Both reuse what already exists: the preview is `resolve_container_skus` — the
 * same canonicalisation the container intake shows before it writes — and the
 * write is `register_label_batch`, which writes through `apply_intake_lines`.
 */
import { supabase } from '../../../lib/supabase';
import type { BatchPayloadItem, BatchStats, CatalogInfo, SdInfo } from '../utils/labelBatch';

// These RPCs are newer than the generated Supabase types, so they go through a
// narrow, locally typed wrapper instead of `any` (as registrarContainerApi does).
type RpcResult<T> = { data: T | null; error: { message: string } | null };
const callRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>
) => Promise<RpcResult<unknown>>;

interface ResolvedRow {
  canonical_sku: string;
  merged_from: string[] | null;
  is_new: boolean;
  is_bike: boolean | null;
  existing_qty: number | null;
  existing_locations: { location: string | null; qty: number }[] | null;
}

interface MetadataRow {
  sku: string;
  model: string | null;
  size: string | null;
  color: string | null;
  is_bike: boolean | null;
  image_url: string | null;
  unit_kind: string | null;
  sd_number: number | null;
  serial_number: string | null;
}

interface SoldUnit {
  sd_number: number | null;
  serial: string | null;
  name: string | null;
  left_at: string | null;
  left_order: string | null;
}

/** An S/D the way `sd_sold_unit` tells it: `unit_kind = 'sd'`, or an 01- (AS400 gives those only to S/D). */
const isSdSku = (sku: string, m: MetadataRow | undefined) =>
  m?.unit_kind === 'sd' || /^01-/.test(sku);

/**
 * The S/D a SKU already names (SdInfo), so the card neither copies a sold
 * bike's data onto a new one nor adds a second bike to one on the shelf.
 */
async function lookupSd(
  sku: string,
  m: MetadataRow | undefined,
  existingQty: number
): Promise<SdInfo | null> {
  if (!isSdSku(sku, m)) return null;
  const name = m ? [m.model, m.size, m.color].filter(Boolean).join(' ') || null : null;
  if (existingQty > 0)
    return {
      number: m?.sd_number ?? null,
      serial: m?.serial_number ?? null,
      name,
      inStock: true,
      sold: false,
      soldAt: null,
      soldOrder: null,
    };
  const { data, error } = await callRpc('sd_sold_unit', { p_sku: sku });
  if (error) throw new Error(error.message);
  const sold = data as SoldUnit | null;
  if (!sold) return null;
  return {
    number: sold.sd_number,
    serial: sold.serial,
    name: name ?? sold.name,
    inStock: false,
    sold: true,
    soldAt: sold.left_at,
    soldOrder: sold.left_order,
  };
}

/**
 * What the catalogue says about each SKU, keyed by the SKU as the card holds it.
 * A card that reads `03-3768BLD` gets back `canonicalSku = 03-3768BL` when that
 * is where the stock lives, and the card shows the bridge.
 */
export async function lookupBatchCatalog(
  skus: string[],
  warehouse: string
): Promise<Map<string, CatalogInfo>> {
  const wanted = [...new Set(skus.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, CatalogInfo>();
  if (wanted.length === 0) return out;

  const { data, error } = await callRpc('resolve_container_skus', {
    p_items: wanted.map((sku) => ({ sku, qty: 1 })),
    p_warehouse: warehouse,
  });
  if (error) throw new Error(error.message);
  const rows = (data as ResolvedRow[] | null) ?? [];

  const canonical = [...new Set(rows.map((r) => r.canonical_sku))];
  const { data: meta, error: metaError } = await supabase
    .from('sku_metadata')
    .select('sku, model, size, color, is_bike, image_url, unit_kind, sd_number, serial_number')
    .in('sku', canonical);
  if (metaError) throw new Error(metaError.message);
  const bySku = new Map(((meta ?? []) as MetadataRow[]).map((m) => [m.sku, m]));

  for (const sku of wanted) {
    // resolve_container_skus groups what it was given; `merged_from` says which
    // inputs each row came from.
    const row = rows.find((r) => (r.merged_from ?? []).includes(sku));
    if (!row) continue;
    const m = bySku.get(row.canonical_sku);
    const sd = row.is_new ? null : await lookupSd(row.canonical_sku, m, row.existing_qty ?? 0);
    out.set(sku, {
      canonicalSku: row.canonical_sku,
      isNew: row.is_new,
      existingQty: row.existing_qty ?? 0,
      topLocation: row.existing_locations?.[0]?.location ?? null,
      model: m?.model ?? null,
      size: m?.size ?? null,
      color: m?.color ?? null,
      isBike: m?.is_bike ?? row.is_bike ?? null,
      hasImage: !!m?.image_url,
      sd,
    });
  }
  return out;
}

export interface BatchResult {
  batch_id: string;
  location: string;
  warehouse: string;
  skus: number;
  units: number;
  new_skus: string[];
  /** The same batch_id had already been written; nothing was written now. */
  replayed: boolean;
}

export interface SubmitBatchArgs {
  batchId: string;
  location: string;
  items: BatchPayloadItem[];
  userId: string;
  performedBy: string;
  warehouse: string;
  stats: BatchStats & { app_version: string; device: string };
}

export async function submitLabelBatch(args: SubmitBatchArgs): Promise<BatchResult> {
  const { data, error } = await callRpc('register_label_batch', {
    p_batch_id: args.batchId,
    p_location: args.location,
    p_items: args.items,
    p_user_id: args.userId,
    p_performed_by: args.performedBy,
    p_warehouse: args.warehouse,
    p_stats: args.stats,
  });
  if (error) throw new Error(error.message);
  return data as BatchResult;
}
