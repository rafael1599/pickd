import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { canonicalBikeSku } from '../../../utils/skuNormalize';
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
 * For cart items whose SKU has a spurious extra trailing letter (so the exact
 * SKU isn't in inventory — see {@link canonicalBikeSku}), resolves the canonical
 * SKU against inventory and returns, per raw SKU, the best active stock row
 * (location + aggregated distribution + total qty). Lets the Double-Check view
 * show WHERE to pick instead of "not in inventory".
 *
 * Only items whose canonical form differs from the raw SKU are queried, so this
 * is a pure fallback that never touches SKUs that already match exactly.
 */
export function useCanonicalSkuResolution(cartItems: ResolutionItem[]): Map<string, ResolvedPick> {
  const [resolved, setResolved] = useState<Map<string, ResolvedPick>>(new Map());

  const targets = [
    ...new Set(cartItems.map((i) => i.sku).filter((s) => s && canonicalBikeSku(s) !== s)),
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
      const canonSkus = [...new Set(rawSkus.map(canonicalBikeSku))];

      const { data, error } = await supabase
        .from('inventory')
        .select('sku, location, quantity, distribution, sublocation, is_active')
        .in('sku', canonSkus)
        .gt('quantity', 0);

      if (cancelled || error || !data) return;

      const byCanon = new Map<string, InventoryRow[]>();
      for (const row of data as InventoryRow[]) {
        if (row.is_active === false) continue;
        const arr = byCanon.get(row.sku) ?? [];
        arr.push(row);
        byCanon.set(row.sku, arr);
      }

      const result = new Map<string, ResolvedPick>();
      for (const rawSku of rawSkus) {
        const canon = canonicalBikeSku(rawSku);
        const rows = byCanon.get(canon);
        if (!rows || rows.length === 0) continue;

        const best = [...rows].sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0))[0];

        result.set(rawSku, {
          canonicalSku: canon,
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
