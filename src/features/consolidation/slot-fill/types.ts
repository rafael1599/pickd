/**
 * Slot-fill domain types — shared between the layout builder UI, the
 * persistence hook, and the candidates RPC bridge.
 *
 * The wire shape is the same one persisted in
 * `warehouse_slot_layouts.layout` (jsonb) and matches the input of
 * `get_slot_fill_candidates` after the same-SKU aggregation step in
 * `slotsToRpcInput`.
 */

export type SlotType = 'tower' | 'line' | 'custom';

export interface Slot {
  /** Stable within the layout. Used as React key and for jsonb diffs. */
  id: string;
  type: SlotType;
  min_qty: number;
  max_qty: number;
}

export interface SlotGroup {
  id: string;
  /** Optional human label like "Front-left" or "Right wall". */
  label?: string;
  /**
   * When true, the candidates engine looks for a SINGLE SKU whose
   * available qty fills the entire group's combined capacity
   * (sum of slot min_qty .. sum of slot max_qty). See
   * `slotsToRpcInput` for the aggregation contract.
   */
  same_sku: boolean;
  slots: Slot[];
}

export interface SlotLayout {
  groups: SlotGroup[];
}

/** Convenience defaults — the quick-add buttons in the UI use these. */
export const SLOT_DEFAULTS: Record<SlotType, { min_qty: number; max_qty: number }> = {
  // Towers fit roughly 30–35 bikes. We widen the lower bound to 26
  // so SKUs that ship at e.g. 28u still surface as candidates rather
  // than being a hard miss.
  tower: { min_qty: 26, max_qty: 40 },
  // A single line holds 4–7 bikes typically.
  line: { min_qty: 4, max_qty: 7 },
  // Custom keeps a small range the operator can edit.
  custom: { min_qty: 10, max_qty: 15 },
};

/** Multiplier shortcut for the "group of N lines" quick-add buttons. */
export function makeLineGroup(lineCount: number): Slot[] {
  return Array.from({ length: lineCount }, () => ({
    id: makeId('s'),
    type: 'line' as SlotType,
    min_qty: SLOT_DEFAULTS.line.min_qty,
    max_qty: SLOT_DEFAULTS.line.max_qty,
  }));
}

let _idCounter = 0;
/**
 * Stable-ish id generator for in-memory layout state. We don't need
 * crypto-grade uniqueness — the id only has to differ from other ids
 * in the same layout instance. Combining a counter with Math.random
 * keeps tests deterministic when they reset the counter, while
 * avoiding collisions across hot reloads.
 */
export function makeId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${_idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Test-only — lets unit tests pin the counter. */
export function _resetIdCounterForTests(): void {
  _idCounter = 0;
}
