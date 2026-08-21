/**
 * The three sides of a box as typed at the double-check station.
 *
 * Separate from the banner that renders it so the rule can be tested without a
 * DOM, and so the component file exports only a component.
 *
 * The order they are typed in does not matter. Which side is the longest is a
 * property of the box, not of how somebody walked the tape around it, so the
 * form takes three numbers and {@link sidesToColumns} decides which column each
 * belongs in. That is also why there is no "sides out of order" error any more:
 * the ordering the export checks for now holds by construction.
 */
import { fedexCartonGap, sidesToColumns, type FedexCartonGap } from '../../../utils/fedexCarton';

/** Three sides, in no particular order. */
export interface CartonDraft {
  one: string;
  two: string;
  three: string;
}

export const EMPTY_CARTON_DRAFT: CartonDraft = { one: '', two: '', three: '' };
export const DRAFT_SIDES: (keyof CartonDraft)[] = ['one', 'two', 'three'];

/** A side is only a side once it is a positive number. */
export function parseSide(value: string): number | null {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The three sides as numbers, or null while any of them is still not one. */
export function draftSides(draft: CartonDraft): [number, number, number] | null {
  const sides = DRAFT_SIDES.map((k) => parseSide(draft[k]));
  return sides.every((n): n is number => n !== null) ? (sides as [number, number, number]) : null;
}

/**
 * Where the three numbers will actually be stored, or null while incomplete.
 * Shown back to the operator before saving: with the ordering check gone, this
 * echo is what catches a typo like 875 for 8.75 -- "875 long" is visibly not a
 * bike box, where a silently sorted 875 would not be.
 */
export function draftColumns(draft: CartonDraft) {
  const sides = draftSides(draft);
  return sides ? sidesToColumns(sides) : null;
}

/**
 * What is wrong with the three numbers as typed, or `null` when they are
 * usable. Runs the export's own rule on the sorted result, so the form and the
 * file cannot disagree about what counts as a carton.
 *
 * `incomplete` covers a side that is blank or not yet a positive number, and it
 * wins over everything else: flashing an error at somebody mid-keystroke
 * teaches them to ignore it.
 */
export function draftProblem(draft: CartonDraft): 'incomplete' | FedexCartonGap | null {
  const columns = draftColumns(draft);
  if (!columns) return 'incomplete';

  return fedexCartonGap({
    // Not editable here; the row keeps whatever model it already has, and a
    // missing one is reported by the warning rather than blocking the save.
    model: 'x',
    ...columns,
    dimensions_verified: true,
  });
}
