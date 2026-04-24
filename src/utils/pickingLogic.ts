import { type Location } from '../schemas/location.schema';

export interface PickingItem {
  sku: string;
  location: string | null;
  warehouse?: string;
  pickingQty: number;
  quantity?: string | number;
  item_name?: string | null;
  isPicked?: boolean;
  palletId?: number;
  sku_not_found?: boolean;
  insufficient_stock?: boolean;
  description?: string | null;
  /** True when stackPartsOnBikes placed this item on top of a bike pallet */
  isStackedPart?: boolean;
}

export interface Pallet {
  id: number;
  items: PickingItem[];
  totalUnits: number;
  footprint_in2: number;
  limitPerPallet: number; // Added for UI display
}

/**
 * Sorts items based on the picking_order defined in the locations table.
 * Fallback to alphanumeric sort if no order is defined.
 */
export const getOptimizedPickingPath = (items: PickingItem[], locations: Location[]) => {
  // Create a map for quick lookup of picking order
  const orderMap = new Map<string, number>();
  locations.forEach((loc) => {
    const key = `${loc.warehouse}-${(loc.location || '').trim().toUpperCase()}`;
    orderMap.set(key, loc.picking_order ?? 9999);
  });

  return [...items].sort((a, b) => {
    const keyA = `${a.warehouse}-${(a.location || '').trim().toUpperCase()}`;
    const keyB = `${b.warehouse}-${(b.location || '').trim().toUpperCase()}`;

    const orderA = orderMap.get(keyA) ?? 9999;
    const orderB = orderMap.get(keyB) ?? 9999;

    if (orderA !== orderB) return orderA - orderB;

    // Fallback to alphanumeric - ensure null safety
    return (a.location || '').localeCompare(b.location || '', undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
};

/**
 * Groups items into pallets using flexible capacities:
 * - Pallet of 8
 * - Pallet of 10
 * - Pallet of 12
 *
 * Logic:
 * 1. Calculate total units.
 * 2. Evaluate all 3 capacities (8, 10, 12).
 * 3. Choose the capacity that minimizes the total pallet count.
 * 4. If counts are tied, prefer the smallest/standard capacity (8 or 10) to avoid overloading.
 */
export const calculatePallets = (items: PickingItem[]): Pallet[] => {
  const totalUnits = items.reduce((sum, item) => sum + (item.pickingQty || 0), 0);
  if (totalUnits === 0) return [];

  // 1. Find the minimum number of pallets needed using max capacity (12)
  const numPallets = Math.ceil(totalUnits / 12);

  // 2. Choose the smallest capacity that maintains this minimum count
  // This naturally spreads items more evenly across the pallets.
  const candidates = [8, 10, 12];
  let bestLimit = 12;

  for (const limit of candidates) {
    if (Math.ceil(totalUnits / limit) === numPallets) {
      bestLimit = limit;
      break;
    }
  }

  const limitPerPallet = bestLimit;

  // 3. Stable Greedy Filling
  const pallets: Pallet[] = [];
  let currentPallet: Pallet = {
    id: 1,
    items: [],
    totalUnits: 0,
    footprint_in2: 0,
    limitPerPallet,
  };

  items.forEach((item) => {
    let remaining = item.pickingQty || 0;

    while (remaining > 0) {
      const space = limitPerPallet - currentPallet.totalUnits;
      const take = Math.min(remaining, space);

      if (take > 0) {
        // Merge if same SKU/Location in current pallet
        const existing = currentPallet.items.find(
          (i) =>
            i.sku === item.sku &&
            (i.location || '').trim().toUpperCase() === (item.location || '').trim().toUpperCase()
        );
        if (existing) {
          existing.pickingQty += take;
        } else {
          currentPallet.items.push({ ...item, pickingQty: take });
        }

        currentPallet.totalUnits += take;
        remaining -= take;
      }

      if (currentPallet.totalUnits >= limitPerPallet && remaining > 0) {
        pallets.push(currentPallet);
        currentPallet = {
          id: pallets.length + 1,
          items: [],
          totalUnits: 0,
          footprint_in2: 0,
          limitPerPallet,
        };
      }
    }
  });

  if (currentPallet.items.length > 0) {
    pallets.push(currentPallet);
  }

  return pallets;
};

/**
 * Redistributes items across pallets respecting user overrides.
 *
 * Locked pallets (user-edited) keep their exact item counts.
 * Remaining items are redistributed across unlocked pallets using greedy fill.
 * May create new pallets or remove empty ones as needed.
 *
 * @param originalPallets - The current pallet distribution
 * @param overrides - Map of palletId → desired total units for that pallet
 * @returns New pallet array with overrides applied and remainder redistributed
 */
export const redistributeWithOverrides = (
  originalPallets: Pallet[],
  overrides: Map<number, number>
): Pallet[] => {
  if (overrides.size === 0) return originalPallets;

  // Collect ALL items as a flat pool (preserving SKU + location identity)
  const itemPool: PickingItem[] = [];
  originalPallets.forEach((p) => {
    p.items.forEach((item) => {
      const existing = itemPool.find(
        (i) =>
          i.sku === item.sku &&
          (i.location || '').trim().toUpperCase() === (item.location || '').trim().toUpperCase()
      );
      if (existing) {
        existing.pickingQty += item.pickingQty;
      } else {
        itemPool.push({ ...item, pickingQty: item.pickingQty });
      }
    });
  });

  const totalUnits = itemPool.reduce((sum, i) => sum + i.pickingQty, 0);

  // Build locked pallets first: fill them from the pool up to their override limit
  const lockedPallets: Pallet[] = [];
  const remainingPool = itemPool.map((i) => ({ ...i, pickingQty: i.pickingQty }));

  // Process overrides in original pallet order
  originalPallets.forEach((p) => {
    const overrideQty = overrides.get(p.id);
    if (overrideQty === undefined) return;

    const locked: Pallet = {
      id: p.id,
      items: [],
      totalUnits: 0,
      footprint_in2: 0,
      limitPerPallet: overrideQty,
    };

    // Fill locked pallet from pool, preserving original item order
    let needed = overrideQty;
    for (const poolItem of remainingPool) {
      if (needed <= 0) break;
      if (poolItem.pickingQty <= 0) continue;

      const take = Math.min(poolItem.pickingQty, needed);
      const existing = locked.items.find(
        (i) =>
          i.sku === poolItem.sku &&
          (i.location || '').trim().toUpperCase() === (poolItem.location || '').trim().toUpperCase()
      );
      if (existing) {
        existing.pickingQty += take;
      } else {
        locked.items.push({ ...poolItem, pickingQty: take });
      }
      locked.totalUnits += take;
      poolItem.pickingQty -= take;
      needed -= take;
    }

    lockedPallets.push(locked);
  });

  // Calculate remaining units to distribute
  const lockedUnits = lockedPallets.reduce((sum, p) => sum + p.totalUnits, 0);
  const remainingUnits = totalUnits - lockedUnits;

  if (remainingUnits <= 0) {
    // All items consumed by locked pallets — renumber and return
    return lockedPallets.map((p, i) => ({ ...p, id: i + 1 }));
  }

  // Filter pool to only items with remaining qty
  const unlockedItems = remainingPool.filter((i) => i.pickingQty > 0);

  // Redistribute remaining items using standard algorithm
  const unlockedPallets = calculatePallets(unlockedItems);

  // Merge: locked pallets first, then unlocked, renumbered sequentially
  const result: Pallet[] = [];
  let nextId = 1;

  for (const locked of lockedPallets) {
    result.push({ ...locked, id: nextId++ });
  }
  for (const unlocked of unlockedPallets) {
    result.push({ ...unlocked, id: nextId++ });
  }

  return result;
};

/**
 * Consolidates all non-bike (parts) items onto the last pallet that contains
 * at least one bike. Parts never get their own pallet when bikes are present.
 *
 * If no pallet contains bikes, returns pallets unchanged (orders with only
 * parts still paginate normally).
 */
export const stackPartsOnBikes = (pallets: Pallet[], bikeSkuSet: Set<string>): Pallet[] => {
  if (pallets.length === 0 || bikeSkuSet.size === 0) return pallets;

  let lastBikeIdx = -1;
  for (let i = pallets.length - 1; i >= 0; i--) {
    if (pallets[i].items.some((it) => bikeSkuSet.has(it.sku))) {
      lastBikeIdx = i;
      break;
    }
  }
  if (lastBikeIdx === -1) return pallets;

  const partItems: PickingItem[] = [];
  const working: Pallet[] = pallets.map((p, idx) => {
    if (idx === lastBikeIdx) return { ...p, items: [...p.items] };
    const kept: PickingItem[] = [];
    p.items.forEach((it) => {
      if (bikeSkuSet.has(it.sku)) kept.push(it);
      else partItems.push(it);
    });
    return {
      ...p,
      items: kept,
      totalUnits: kept.reduce((s, i) => s + (i.pickingQty || 0), 0),
    };
  });

  const target = working[lastBikeIdx];
  partItems.forEach((pi) => {
    const existing = target.items.find(
      (i) =>
        i.sku === pi.sku &&
        (i.location || '').trim().toUpperCase() === (pi.location || '').trim().toUpperCase()
    );
    if (existing) {
      existing.pickingQty += pi.pickingQty;
      existing.isStackedPart = true;
    } else {
      target.items.push({ ...pi, isStackedPart: true });
    }
  });
  target.totalUnits = target.items.reduce((s, i) => s + (i.pickingQty || 0), 0);

  return working.filter((p) => p.items.length > 0).map((p, i) => ({ ...p, id: i + 1 }));
};

/**
 * Builds pallets from an item pool, sizing pallets based on BIKE units only.
 * Parts are stacked onto the last bike pallet without inflating pallet count.
 *
 * - No bikes: falls back to `calculatePallets` on the full pool (parts fill pallets normally).
 * - Bikes present: `calculatePallets(bikes)` → attach all parts to last pallet.
 */
export const calculatePalletsWithBikeAwareness = (
  items: PickingItem[],
  bikeSkuSet: Set<string>
): Pallet[] => {
  if (items.length === 0) return [];
  if (bikeSkuSet.size === 0) return calculatePallets(items);

  const bikes = items.filter((i) => bikeSkuSet.has(i.sku));
  const parts = items.filter((i) => !bikeSkuSet.has(i.sku));

  if (bikes.length === 0) return calculatePallets(items);

  const bikePallets = calculatePallets(bikes);
  if (parts.length === 0) return bikePallets;

  return stackPartsOnBikes(
    [...bikePallets, { id: 0, items: parts, totalUnits: 0, footprint_in2: 0, limitPerPallet: 0 }],
    bikeSkuSet
  );
};
