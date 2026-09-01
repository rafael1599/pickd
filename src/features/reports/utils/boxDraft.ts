/**
 * What somebody standing at a box can write down, and what of it is savable.
 *
 * Three sides and a weight, typed in whatever units the tape and the scale
 * happen to read in. Kept out of the component so the rules can be tested
 * without a DOM, and so the screen never decides on its own what counts as a
 * usable reading.
 *
 * The unit is a property of the scale, not of the box, so it is one choice for
 * the whole screen rather than a control on every card -- flipping it on one
 * card flips it everywhere and is remembered. What gets stored is always
 * pounds: `weight_lbs` is what Ship totals, what the station types into Audit
 * Source, and what `classify_picking_list_fedex` routes on. A kilogram column
 * beside it would be a second number for one fact, and the two can only drift.
 */
import { draftSides, draftProblem, type CartonDraft } from '../../picking/utils/cartonDraft';

export type WeightUnit = 'lbs' | 'kg';

/** The international avoirdupois pound, exact by definition since 1959. */
export const LBS_PER_KG = 2.20462262185;

/** Kilograms to pounds, rounded to the tenth a scale and a shipper both use. */
export function kgToLbs(kg: number): number {
  return Math.round(kg * LBS_PER_KG * 10) / 10;
}

/** Pounds to kilograms, same precision, so a round trip does not wander. */
export function lbsToKg(lbs: number): number {
  return Math.round((lbs / LBS_PER_KG) * 10) / 10;
}

/** What the operator typed, in the unit the screen is set to. */
export function weightToLbs(value: string, unit: WeightUnit): number | null {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return unit === 'kg' ? kgToLbs(n) : Math.round(n * 10) / 10;
}

/** The stored weight shown back in the unit the screen is set to. */
export function lbsToUnit(lbs: number, unit: WeightUnit): number {
  return unit === 'kg' ? lbsToKg(lbs) : lbs;
}

/** What a save would write, or why it cannot yet. */
export interface BoxSavePlan {
  /** The three sides, when all three are usable. */
  sides: [number, number, number] | null;
  /** The weight in pounds, when one was typed and it differs from the stored one. */
  weightLbs: number | null;
  /** Nothing worth saving, or a reading that is not one yet. */
  blocked: 'empty' | 'incomplete_sides' | 'bad_sides' | null;
}

/**
 * Decides what a Save writes.
 *
 * Either half stands on its own: a scale with no tape measure is still worth a
 * trip, and so is the reverse. What is refused is a half-typed set of sides --
 * saving two of three would store a carton nobody measured under a flag that
 * says somebody did.
 */
export function planBoxSave(
  draft: CartonDraft,
  weightValue: string,
  unit: WeightUnit,
  storedLbs: number | null
): BoxSavePlan {
  const sides = draftSides(draft);
  const sidesProblem = draftProblem(draft);
  const typedSomeSide = Object.values(draft).some((v) => v.trim() !== '');

  const typedWeight = weightToLbs(weightValue, unit);
  // Re-saving the number already on the row is not a correction; leaving it out
  // keeps the write to what actually changed.
  const weightLbs = typedWeight !== null && typedWeight !== storedLbs ? typedWeight : null;

  if (sides && !sidesProblem) return { sides, weightLbs, blocked: null };
  // Sides that parse but cannot be a carton (a lost decimal: 875 for 8.75).
  if (sides && sidesProblem) return { sides: null, weightLbs: null, blocked: 'bad_sides' };
  if (typedSomeSide) return { sides: null, weightLbs: null, blocked: 'incomplete_sides' };
  if (weightLbs !== null) return { sides: null, weightLbs, blocked: null };
  return { sides: null, weightLbs: null, blocked: 'empty' };
}
