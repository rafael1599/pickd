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
 * "Model Size Colour" (register_new_sku); a part by its model alone
 * (skuDraftToPrefill), so its size and colour are never appended twice.
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

export function nameAfterSave(input: NameInput): string | null {
  const { mode, isBike, model, size, color, baseline, itemName } = input;
  const touched =
    mode === 'add' ||
    t(model) !== t(baseline.model) ||
    t(size) !== t(baseline.size) ||
    t(color) !== t(baseline.color);
  if (t(model) && touched) {
    return (isBike ? [model, size, color] : [model]).map(t).filter(Boolean).join(' ');
  }
  return t(itemName) || null;
}
