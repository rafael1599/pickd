// One move, the way a hand would do it — after re-reading the line and
// checking it is still what was planned. Shared by PLAN COMPLETED and the
// LIVE confirmation: a letter change inside the row is updateItem (the move
// RPC refuses same-row moves by design); a change of row is moveItem with
// the units and the squares. Partial moves take their units and leave the
// rest of the line where it is.

import { supabase } from '../../../lib/supabase';
import type { useInventory } from '../../inventory/hooks/useInventoryData';
import {
  InventoryItemInputSchema,
  type InventoryItemWithMetadata,
} from '../../../schemas/inventory.schema';
import { ZONES, type ZoneId } from '../engine';
import { describeMove, validateMove, type MoveDraft, type MoveStatus } from '../plan/slotPlan';

export type Outcome = { status: MoveStatus; error: string | null };

type Inv = ReturnType<typeof useInventory>;

export async function runMove(
  m: MoveDraft,
  updateItem: Inv['updateItem'],
  moveItem: Inv['moveItem'],
  zoneId: ZoneId,
  note: string
): Promise<Outcome> {
  const { data, error } = await supabase
    .from('inventory')
    .select('*, sku_metadata(*)')
    .eq('id', m.inventoryId)
    .maybeSingle();
  if (error) return { status: 'failed', error: error.message };
  const fresh = (data ?? null) as InventoryItemWithMetadata | null;
  const v = validateMove(
    { ...m, id: 0, planId: '', position: 0, status: 'planned', error: null },
    fresh
  );
  if (!v.ok) return { status: 'skipped', error: v.reason };
  if (!fresh) return { status: 'skipped', error: 'line no longer in stock' };

  try {
    if (m.kind === 'relabel') {
      // The move re-letters what it names: its source letters leave, its
      // targets join, and letters it never touched stay — a one-square move
      // of a line spread over squares must not erase the other squares.
      const kept = (fresh.sublocation ?? []).filter((l) => !(m.fromSublocation ?? []).includes(l));
      const letters = [...new Set([...kept, ...m.toLetters])].sort();
      const input = InventoryItemInputSchema.parse({
        sku: fresh.sku,
        quantity: fresh.quantity ?? 0,
        location: fresh.location ?? m.fromLocation,
        location_id: fresh.location_id ?? null,
        sublocation: letters,
        item_name: fresh.item_name ?? null,
        warehouse: fresh.warehouse,
        status: fresh.status ?? null,
        distribution: fresh.distribution ?? [],
      });
      await updateItem(fresh, input);
    } else {
      await moveItem(
        fresh,
        fresh.warehouse,
        m.toLocation,
        m.qty,
        undefined,
        null,
        // A place with no squares (MAIN HALL) takes no letters.
        m.toLetters.length ? m.toLetters : null,
        `${note} ${ZONES[zoneId].name}: ${describeMove(m)}`
      );
    }
    return { status: 'done', error: null };
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }
}
