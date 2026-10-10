import { supabase } from '../../../lib/supabase';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';

export interface ZeroStockLine {
  sku: string;
  location: string;
  systemQty: number;
}

export interface ZeroStockCandidate {
  sku: string;
  location?: string | null;
  warehouse?: string | null;
  insufficient_stock?: boolean | null;
  sku_not_found?: boolean | null;
}

/**
 * Finds items with insufficient_stock or sku_not_found flags that would be auto-zeroed
 * upon order completion by process_picking_list.
 */
export async function findZeroStockLines(
  items: ZeroStockCandidate[],
  inventoryData?: InventoryItemWithMetadata[]
): Promise<ZeroStockLine[]> {
  const problemItems = items.filter(
    (i) => (i.insufficient_stock || i.sku_not_found) && i.location && i.location.trim() !== ''
  );
  if (problemItems.length === 0) return [];

  const uniqueMap = new Map<string, { sku: string; location: string; warehouse: string }>();
  for (const item of problemItems) {
    const loc = item.location!.trim().toUpperCase();
    const key = `${item.sku}|${loc}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        sku: item.sku,
        location: item.location!.trim(),
        warehouse: item.warehouse || 'LUDLOW',
      });
    }
  }

  const result: ZeroStockLine[] = [];
  const neededFromDb: Array<{ sku: string; location: string; warehouse: string }> = [];

  for (const entry of uniqueMap.values()) {
    let foundQty: number | null = null;
    if (inventoryData && inventoryData.length > 0) {
      const match = inventoryData.find(
        (inv) =>
          inv.sku === entry.sku &&
          (inv.location || '').toUpperCase().trim() === entry.location.toUpperCase() &&
          inv.warehouse === entry.warehouse
      );
      if (match) {
        foundQty = match.quantity ?? 0;
      }
    }

    if (foundQty !== null) {
      result.push({
        sku: entry.sku,
        location: entry.location,
        systemQty: foundQty,
      });
    } else {
      neededFromDb.push(entry);
    }
  }

  if (neededFromDb.length > 0) {
    const skus = Array.from(new Set(neededFromDb.map((n) => n.sku)));
    try {
      const { data: dbRows } = await supabase
        .from('inventory')
        .select('sku, location, quantity, warehouse')
        .in('sku', skus)
        .eq('is_active', true);

      for (const entry of neededFromDb) {
        const dbMatch = (dbRows ?? []).find(
          (r) =>
            r.sku === entry.sku &&
            (r.location || '').toUpperCase().trim() === entry.location.toUpperCase() &&
            r.warehouse === entry.warehouse
        );
        result.push({
          sku: entry.sku,
          location: entry.location,
          systemQty: dbMatch?.quantity ?? 0,
        });
      }
    } catch {
      for (const entry of neededFromDb) {
        result.push({
          sku: entry.sku,
          location: entry.location,
          systemQty: 0,
        });
      }
    }
  }

  return result;
}
