import { useEffect, useRef, useState } from 'react';
import { SYSTEM_NOTE_TAGS, noteKind, type NoteLike } from '../../../utils/systemNotes';
import { supabase } from '../../../lib/supabase';
import {
  byPickPreference,
  planPickAcrossLocations,
  toPickingOrderMap,
  type PickingOrderMap,
  type PickLeg,
  type PickSplit,
} from '../utils/pickLocation';

/** A pick whose frozen location can no longer cover it on its own. */
export interface StaleLocationItem {
  sku: string;
  frozenLocation: string;
  warehouse: string | null;
  suggestedLocation: string | null;
  /** Position inside the suggested row, so the picker gets the whole address. */
  suggestedSublocation: string[] | null;
  suggestedQty: number;
  /**
   * Every stop the pick now needs, in walking order. One leg is the old
   * "it moved, go here instead"; more than one means no single shelf covers
   * the order and the pick is split across addresses.
   */
  legs: PickLeg[];
  /** Units even the full route cannot cover — a real shortage. */
  shortfall: number;
}

/** Minimal shape of an order/cart item this check needs. */
interface StaleCheckItem {
  sku: string;
  location: string | null;
  warehouse?: string | null;
  sku_not_found?: boolean;
  sublocation?: string[] | null;
  picked?: boolean;
  /** Drives the split. Absent → the check stays purely "is the shelf empty?". */
  pickingQty?: number;
  insufficient_stock?: boolean;
  pickSplit?: PickSplit | null;
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

/** What this note is written as. `[AUTO]` alone is what classifies it — see
 *  src/utils/systemNotes.ts and the classify_picking_note trigger. */
export const AUTO_NOTE_PREFIX = `${SYSTEM_NOTE_TAGS.auto_stale_location} Stale pick location`;

const norm = (s: string | null | undefined): string => (s || '').trim().toUpperCase();

/**
 * Pure detection: given order items and the current inventory rows for their
 * SKUs, return the items whose frozen location can no longer cover the pick on
 * its own, along with the route that can. Only active rows count as real stock
 * so register_new_sku placeholders / ghost rows never qualify as a suggestion.
 * Exported separately so it can be unit-tested without Supabase.
 *
 * Two things put an item in the result. The shelf went empty — someone
 * consolidated the row out from under the order — or it still holds units but
 * fewer than the pick needs, which used to surface as a bare `insufficient_stock`
 * flag even when the rest of the bikes were one row over. Both are the same
 * question: where does this pick actually come from now.
 */
export function detectStaleLocations(
  cartItems: StaleCheckItem[],
  rows: StaleInventoryRow[],
  pickingOrder?: PickingOrderMap
): StaleLocationItem[] {
  const result: StaleLocationItem[] = [];

  // Grouped by SKU and warehouse, not by row. An order can already name the
  // same SKU at two addresses — a split from an earlier pass, or a hand-added
  // extra — and planning each row on its own lets both of them claim the same
  // units: two rows needing 13 and 7 would each be sent to a shelf holding 15.
  // One SKU is one question, asked once, against the stock as a whole.
  const groups = new Map<string, StaleCheckItem[]>();
  for (const item of cartItems) {
    if (item.sku_not_found || !item.location) continue;
    const key = `${item.sku}|${norm(item.warehouse)}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const first = group[0];
    const skuRows = rows.filter(
      (r) => r.sku === first.sku && norm(r.warehouse) === norm(first.warehouse)
    );
    if (skuRows.length === 0) continue;

    const stockAt = (location: string | null | undefined): number =>
      skuRows
        .filter((r) => norm(r.location) === norm(location))
        .reduce((sum, r) => sum + Number(r.quantity || 0), 0);

    // Knowing the qty is what separates "it moved" from "it is no longer all in
    // one place". Without one, any stock at all counts, exactly as this read
    // before.
    const required = group.reduce(
      (sum, i) => sum + Math.max(0, Math.trunc(Number(i.pickingQty) || 0)),
      0
    );

    // Nothing to say while every address the order names still covers what it
    // was asked for there.
    const claimed = new Map<string, number>();
    for (const i of group) {
      claimed.set(
        norm(i.location),
        (claimed.get(norm(i.location)) ?? 0) + Math.max(0, Math.trunc(Number(i.pickingQty) || 0))
      );
    }
    const arrangementHolds = [...claimed.entries()].every(([location, qty]) =>
      required > 0 ? stockAt(location) >= qty : stockAt(location) > 0
    );
    if (arrangementHolds) continue;

    const stocked = skuRows.filter((r) => Number(r.quantity || 0) > 0 && r.is_active !== false);
    if (stocked.length === 0) continue; // no stock anywhere → genuine out-of-stock, not stale

    if (required === 0) {
      // No qty to plan against: the old behaviour, move the pick somewhere it exists.
      const elsewhere = stocked
        .filter((r) => norm(r.location) !== norm(first.location))
        .sort(byPickPreference(pickingOrder));
      if (elsewhere.length === 0) continue;

      result.push({
        sku: first.sku,
        frozenLocation: first.location as string,
        warehouse: first.warehouse ?? null,
        suggestedLocation: elsewhere[0].location,
        suggestedSublocation: elsewhere[0].sublocation ?? null,
        suggestedQty: Number(elsewhere[0].quantity || 0),
        legs: [],
        shortfall: 0,
      });
      continue;
    }

    const plan = planPickAcrossLocations(stocked, required, pickingOrder, first.location);
    if (plan.legs.length === 0) continue;

    // Already right where it is, in one stop — nothing to tell the picker.
    if (
      plan.legs.length === 1 &&
      group.length === 1 &&
      norm(plan.legs[0].location) === norm(first.location)
    ) {
      continue;
    }

    result.push({
      sku: first.sku,
      frozenLocation: first.location as string,
      warehouse: first.warehouse ?? null,
      suggestedLocation: plan.legs[0].location,
      suggestedSublocation: plan.legs[0].sublocation,
      suggestedQty: plan.legs[0].available,
      legs: plan.legs,
      shortfall: plan.shortfall,
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
 * When no single shelf covers the pick, the item is split — one row per stop,
 * each carrying the units taken there. The picker gets a card per address
 * instead of a card that quietly asks for more than the shelf holds.
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

  // Keyed on the group the plan was made for, so the whole of a SKU is replaced
  // by the whole of its route. Anything else lets two rows for one SKU each
  // apply the same plan and double the order.
  const byGroup = new Map(moves.map((m) => [`${m.sku}|${norm(m.warehouse)}`, m]));
  const spent = new Set<string>();

  // flatMap, because a pick no single shelf can cover stops being one item.
  // Each leg becomes its own row with its own address and its own share of the
  // qty — which is exactly what the rest of the pipeline is keyed on: pick_item
  // matches (sku, warehouse, location), and process_picking_list deducts per
  // item, so the units come off each shelf in the amount actually taken there.
  const rebased = items.flatMap((item) => {
    if (item.picked) return [item];
    const groupKey = `${item.sku}|${norm(item.warehouse)}`;
    const move = byGroup.get(groupKey);
    if (!move) return [item];

    // The route replaces every row of the group at once, at the position of the
    // first of them. The rest drop out rather than each re-applying it.
    if (spent.has(groupKey)) return [];
    spent.add(groupKey);

    // No qty to plan against: a plain relocation, as this always did.
    if (move.legs.length === 0) {
      return [
        {
          ...item,
          location: move.suggestedLocation,
          sublocation: move.suggestedSublocation,
        },
      ];
    }

    // One stop covers it. The leg carries the group's whole quantity, which
    // matters when the group was several rows and is now one, and the split tag
    // is cleared so a card left over from an earlier pass stops claiming to be
    // part of a route that no longer exists.
    if (move.legs.length === 1) {
      return [
        {
          ...item,
          location: move.legs[0].location,
          sublocation: move.legs[0].sublocation,
          pickingQty: move.legs[0].qty,
          insufficient_stock: move.shortfall === 0 ? false : item.insufficient_stock,
          pickSplit: null,
        },
      ];
    }

    const totalQty = move.legs.reduce((sum, leg) => sum + leg.qty, 0) + move.shortfall;

    return move.legs.map((leg, idx) => ({
      ...item,
      location: leg.location,
      sublocation: leg.sublocation,
      pickingQty: leg.qty,
      // The route covers the order, so the out-of-stock alarm the single-shelf
      // view raised was about the shelf, not the warehouse. A real shortfall
      // leaves it alone.
      insufficient_stock: move.shortfall === 0 ? false : item.insufficient_stock,
      pickSplit: {
        part: idx + 1,
        of: move.legs.length,
        totalQty,
        isLastResort: leg.isLastResort,
      },
    }));
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
        supabase.from('locations').select('warehouse, location, picking_order'),
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
      const alreadyNoted = notes.some((n) => noteKind(n) === 'auto_stale_location');
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
