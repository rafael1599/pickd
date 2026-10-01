/**
 * The name a save leaves on an inventory row.
 *
 * The add/edit form has no name field: the name follows the structured fields.
 * Rebuilding it on every save was the bug. `99-4807CL`
 * (`JRP FRAME RENEGADE S1 54 2024 CHARCOAL`, no model) became `54cm CHARCOAL`
 * when Rafael switched it to a part (23 sep 2026), and ~700 names that carry
 * more than "model size colour" — `PEDAL TAXI 2020 20 GLOSS BLACK`, the AS400
 * year — were one unrelated edit away from losing it.
 *
 * So the name is rebuilt only when there is a model **and** this save is a new
 * registration or touched model, size or colour. A bike is named
 * "Model Size Year Colour", the AS400's order; a part by its model alone
 * (skuDraftToPrefill), so its size and colour are never appended twice.
 *
 * **The year is kept from the name** (1 oct 2026). No column holds it — the
 * catalogue's `received_year` is when a box arrived, and the same SKU number
 * carries 2025 on one row and 2026 in AS400 — so the name is its only home, and
 * rebuilding from model/size/colour dropped it: `CODA S2 L16 2025 GLOSS BLACK`
 * became `CODA S2 L16 MATTE BLACK` on a colour change, and a bike registered
 * from Double Check lost the year its AS400 description gave it.
 */
export interface NameInput {
  mode: 'add' | 'edit';
  isBike: boolean;
  model: string | null | undefined;
  size: string | null | undefined;
  color: string | null | undefined;
  /** What model, size and colour were when the form opened. */
  baseline: { model: string; size: string; color: string };
  /** The name the row has now. */
  itemName: string | null | undefined;
}

const t = (v: string | null | undefined) => (v ?? '').trim();

const YEAR = /\b(20\d{2})\b/g;

/** The model year a name carries (the last `20xx`), if any. */
export function yearInName(name: string | null | undefined): string | null {
  const all = t(name).match(YEAR);
  return all ? all[all.length - 1] : null;
}

export function nameAfterSave(input: NameInput): string | null {
  const { mode, isBike, model, size, color, baseline, itemName } = input;
  const touched =
    mode === 'add' ||
    t(model) !== t(baseline.model) ||
    t(size) !== t(baseline.size) ||
    t(color) !== t(baseline.color);
  if (t(model) && touched) {
    if (!isBike) return t(model);
    const year = yearInName(itemName);
    const carried = year && ![model, size, color].some((v) => yearInName(v) === year);
    return [model, size, carried ? year : '', color].map(t).filter(Boolean).join(' ');
  }
  return t(itemName) || null;
}
