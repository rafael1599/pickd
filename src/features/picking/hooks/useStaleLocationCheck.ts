import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';

/** A pick whose frozen location is empty while the SKU has stock elsewhere. */
export interface StaleLocationItem {
  sku: string;
  frozenLocation: string;
  warehouse: string | null;
  suggestedLocation: string | null;
  suggestedQty: number;
}

/** Minimal shape of an order/cart item this check needs. */
interface StaleCheckItem {
  sku: string;
  location: string | null;
  warehouse?: string | null;
  sku_not_found?: boolean;
}

/** Minimal shape of an inventory row this check needs. */
export interface StaleInventoryRow {
  sku: string;
  warehouse: string | null;
  location: string | null;
  quantity: number | null;
  is_active: boolean | null;
}

interface NoteLike {
  message: string;
}

export const AUTO_NOTE_PREFIX = '[AUTO] Stale pick location';

const norm = (s: string | null | undefined): string => (s || '').trim().toUpperCase();

/**
 * Pure detection: given order items and the current inventory rows for their
 * SKUs, return the items whose frozen location now holds 0 units while the same
 * SKU+warehouse has stock in another *active* location. Only active rows count
 * as real stock so register_new_sku placeholders / ghost rows never qualify as a
 * suggestion. Exported separately so it can be unit-tested without Supabase.
 */
export function detectStaleLocations(
  cartItems: StaleCheckItem[],
  rows: StaleInventoryRow[]
): StaleLocationItem[] {
  const result: StaleLocationItem[] = [];
  const seen = new Set<string>();

  for (const item of cartItems) {
    if (item.sku_not_found || !item.location) continue;

    const dedupeKey = `${item.sku}|${norm(item.warehouse)}|${norm(item.location)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const skuRows = rows.filter(
      (r) => r.sku === item.sku && norm(r.warehouse) === norm(item.warehouse)
    );
    if (skuRows.length === 0) continue;

    const frozenQty = skuRows
      .filter((r) => norm(r.location) === norm(item.location))
      .reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    if (frozenQty > 0) continue; // frozen location still has stock → not stale

    const elsewhere = skuRows
      .filter(
        (r) =>
          norm(r.location) !== norm(item.location) &&
          Number(r.quantity || 0) > 0 &&
          r.is_active !== false
      )
      .sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0));
    if (elsewhere.length === 0) continue; // no stock anywhere → genuine out-of-stock, not stale

    result.push({
      sku: item.sku,
      frozenLocation: item.location,
      warehouse: item.warehouse ?? null,
      suggestedLocation: elsewhere[0].location,
      suggestedQty: Number(elsewhere[0].quantity || 0),
    });
  }

  return result;
}

/**
 * Detects stale pick locations for the current order (see {@link detectStaleLocations})
 * and, as instrumentation, persists a single deduped "[AUTO] Stale pick location …"
 * note via `onAddNote` the first time it sees them for a list. That note is what
 * lets us analyze occurrences after the fact instead of doing log archaeology.
 *
 * @param notesReady pass `true` only once the notes prop has finished loading, so
 *   the dedup check against existing notes is reliable.
 */
export function useStaleLocationCheck(
  cartItems: StaleCheckItem[],
  activeListId: string | null | undefined,
  notes: NoteLike[] = [],
  notesReady: boolean = true,
  onAddNote?: (note: string) => Promise<void> | void
): StaleLocationItem[] {
  const [stale, setStale] = useState<StaleLocationItem[]>([]);
  const loggedRef = useRef<string | null>(null);

  const skuKey = [...new Set(cartItems.map((i) => i.sku))].sort().join(',');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const skus = [...new Set(cartItems.map((i) => i.sku).filter(Boolean))];
      if (skus.length === 0) {
        setStale([]);
        return;
      }

      const { data, error } = await supabase
        .from('inventory')
        .select('sku, warehouse, location, quantity, is_active')
        .in('sku', skus);

      if (cancelled || error || !data) return;

      const result = detectStaleLocations(cartItems, data as StaleInventoryRow[]);
      if (cancelled) return;
      setStale(result);

      // Instrumentation — persist once per list, deduped against existing notes.
      const listKey = activeListId ?? null;
      const alreadyNoted = notes.some((n) => n.message?.startsWith(AUTO_NOTE_PREFIX));
      if (
        result.length > 0 &&
        onAddNote &&
        listKey &&
        notesReady &&
        !alreadyNoted &&
        loggedRef.current !== listKey
      ) {
        loggedRef.current = listKey;
        const summary = result
          .map(
            (r) => `${r.sku} @ ${r.frozenLocation} (0) → ${r.suggestedLocation} (${r.suggestedQty})`
          )
          .join('; ');
        try {
          await onAddNote(`${AUTO_NOTE_PREFIX}: ${summary}`);
        } catch {
          loggedRef.current = null; // allow a later retry if the write failed
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuKey, activeListId, notesReady]);

  return stale;
}
