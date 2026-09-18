/**
 * Two questions a combined order keeps asking, and that used to be answered by
 * array position: *which* member does this card stand for, and *which* members
 * does a completion actually cover.
 *
 * Both got the wrong answer on 9 sep 2026. #881394 was five seconds old when a
 * group completion swept it out — it had joined the FedEx group mid-verification
 * and nobody had ever seen it. And the combined card that came out of trying to
 * fix that by hand pointed at the completed half, so tapping it opened
 * DoubleCheckView on a finished row, which shuts itself.
 */

/** Statuses you cannot open for work — DoubleCheckView closes on both. */
const DEAD_END_STATUSES = new Set(['completed', 'cancelled']);

export interface GroupMemberRow {
  id: string;
  status?: string | null;
  items?: unknown;
  order_number?: string | null;
  group_id?: string | null;
}

const isDeadEnd = (row?: GroupMemberRow | null): boolean =>
  !row || DEAD_END_STATUSES.has(String(row.status ?? ''));

/**
 * Which member of a combined card can actually be opened.
 *
 * `mergeGroupOrders` anchors the card on `groupOrders[0]`, and a deliberate
 * ('general') combine keeps merging across the active/completed boundary, so
 * that anchor is regularly the completed member. Pass the RAW rows: the board
 * stamps the group's aggregate status onto every member before bucketing it
 * into a lane, so the card's own `status` says `ready_to_double_check` even
 * when its row is `completed`.
 *
 * Falls back to the card's own id when the group has nothing open — the caller
 * then behaves exactly as before rather than silently opening someone else.
 */
export function openableGroupMemberId(
  cardId: string,
  groupId: string | null | undefined,
  members: readonly GroupMemberRow[]
): string {
  if (!groupId) return cardId;
  const siblings = members.filter((m) => m.group_id === groupId);
  if (!isDeadEnd(siblings.find((m) => m.id === cardId))) return cardId;
  return siblings.find((m) => !isDeadEnd(m))?.id ?? cardId;
}

/**
 * Split the group's completable rows into the ones the verifier actually had
 * loaded and the ones that turned up afterwards.
 *
 * `loadedListIds` comes from the cart's items — `loadExternalList` tags every
 * line with the `source_list_id` that owns it, so the set of orders on screen
 * is already known. Two deliberate escape hatches keep this from ever refusing
 * work it shouldn't:
 *   - an empty `loadedListIds` (a solo order: nothing was tagged) sweeps
 *     everything, exactly as before;
 *   - a row with no lines has nothing to deduct off a shelf, so it rides along
 *     rather than being stranded.
 */
export function partitionGroupSweep<T extends GroupMemberRow>(
  groupRows: readonly T[],
  loadedListIds: ReadonlySet<string>
): { siblings: T[]; gatecrashers: T[] } {
  const gatecrashed = (row: T): boolean =>
    loadedListIds.size > 0 &&
    !loadedListIds.has(row.id) &&
    Array.isArray(row.items) &&
    row.items.length > 0;

  const siblings: T[] = [];
  const gatecrashers: T[] = [];
  for (const row of groupRows) (gatecrashed(row) ? gatecrashers : siblings).push(row);
  return { siblings, gatecrashers };
}

/**
 * Los estados que **no** se arrastran al marcar un grupo como listo para
 * verificar, y el motivo de cada uno. La lista es el contrato; el `UPDATE` de
 * `markAsReady` la aplica, y este archivo la explica.
 *
 * - `completed` / `cancelled`: terminales. Volverlas a abrir las resucita.
 * - `reopened`: **ya descontó su stock una vez.** Ese estado es lo único que le
 *   dice a `process_picking_list` que se niegue y que hay que re-completarla por
 *   delta contra su `completed_snapshot`. Arrastrarla le quita la marca sin
 *   tocar el snapshot, y el siguiente completado del grupo descuenta todo por
 *   segunda vez — 7 órdenes y 35 unidades hasta el 17 sep 2026. Una orden
 *   reabierta ya está en su pallet: no necesita que la empujen a verificar.
 */
export const SWEEP_PROTECTED_STATUSES = ['completed', 'cancelled', 'reopened'] as const;

/** True cuando una hermana del grupo puede pasar a `double_checking`. */
export function canSweepToDoubleCheck(status?: string | null): boolean {
  return !SWEEP_PROTECTED_STATUSES.includes(
    String(status ?? '') as (typeof SWEEP_PROTECTED_STATUSES)[number]
  );
}
