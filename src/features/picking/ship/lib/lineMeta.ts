/**
 * Bike-or-part and weight for ONE order line in Ship.
 *
 * Two sources, in this order:
 *   1. the live catalog map ShipScreen fetches for the selected order — a
 *      weight corrected after the order was written shows up here first;
 *   2. the stamp the database seals into the item on every write of
 *      picking_lists.items (a_stamp_item_sku_metadata: is_bike, weight_lbs).
 *
 * bug-021 (2026-08-27): the map is fetched AFTER the order — or the merged
 * group — is on screen, and with no metadata at all isBikeSku answers "part".
 * So a bike combined into a completed order was a part with a missing weight
 * for one render: long enough for the parts-weight editor to ask for it and
 * for the autosave to freeze "8 bikes + 1 part" into total_units. The stamp
 * is synchronous and per line, so the first render is already right.
 */

import { isBikeSku } from '../../../../utils/bikeDetection';

export interface LiveMeta {
  is_bike: boolean;
  weight_lbs: number | null;
}

export interface StampedMeta {
  is_bike?: boolean | null;
  weight_lbs?: number | null;
}

export interface LineMeta {
  is_bike: boolean;
  weight_lbs: number | null;
  /** Neither source knows a weight — the parts editor may ask for one. */
  missingWeight: boolean;
}

/** The stamp an item carries, if the DB sealed one. */
export function stampedMeta(item: object | null | undefined): StampedMeta | undefined {
  // PickingListItem's schema does not declare the stamp; the DB writes it anyway.
  return (
    (item as { sku_metadata?: StampedMeta | null } | null | undefined)?.sku_metadata ?? undefined
  );
}

export function resolveLineMeta(
  sku: string,
  live: LiveMeta | undefined,
  stamp: StampedMeta | undefined
): LineMeta {
  const weight_lbs = live?.weight_lbs ?? stamp?.weight_lbs ?? null;
  const flag =
    typeof live?.is_bike === 'boolean'
      ? live.is_bike
      : typeof stamp?.is_bike === 'boolean'
        ? stamp.is_bike
        : undefined;
  const is_bike = flag !== undefined ? flag : isBikeSku(sku, { is_bike: undefined, weight_lbs });
  return { is_bike, weight_lbs, missingWeight: weight_lbs == null };
}
