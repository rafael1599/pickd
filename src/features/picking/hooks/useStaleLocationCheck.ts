import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { byPickPreference, toPickingOrderMap, type PickingOrderMap } from '../utils/pickLocation';

/** A pick whose frozen location is empty while the SKU has stock elsewhere. */
export interface StaleLocationItem {
  sku: string;
  frozenLocation: string;
  warehouse: string | null;
  suggestedLocation: string | null;
  /** Position inside the suggested row, so the picker gets the whole address. */
  suggestedSublocation: string[] | null;
  suggestedQty: number;
}

/** Minimal shape of an order/cart item this check needs. */
interface StaleCheckItem {
  sku: string;
  location: string | null;
  warehouse?: string | null;
  sku_not_found?: boolean;
  sublocation?: string[] | null;
  picked?: boolean;
}

/** Minimal shape of an inventory row this check needs. */
export interface StaleInventoryRow {
  sku: string;
  warehouse: string | null;
  location: string | null;
  quantity: number | null;
  /** Absent is treated as active — only an explicit `false` disqualifies a row. */
  is_active?: boolean | null;
  sublocation?: string[] | null;
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
  rows: StaleInventoryRow[],
  pickingOrder?: PickingOrderMap
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
      .sort(byPickPreference(pickingOrder));
    if (elsewhere.length === 0) continue; // no stock anywhere → genuine out-of-stock, not stale

    result.push({
      sku: item.sku,
      frozenLocation: item.location,
      warehouse: item.warehouse ?? null,
      suggestedLocation: elsewhere[0].location,
      suggestedSublocation: elsewhere[0].sublocation ?? null,
      suggestedQty: Number(elsewhere[0].quantity || 0),
    });
  }

  return result;
}

/**
 * Moves each pick to wherever its stock actually is.
 *
 * A pick freezes the location the SKU was in when the order was built. Another
 * user consolidating a row hours later leaves that address empty, and every
 * check keyed on it then reads "no stock" for a bike that is sitting one row
 * over — the picker is blocked from sending the order to double-check by an
 * order that is, physically, entirely fillable.
 *
 * Naming the new address is not enough: the item still carries the old one, so
 * whatever the banner says, the guard still fails and the deduction would still
 * be aimed at an empty shelf. This rebases the item itself, which is what makes
 * the rest of the pipeline agree with the floor.
 *
 * Only unpicked items move. A picked one is already on the pallet, so its
 * location is spent history — and rewriting it would read to
 * `compensate_picking_list_changes` as a remove-and-re-add of a picked item,
 * which restores and re-deducts stock for a bike that never moved.
 */
export function rebaseToActualStock<T extends StaleCheckItem>(
  items: T[],
  rows: StaleInventoryRow[],
  pickingOrder?: PickingOrderMap
): { items: T[]; moves: StaleLocationItem[] } {
  const moves = detectStaleLocations(
    items.filter((i) => !i.picked),
    rows,
    pickingOrder
  ).filter((m) => !!m.suggestedLocation);

  if (moves.length === 0) return { items, moves };

  const byItem = new Map(
    moves.map((m) => [`${m.sku}|${norm(m.warehouse)}|${norm(m.frozenLocation)}`, m])
  );

  const rebased = items.map((item) => {
    if (item.picked) return item;
    const move = byItem.get(`${item.sku}|${norm(item.warehouse)}|${norm(item.location)}`);
    if (!move) return item;
    return {
      ...item,
      location: move.suggestedLocation,
      sublocation: move.suggestedSublocation,
    };
  });

  return { items: rebased, moves };
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

      const [{ data, error }, { data: locationRows }] = await Promise.all([
        supabase
          .from('inventory')
          .select('sku, warehouse, location, quantity, is_active, sublocation')
          .in('sku', skus),
        supabase.from('locations').select('location, picking_order'),
      ]);

      if (cancelled || error || !data) return;

      const result = detectStaleLocations(
        cartItems,
        data as StaleInventoryRow[],
        toPickingOrderMap(locationRows)
      );
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
