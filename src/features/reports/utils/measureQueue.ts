/**
 * The measuring queue: which bike box to walk to next, and in what order.
 *
 * `get_bike_demand_ranking` answers the half of the question that needs the
 * database -- how often each bike we still hold was ordered, and where the
 * biggest pile of it sits. This answers the other half: whether FedEx has a
 * usable carton for it, which is {@link fedexCartonGap} and nothing else.
 *
 * That split is on purpose. The gap rule is already shared by the Dimensions
 * export and the double-check warning, and the whole point of it living in one
 * place is that those two cannot disagree about what counts as a measured box.
 * Re-stating it in SQL to filter server-side would be a third answer that
 * drifts from the file it is meant to describe -- and the unfiltered ranking is
 * 264 rows, so there is nothing to gain by it.
 *
 * The order is the ranking's own: most orders first, ties to whichever sold
 * most recently (Rafael, 1 sep 2026). Not a recency-weighted score -- the list
 * has to read exactly like the number printed on each card, or the operator is
 * being asked to trust a formula they cannot check against the row in front of
 * them.
 */
import { fedexCartonGap, type FedexCartonGap } from '../../../utils/fedexCarton';

/** One row of `get_bike_demand_ranking`, as PostgREST returns it. */
export interface BikeDemandRow {
  sku: string;
  model: string | null;
  size: string | null;
  image_url: string | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  dimensions_verified: boolean | null;
  dimensions_measured_at: string | null;
  orders: number;
  units: number;
  last_ordered: string | null;
  stock: number;
  location: string | null;
  sublocation: string[] | null;
}

/** A row that still needs a tape measure, with its place in the queue. */
export interface MeasureQueueEntry extends BikeDemandRow {
  /** 1-based position in the queue, so the card can say "3 of 154". */
  rank: number;
  /** Why FedEx cannot rate this carton. Never null -- that is the filter. */
  gap: FedexCartonGap;
}

/**
 * The bikes with no usable carton, in demand order.
 *
 * Rows arrive already ranked by the RPC; this preserves that order rather than
 * re-sorting, so one rule owns the ranking.
 */
export function toMeasureQueue(rows: BikeDemandRow[]): MeasureQueueEntry[] {
  const queue: MeasureQueueEntry[] = [];
  for (const row of rows) {
    const gap = fedexCartonGap({
      model: row.model,
      length_in: row.length_in,
      width_in: row.width_in,
      height_in: row.height_in,
      dimensions_verified: row.dimensions_verified ?? false,
    });
    if (gap === null) continue;
    queue.push({ ...row, gap, rank: queue.length + 1 });
  }
  return queue;
}

/** `ROW 30 · H`, or just the row when the square is not recorded. */
export function formatAddress(row: Pick<BikeDemandRow, 'location' | 'sublocation'>): string | null {
  if (!row.location) return null;
  const squares = (row.sublocation ?? []).filter(Boolean);
  return squares.length > 0 ? `${row.location} · ${squares.join(' ')}` : row.location;
}

/** Model and size as one phrase, or the honest absence of one. */
export function describeBike(row: Pick<BikeDemandRow, 'model' | 'size'>): string {
  return [row.model, row.size].filter(Boolean).join(' ').trim() || 'no model on the record';
}

/**
 * Matches SKU, model, size and address, so somebody standing in front of a
 * shelf can type `ROW 30` and get the boxes that are in reach.
 */
export function matchesQuery(entry: MeasureQueueEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [entry.sku, entry.model, entry.size, formatAddress(entry)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}
