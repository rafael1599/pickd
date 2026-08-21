/**
 * Electric bikes — the ones with a lithium battery bolted into the frame, which
 * is what makes them different from every other box in the building: a carrier
 * won't take one as ordinary freight. The carton has to carry the lithium-ion
 * mark before it leaves, and the operator is the only one who can put it there.
 *
 * So the Ship screen warns, the same way it warns that Daylight hasn't been
 * texted — see `daylightPickupSms.ts`, whose reminder this one sits beside.
 *
 * ## Two signals, because neither one is enough on its own
 *
 * 1. {@link ELECTRIC_BIKE_SKUS} — the catalog as verified against prod on
 *    2026-08-20. Load-bearing, not a convenience: 18% of all order items
 *    (1.035 of 5.814) carry NO `item_name`, and twelve of those are Defcon and
 *    Hudson e-bikes. A name-only rule misses every one of them silently.
 * 2. {@link hasElectricModelToken} — the model designation, for a SKU minted
 *    after this file was written. JAMIS names its electric line by an `E` plus
 *    a generation digit: `HUDSON E1`, `HUDSON E2 S/T`, `DEFCON E1`, `DEFCON E2`.
 *    A hardcoded list rots the first time a new colorway is registered; the
 *    pattern is what keeps the alert from going quiet that day.
 *
 * ## What the pattern must NOT match
 *
 * The digit is doing real work. `EC1`, `EC2` and `EC3` are the **Earth Cruiser**,
 * a pedal bike — verified, not assumed: `06-4470TL EC3 18 TEAL FO REAL` and the
 * scratch-and-dent `Y25B001636 EARTH CRUISER 3 18" TEAL FO REAL` are the same
 * bike under both names, down to the colorway. `E` glued to a letter is not a
 * generation, so `EC3` never matches while `E1` does.
 *
 * The remaining collision is `99-3604 TOOL HYENA DIAGNOSTIC (E2)` — the service
 * tool FOR the E2, not an E2 — which has appeared in seven real orders. That is
 * what `isBike === false` is for below: the tool is a part, and a part has no
 * battery. The check is `false`, not falsy, because "not resolved yet" has to
 * keep warning rather than go quiet.
 *
 * Deliberately NOT used as signals, both verified against prod and both wrong:
 *
 * - **Location.** `ROW 51` holds the Defcons *and* the Faultline A1/A2/A3, which
 *   are pedal bikes. Same trap as the one `CLAUDE.md` documents for `is_bike`.
 * - **Weight.** `weight_lbs = 80` looks like a tell until you notice
 *   `03-3606BL` (Hudson E2 Step-Thru) and `03-4611BK` (Defcon E2 17") sit at 45,
 *   the registration default. Two of eighteen would have shipped unmarked.
 */
import { inventorySkuCandidates } from './skuNormalize';

/**
 * Every electric SKU in the catalog on 2026-08-20, from a full sweep of
 * `sku_metadata` joined to `inventory` — four model families, nothing else in
 * the building. Colorways and sizes are separate SKUs, so the list is longer
 * than the four names suggest.
 *
 * `03-4865GY` is in here as an e-bike even though its `model` column reads
 * `AUTO-RESTORE: ITEM REPLACE…` — picking-note text landed in the column
 * (bug-018). Its `item_name` is intact, but a SKU whose metadata is already
 * corrupted is exactly the one not to depend on parsing.
 */
export const ELECTRIC_BIKE_SKUS: ReadonlySet<string> = new Set([
  // Hudson E1 (2026)
  '03-4864BL', // 19 Midnight Blue
  '03-4865GY', // 19 Dakota Grey
  '03-4866BL', // Step-Over 14 Midnight Blue
  '03-4867MN', // Step-Over 14 Vanilla Mint
  '03-4868BL', // Step-Over 18 Midnight Blue
  '03-4869MN', // Step-Over 18 Vanilla Mint
  // Hudson E2
  '03-3604BL', // 27.5"x19" Deep Blue
  '03-3606BL', // Step-Thru 27.5"x14" Deep Blue
  '03-3607GY', // Step-Thru 27.5"x14" Thunder Gray
  'Y21A003411', // 18" Deep Blue — scratch & dent
  // Defcon E1 (2026 Galactic)
  '03-4606BL', // 15
  '03-4607BL', // 17
  '03-4608BL', // 19
  '03-4609BL', // 21
  // Defcon E2 (2026 Black Coal)
  '03-4610BK', // 15
  '03-4611BK', // 17
  '03-4612BK', // 19
  '03-4613BK', // 21
]);

/**
 * `E` + generation digit as a standalone token: matches `HUDSON E1`,
 * `DEFCON E2 19 2026 BLACK COAL` and `E-2`, but not `EC3` (Earth Cruiser) nor
 * the `E BRAKE` in `31-216 CABLE BOX DIACOMP E BRAKE`, which has no digit.
 *
 * Anchored on non-alphanumerics rather than `\b`, because `\b` sits happily
 * between `C` and `1` and would let `EC1` through.
 */
const ELECTRIC_MODEL_TOKEN = /(?:^|[^A-Z0-9])E-?[0-9](?:[^A-Z0-9]|$)/;

/** True when a name carries an `E<digit>` generation token. */
export function hasElectricModelToken(name: string | null | undefined): boolean {
  return ELECTRIC_MODEL_TOKEN.test((name ?? '').toUpperCase());
}

/**
 * True when this SKU is a known electric one. Runs the same candidate list the
 * rest of the app uses for inventory lookups, so the watcher's de-dashed
 * `034869MN` and its mangled `03-4869MND` resolve to the same bike.
 */
export function isElectricBikeSku(sku: string | null | undefined): boolean {
  return inventorySkuCandidates(sku).some((candidate) =>
    ELECTRIC_BIKE_SKUS.has(candidate.toUpperCase())
  );
}

/** Anything item-shaped: an order line, an inventory row, a search result. */
export interface ElectricBikeCandidate {
  sku: string;
  item_name?: string | null;
  /**
   * Resolved `sku_metadata.is_bike`. `undefined` means the lookup hasn't come
   * back yet — which still warns, on purpose. A missing label is a shipment
   * that gets refused or re-rated; a spurious one costs a glance.
   */
  isBike?: boolean;
}

/** True when this order line is an electric bike. */
export function isElectricBikeItem(item: ElectricBikeCandidate): boolean {
  if (isElectricBikeSku(item.sku)) return true;
  // Known-not-a-bike kills the name match, and nothing else does: this is the
  // one branch standing between the E2 diagnostic tool and a battery label.
  if (item.isBike === false) return false;
  return hasElectricModelToken(item.item_name);
}

/** One electric SKU on an order, with every unit of it summed. */
export interface ElectricBikeLine {
  sku: string;
  /** Best name seen for the SKU, or null when no line carried one. */
  name: string | null;
  units: number;
}

/**
 * The electric bikes on an order: one entry per SKU, units summed, in the order
 * the SKUs first appear. A combined order can list the same bike once per source
 * order, and the alert names SKUs — repeating one reads as two different bikes.
 */
export function collectElectricBikeLines<T extends ElectricBikeCandidate>(
  items: readonly T[] | null | undefined,
  quantityOf: (item: T) => number
): ElectricBikeLine[] {
  const bySku = new Map<string, ElectricBikeLine>();

  for (const item of items ?? []) {
    if (!item?.sku || !isElectricBikeItem(item)) continue;
    const units = Math.max(0, quantityOf(item) || 0);
    const existing = bySku.get(item.sku);
    const name = item.item_name?.trim() || null;
    if (existing) {
      existing.units += units;
      existing.name = existing.name ?? name;
    } else {
      bySku.set(item.sku, { sku: item.sku, name, units });
    }
  }

  return [...bySku.values()];
}

/** Total units across every electric line — what the headline counts. */
export function totalElectricUnits(lines: readonly ElectricBikeLine[]): number {
  return lines.reduce((sum, line) => sum + line.units, 0);
}
