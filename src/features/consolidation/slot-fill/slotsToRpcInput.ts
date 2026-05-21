import type { SlotGroup } from './types';

/**
 * Translate the UI's group structure into the input shape the
 * `get_slot_fill_candidates` RPC expects.
 *
 * The RPC ranks each slot independently. To handle the "same SKU"
 * group case (e.g. ROW 1: two towers with the same SKU), we collapse
 * the group into a single pseudo-slot whose qty range is the SUM of
 * the constituent slots' ranges. That way the RPC searches for a
 * SKU whose entire stock could fill the whole group.
 *
 * For groups with `same_sku: false`, every slot becomes its own entry
 * in the RPC payload and the operator picks SKUs per-slot.
 *
 * Returned `slot_id` values:
 *  - same_sku group: `${group.id}:agg` (single aggregated row)
 *  - regular slot:   `${group.id}:${slot.id}` so the candidates table
 *                    can re-associate results back to the UI tree.
 */
export interface RpcSlotInput {
  slot_id: string;
  min_qty: number;
  max_qty: number;
}

export function slotsToRpcInput(groups: SlotGroup[]): RpcSlotInput[] {
  const out: RpcSlotInput[] = [];
  for (const g of groups) {
    if (g.slots.length === 0) continue;

    if (g.same_sku) {
      const min = g.slots.reduce((sum, s) => sum + s.min_qty, 0);
      const max = g.slots.reduce((sum, s) => sum + s.max_qty, 0);
      out.push({ slot_id: `${g.id}:agg`, min_qty: min, max_qty: max });
    } else {
      for (const s of g.slots) {
        out.push({ slot_id: `${g.id}:${s.id}`, min_qty: s.min_qty, max_qty: s.max_qty });
      }
    }
  }
  return out;
}

/**
 * Reverse-map a `slot_id` from RPC output back to its UI source so
 * the candidates table can label results.
 *
 * Returns the group_id and either:
 *  - `{ kind: 'aggregated' }` for same-SKU rolled-up groups
 *  - `{ kind: 'slot', slot_id }` for per-slot results
 */
export type ParsedSlotId =
  | { groupId: string; kind: 'aggregated' }
  | { groupId: string; kind: 'slot'; slotId: string };

export function parseRpcSlotId(slotId: string): ParsedSlotId | null {
  const ix = slotId.indexOf(':');
  if (ix === -1) return null;
  const groupId = slotId.slice(0, ix);
  const rest = slotId.slice(ix + 1);
  if (rest === 'agg') return { groupId, kind: 'aggregated' };
  return { groupId, kind: 'slot', slotId: rest };
}
