/**
 * Whether a group sibling is in somebody else's hands right now (bug-035).
 *
 * `checked_by` means two things. On an open order it is the live lock that
 * `lockForCheck` sets and `parkOrder` / `releaseCheck` / `returnToPicker` clear.
 * On a completed one it is the signature of who verified it: `process_picking_list`
 * stamps it and nobody clears it (97 % of completed rows carry one), and the
 * Activity Report, Ship, Orders and the public order page read it as that.
 *
 * The drawer asked the sibling question without the status, so an open order
 * combined with one a teammate had completed opened read-only — #881474 on
 * 10 sep, next to #881425 completed by someone else.
 *
 * `reopened` is left out on purpose: `reopen_picking_list` keeps the completer's
 * `checked_by`, so on a reopened sibling it cannot be told apart from the
 * signature, and editing a reopened order is already guarded by `reopened_by`
 * (Continue Editing / Take Over & Edit).
 */
const LIVE_LOCK_STATUSES = new Set([
  'active',
  'ready_to_double_check',
  'double_checking',
  'needs_correction',
]);

export interface SiblingLockRow {
  checked_by?: string | null;
  status?: string | null;
}

export const siblingHeldByOther = (row: SiblingLockRow, userId: string): boolean =>
  !!row.checked_by && row.checked_by !== userId && LIVE_LOCK_STATUSES.has(String(row.status ?? ''));

/** Statuses a sibling query should ask for, so the lock check never reads a signature. */
export const LIVE_LOCK_STATUS_LIST = [...LIVE_LOCK_STATUSES];
