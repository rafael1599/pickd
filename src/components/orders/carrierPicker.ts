/**
 * The Ship carrier row: as many carriers as fit on ONE line, then "…".
 *
 * Rafael, 2026-08-27, in three steps: "3 + …" → "FedEx never in the top of a
 * regular order" → "make it dynamic: whatever fits on a single line without
 * wrapping to two — responsive". So the row is not a fixed count: the card
 * measures every candidate chip once (hidden) and keeps the ones that fit
 * beside the "…" button at the current width. A phone shows two, a desktop
 * five, and nothing is ever cut in half.
 *
 * Order of preference = use, shipped orders in the 90 days to 2026-08-27:
 * R+L 128 · RIST 27 · PICK UP 23 · DAYLIGHT 22 · PAV EXPRESS 13 · 2-DAY 4 ·
 * ESTES 2 · TFORCE 0. FedEx (37) is not a candidate on a regular order — the
 * lane decides that, not the row — and on a FedEx order it is the only one.
 * The selected carrier is always shown, whichever it is.
 */
export const REGULAR_CARRIER_PRIORITY: readonly string[] = [
  'R+L',
  'RIST',
  'PICK UP',
  'DAYLIGHT',
  'PAV EXPRESS',
  '2-DAY',
  'ESTES',
  'TFORCE',
];

/** Candidates for the row, in the order they should be offered. */
export function carrierCandidates(
  all: readonly string[],
  isFedexOrder: boolean,
  selected: string | null | undefined
): string[] {
  const sel = selected || null;
  if (isFedexOrder) {
    return sel && sel !== 'FEDEX' ? ['FEDEX', sel] : ['FEDEX'];
  }
  const ranked = REGULAR_CARRIER_PRIORITY.filter((c) => all.includes(c));
  const rest = all.filter((c) => c !== 'FEDEX' && !ranked.includes(c));
  const out = [...ranked, ...rest];
  if (sel && !out.includes(sel)) out.unshift(sel);
  return out;
}

/**
 * Cut the candidates to what fits in `available` px (the row minus the "…"
 * button and its gap). Never returns an empty row while there are candidates,
 * and the selected carrier always makes the cut — it takes the last slot if it
 * fell beyond it.
 */
export function fitCarriers(
  candidates: readonly string[],
  widthOf: (company: string) => number,
  available: number,
  gap: number,
  selected: string | null | undefined
): string[] {
  const out: string[] = [];
  let used = 0;
  for (const c of candidates) {
    const need = (out.length ? gap : 0) + widthOf(c);
    if (used + need > available) break;
    out.push(c);
    used += need;
  }
  if (out.length === 0 && candidates.length > 0) out.push(candidates[0]);
  const sel = selected || null;
  if (sel && candidates.includes(sel) && !out.includes(sel)) out[out.length - 1] = sel;
  return out;
}
