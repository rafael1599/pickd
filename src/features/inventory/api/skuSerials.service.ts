/**
 * Serials, one row per physical carton.
 *
 * `sku_metadata` keeps one row per SKU, so the serial it holds is the
 * catalogue's answer for every box of that model — right for a Scratch & Dent
 * unit, wrong for a bike that ships by the dozen. `sku_serials` is where a
 * carton's own serial lives, and it fills itself as labels get scanned: no
 * loading campaign, the coverage just grows with use.
 *
 * Recording is best-effort on purpose. A serial that fails to save must never
 * block the registration the operator is actually doing — they came to add a
 * SKU, not to feed a serial table.
 */
import { supabase } from '../../../lib/supabase';
import type { Json } from '../../../integrations/supabase/types';

export interface RecordSerialInput {
  sku: string;
  serial: string;
  warehouse?: string | null;
  /** Where the reading came from: a label photo, a live sweep, or a person. */
  source?: 'label_scan' | 'live_check' | 'manual';
  /** What was read alongside it, kept verbatim so a doubtful row can be audited. */
  observed?: Json | null;
}

export interface SkuSerialRow {
  id: string;
  sku: string;
  serial: string;
  warehouse: string | null;
  source: string;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
}

/** Normalised the same way on write and on read, so a rescan matches. */
export function normalizeSerial(serial: string): string {
  return serial.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Records that this carton was seen. Scanning the same box again bumps its
 * counter and timestamp rather than inserting a twin — the unique index is on
 * (sku, serial), NOT on the serial alone, because whether a serial is unique
 * across SKUs is still an open question (R15) and a collision should land in
 * the table to be measured, not blow up in the operator's face.
 */
export async function recordSkuSerial(input: RecordSerialInput): Promise<'saved' | 'skipped'> {
  const sku = input.sku?.trim();
  const serial = input.serial ? normalizeSerial(input.serial) : '';
  if (!sku || serial.length < 3) return 'skipped';

  const { data: existing } = await supabase
    .from('sku_serials')
    .select('id, seen_count')
    .eq('sku', sku)
    .eq('serial', serial)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('sku_serials')
      .update({ last_seen_at: new Date().toISOString(), seen_count: (existing.seen_count ?? 1) + 1 })
      .eq('id', existing.id);
    return 'saved';
  }

  const { error } = await supabase.from('sku_serials').insert({
    sku,
    serial,
    warehouse: input.warehouse ?? null,
    source: input.source ?? 'label_scan',
    observed: input.observed ?? null,
  });

  return error ? 'skipped' : 'saved';
}

/** Every carton known for a SKU, most recently seen first. */
export async function listSerialsForSku(sku: string): Promise<SkuSerialRow[]> {
  const { data } = await supabase
    .from('sku_serials')
    .select('id, sku, serial, warehouse, source, first_seen_at, last_seen_at, seen_count')
    .eq('sku', sku)
    .order('last_seen_at', { ascending: false });

  return (data ?? []) as SkuSerialRow[];
}

/** Which SKU a serial belongs to — the lookup the whole table exists for. */
export async function findSkuBySerial(serial: string): Promise<SkuSerialRow[]> {
  const normalized = normalizeSerial(serial);
  if (normalized.length < 3) return [];

  const { data } = await supabase
    .from('sku_serials')
    .select('id, sku, serial, warehouse, source, first_seen_at, last_seen_at, seen_count')
    .eq('serial', normalized);

  return (data ?? []) as SkuSerialRow[];
}
