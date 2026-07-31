import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { inventorySkuCandidates } from '../../../utils/skuNormalize';
import { byPickPreference, toPickingOrderMap } from '../utils/pickLocation';
import type { DistributionItem } from '../../../schemas/inventory.schema';

/** Inventory resolved for an item via its canonical (de-mangled) SKU. */
export interface ResolvedPick {
  canonicalSku: string;
  location: string | null;
  quantity: number;
  distribution: DistributionItem[];
  sublocation: string[] | null;
}

interface ResolutionItem {
  sku: string;
  location?: string | null;
}

interface InventoryRow {
  sku: string;
  location: string | null;
  quantity: number | null;
  distribution: DistributionItem[] | null;
  sublocation: string[] | null;
  is_active: boolean | null;
}

/**
 * For cart items whose SKU doesn't match inventory as-is — a spurious extra
 * trailing letter, or an explicit AS400 alias like 03-4070BL → 03-4070BK
 * (see {@link resolveInventorySku}) — resolves the inventory-facing SKU and
 * returns, per raw SKU, the best active stock row (location + aggregated
 * distribution + total qty). Lets the Double-Check view show WHERE to pick
 * instead of "not in inventory".
 *
 * Only items whose resolved form differs from the raw SKU are queried, so this
 * is a pure fallback that never touches SKUs that already match exactly.
 */
export function useCanonicalSkuResolution(cartItems: ResolutionItem[]): Map<string, ResolvedPick> {
  const [resolved, setResolved] = useState<Map<string, ResolvedPick>>(new Map());

  // Anything with an alternative worth trying. Previously this was only SKUs
  // whose canonical form differed, which silently excluded the dashless ones —
  // "034664BR" de-mangles to itself, so the hook never ran and the picker was
  // left to retype it.
  const targets = [
    ...new Set(
      cartItems.map((i) => i.sku).filter((s) => s && inventorySkuCandidates(s).length > 1)
    ),
  ];
  const key = targets.slice().sort().join(',');

  useEffect(() => {
    if (!key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing derived state
      setResolved(new Map());
      return;
    }
    let cancelled = false;

    void (async () => {
      const rawSkus = key.split(',');
      const candidatesBySku = new Map(rawSkus.map((s) => [s, inventorySkuCandidates(s)]));
      const allCandidates = [...new Set([...candidatesBySku.values()].flat())];

      const [{ data, error }, { data: locationRows }] = await Promise.all([
        supabase
          .from('inventory')
          .select('sku, location, quantity, distribution, sublocation, is_active')
          .in('sku', allCandidates),
        supabase.from('locations').select('location, picking_order'),
      ]);

      if (cancelled || error || !data) return;

      const bySku = new Map<string, InventoryRow[]>();
      for (const row of data as InventoryRow[]) {
        if (row.is_active === false) continue;
        if (Number(row.quantity || 0) <= 0) continue;
        const arr = bySku.get(row.sku) ?? [];
        arr.push(row);
        bySku.set(row.sku, arr);
      }

      const pickingOrder = toPickingOrderMap(locationRows);
      const preferred = byPickPreference<InventoryRow>(pickingOrder);

      const result = new Map<string, ResolvedPick>();
      for (const rawSku of rawSkus) {
        // First candidate that actually holds stock wins, so the exact SKU is
        // never displaced by a guess that merely looks plausible.
        const match = (candidatesBySku.get(rawSku) ?? []).find((c) => bySku.has(c));
        if (!match) continue;
        // Nothing to report when the SKU was already right — the consumers read
        // this map as "this item had to be redirected".
        if (match === rawSku) continue;

        const rows = bySku.get(match)!;
        const best = [...rows].sort(preferred)[0];

        result.set(rawSku, {
          canonicalSku: match,
          location: best.location ?? null,
          quantity: rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0),
          distribution: rows.flatMap((r) => (Array.isArray(r.distribution) ? r.distribution : [])),
          sublocation: best.sublocation ?? null,
        });
      }

      if (!cancelled) setResolved(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return resolved;
}
