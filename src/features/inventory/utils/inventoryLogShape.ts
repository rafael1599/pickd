/**
 * Helpers to read `inventory_logs.MOVE` rows uniformly across the two
 * historical emission shapes.
 *
 * Background — see docs/inventory-log-shapes.md.
 *   Shape A (qc=0): emitted when a MOVE goes through the
 *     `inventory.service.ts > processItem` CASE 3 path (no collision at
 *     destination, row updated in place). `quantity_change` is the delta
 *     on the same row — 0 for a pure move because the row's qty doesn't
 *     change, only its location does.
 *   Shape B (qc=-N): emitted when a MOVE goes through CASE 2 (collision
 *     at destination — including zero-qty inactive rows). `quantity_change`
 *     is the negative source qty (units that left the source row).
 *
 * Pickd 2026-04-29 forward emits Shape B for all MOVE events (CASE 3 was
 * fixed to mimic CASE 2). Historical rows still carry Shape A. Use these
 * helpers in any consumer that needs to interpret a MOVE log; do not
 * re-implement branching inline.
 */

export interface MoveLogShapeInput {
  action_type: string | null;
  quantity_change: number | null;
  prev_quantity: number | null;
  new_quantity: number | null;
}

/**
 * Number of units that physically moved as part of this MOVE event.
 *
 * Returns:
 *   - `Math.abs(quantity_change)` when present and non-zero (Shape B).
 *   - `prev_quantity` as a fallback when qc=0 but prev/new are populated
 *     (Shape A — full move; new=prev means the row's qty was unchanged
 *     but its location was relocated).
 *   - `null` when neither source is reliable (very old logs or non-MOVE
 *     rows the caller passed by mistake).
 */
export function moveDeltaUnits(log: MoveLogShapeInput): number | null {
  if (log.action_type !== 'MOVE') return null;
  const qc = Math.abs(log.quantity_change ?? 0);
  if (qc > 0) return qc;
  const prev = log.prev_quantity ?? 0;
  const next = log.new_quantity ?? 0;
  // Shape A: prev == next (full move, qty unchanged on the relocated row).
  if (prev > 0 && prev === next) return prev;
  // Edge: prev > next means the row's qty actually decreased (move + edit).
  if (prev > next) return prev - next;
  return null;
}

/**
 * Truthy when this MOVE log carries enough information to display its
 * volume. Useful for filtering out logs that are pure metadata noise
 * (e.g., a future shape we haven't planned for).
 */
export function isMoveLogReadable(log: MoveLogShapeInput): boolean {
  return moveDeltaUnits(log) !== null;
}
