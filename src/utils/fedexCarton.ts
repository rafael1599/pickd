/**
 * Does this SKU have a carton FedEx Ship Manager can rate — and if not, why?
 *
 * One rule, two callers, on purpose. The Dimensions export
 * (`features/reports/utils/fedexDimensions.ts`) uses it to decide what goes in
 * the file and what goes to the exceptions report; DoubleCheckView uses it to
 * warn, before a FedEx order ships, that the box about to go out has no record
 * on the FedEx side. Those two have to agree: a SKU the export silently held
 * back is exactly the SKU nobody knows is missing until the rate comes back
 * wrong, and the whole point of the warning is to say so while the box is still
 * in front of someone.
 *
 * It lives in utils rather than inside the reports feature because picking may
 * not import across features, and because the answer is a property of the SKU
 * rather than of either screen.
 */

/** Three characters in the FSM field, so 999 is the largest it can carry. */
export const MAX_FSM_DIMENSION = 999;

/**
 * ASCII only, no double quotes, collapsed whitespace. The export format forbids
 * a double quote anywhere in the data, so `''` stands in for inch marks.
 */
export function toAscii(text: string): string {
  return text
    .replace(/["‘’“”]/g, "'")
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Why a SKU has no usable carton. `null` from the check below means it does. */
export type FedexCartonGap =
  /** Dimensions are still whatever the defaults trigger wrote. */
  | 'unverified'
  /** Measured, but there is no model to name the record after. */
  | 'no_model'
  /** A dimension is missing, or too large to fit the 3-character field. */
  | 'unusable_dimensions'
  /** The three sides do not order as longest ≥ middle ≥ thinnest. */
  | 'implausible_dimensions';

/** The columns the check reads. Mirrors `sku_metadata`, nothing more. */
export interface FedexCartonRow {
  model: string | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  dimensions_verified: boolean;
}

/**
 * Returns the first reason this SKU cannot ship as a rated carton, or `null`
 * when it can.
 *
 * The axis swap is why the ordering test looks backwards: Pickd stores
 * length/width/height as longest/thinnest/middle, while FSM wants Length,
 * Width, Height as longest, middle, thinnest — so FSM's Width comes from
 * `height_in` and its Height from `width_in`.
 */
export function fedexCartonGap(row: FedexCartonRow): FedexCartonGap | null {
  if (!row.dimensions_verified) return 'unverified';
  if (!toAscii(row.model ?? '')) return 'no_model';

  const { length_in: l, width_in: w, height_in: h } = row;
  if (l == null || w == null || h == null) return 'unusable_dimensions';

  // Whole inches, rounded up: a carton is never declared smaller than measured.
  const length = Math.ceil(l);
  const width = Math.ceil(h);
  const height = Math.ceil(w);
  if ([length, width, height].some((d) => !Number.isFinite(d) || d <= 0 || d > MAX_FSM_DIMENSION)) {
    return 'unusable_dimensions';
  }

  // A carton's sides order as longest ≥ middle ≥ thinnest. Breaking that order
  // means a value is in the wrong magnitude for its axis, which is what a lost
  // decimal looks like: 03-4046MN sat at width_in 875 for 8.75, and 875 is
  // three characters, so the field-width check above passes it straight to
  // FedEx. This catches the class rather than that one row — and it needs no
  // threshold, so the genuinely small cartons stay in: a Hot Rod at 30/17/8
  // and a framekit at 48/24/8 both order correctly.
  if (!(length >= width && width >= height)) return 'implausible_dimensions';

  return null;
}

/** Why a SKU was held back, in the words both the report and the warning use. */
export const FEDEX_CARTON_GAP_LABELS: Record<FedexCartonGap, string> = {
  unverified: 'Dimensions never measured',
  no_model: 'No model on the record',
  unusable_dimensions: 'Dimension missing or out of range',
  implausible_dimensions: 'Sides do not order as a carton',
};
