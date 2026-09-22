import { parseBikeName } from './parseBikeName';

export const BIKES_PER_STRAPPED_PALLET = 12;

export const CONTAINER_LOCATION_REGEX = /^\d{4}N$/i;

export function isContainerLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  return CONTAINER_LOCATION_REGEX.test(location.trim());
}

/**
 * Calculates how many strapped pallets are needed for a given bike quantity,
 * considering each strapped pallet holds 12 bikes.
 */
export function calculateStrappedPallets(
  qty: number,
  bikesPerPallet = BIKES_PER_STRAPPED_PALLET
): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.ceil(qty / bikesPerPallet);
}

export interface InventorySourceRow {
  id: number;
  sku: string;
  quantity: number | null;
  location: string | null;
  warehouse: string | null;
  sublocation: string[] | null;
  item_name: string | null;
  sku_metadata?: {
    sku?: string;
    model?: string | null;
    size?: string | null;
    color?: string | null;
    category?: string | null;
    as400_description?: string | null;
    received_year?: number | null;
    is_bike?: boolean | null;
    is_scratch_dent?: boolean;
  } | null;
}

export interface LocationStockDetail {
  location: string;
  sublocations: string[];
  quantity: number;
  isContainer: boolean;
}

export interface SkuPalletDistribution {
  sku: string;
  description: string;
  size: string;
  color: string;
  year: string;
  category: string;
  isBike: boolean;
  isScratchDent: boolean;
  /** Quantity in Ludlow warehouse excluding containers */
  ludlowQty: number;
  /** Quantity in containers */
  containerQty: number;
  /** Quantity in container 6436N specifically */
  container6436Qty: number;
  /** True if this SKU was part of container 6436N */
  isFrom6436N: boolean;
  /** Number of strapped pallets needed for container 6436N (@ 12 bikes/pallet) */
  dist6436Pallets: number;
  /** Total quantity across all locations */
  totalQty: number;
  /** Number of strapped pallets needed (based on Ludlow warehouse qty, 12 bikes/pallet) */
  distPallets: number;
  /** Formatted warehouse locations, e.g. "ROW 12 A (10), ROW 14 B (14)" */
  warehouseLocationsLabel: string;
  /** Raw warehouse locations array */
  warehouseLocations: string[];
  /** Formatted container locations if any, e.g. "7004N (24)" */
  containerLocationsLabel: string;
  /** Raw details per location */
  locationDetails: LocationStockDetail[];
}

/**
 * Sorts location names naturally so "ROW 2" comes before "ROW 10".
 */
export function compareLocations(a: string, b: string): number {
  const parseLoc = (loc: string) => {
    const rowMatch = loc.match(/^ROW\s+([\d.]+)(.*)$/i);
    if (rowMatch) {
      return { isRow: true, num: parseFloat(rowMatch[1]), rest: rowMatch[2].trim() };
    }
    return { isRow: false, num: 99999, rest: loc };
  };

  const pA = parseLoc(a);
  const pB = parseLoc(b);

  if (pA.isRow && pB.isRow) {
    if (pA.num !== pB.num) return pA.num - pB.num;
    return pA.rest.localeCompare(pB.rest);
  }
  if (pA.isRow) return -1;
  if (pB.isRow) return 1;
  return a.localeCompare(b);
}

/**
 * Consolidates inventory rows by SKU into SkuPalletDistribution records.
 * Filters and attributes are applied accurately according to warehouse rules.
 */
export function buildSkuPalletDistribution(
  rows: InventorySourceRow[],
  container6436Map?: Map<string, number>
): SkuPalletDistribution[] {
  const bySku = new Map<
    string,
    {
      sku: string;
      meta: InventorySourceRow['sku_metadata'];
      rawNames: Set<string>;
      locMap: Map<string, { sublocations: Set<string>; quantity: number; isContainer: boolean }>;
    }
  >();

  for (const row of rows) {
    const sku = (row.sku || '').trim().toUpperCase();
    if (!sku) continue;

    let entry = bySku.get(sku);
    if (!entry) {
      entry = {
        sku,
        meta: row.sku_metadata || null,
        rawNames: new Set<string>(),
        locMap: new Map(),
      };
      bySku.set(sku, entry);
    }

    if (!entry.meta && row.sku_metadata) {
      entry.meta = row.sku_metadata;
    }

    if (row.item_name && row.item_name.trim()) {
      entry.rawNames.add(row.item_name.trim());
    }

    const locName = (row.location || '').trim().toUpperCase();
    const qty = Math.max(0, row.quantity || 0);

    if (locName) {
      const isCont = isContainerLocation(locName);
      let locEntry = entry.locMap.get(locName);
      if (!locEntry) {
        locEntry = { sublocations: new Set<string>(), quantity: 0, isContainer: isCont };
        entry.locMap.set(locName, locEntry);
      }
      locEntry.quantity += qty;
      if (Array.isArray(row.sublocation)) {
        for (const sub of row.sublocation) {
          if (sub && sub.trim()) locEntry.sublocations.add(sub.trim().toUpperCase());
        }
      }
    }
  }

  const results: SkuPalletDistribution[] = [];

  for (const entry of bySku.values()) {
    const meta = entry.meta;
    // Prefer best available description: item_name -> as400_description
    const rawName = Array.from(entry.rawNames)[0] || meta?.as400_description || '';
    const parsed = parseBikeName(rawName);

    const description = rawName || parsed.raw || meta?.as400_description || entry.sku;
    const size = meta?.size || parsed.size || '';
    const color = meta?.color || parsed.color || '';
    const year = meta?.received_year ? String(meta.received_year) : parsed.year || '';
    const category = meta?.category || '';
    const isBike = meta?.is_bike ?? true;
    const isScratchDent = Boolean(meta?.is_scratch_dent);

    let ludlowQty = 0;
    let containerQty = 0;

    const locationDetails: LocationStockDetail[] = [];
    const warehouseLocStrings: string[] = [];
    const containerLocStrings: string[] = [];

    // Sort locations naturally
    const sortedLocNames = Array.from(entry.locMap.keys()).sort(compareLocations);

    for (const locName of sortedLocNames) {
      const locData = entry.locMap.get(locName)!;
      const subList = Array.from(locData.sublocations).sort();
      const subStr = subList.length > 0 ? ` ${subList.join(',')}` : '';
      const formatted = `${locName}${subStr} (${locData.quantity})`;

      locationDetails.push({
        location: locName,
        sublocations: subList,
        quantity: locData.quantity,
        isContainer: locData.isContainer,
      });

      if (locData.isContainer) {
        containerQty += locData.quantity;
        containerLocStrings.push(formatted);
      } else {
        ludlowQty += locData.quantity;
        warehouseLocStrings.push(formatted);
      }
    }

    const distPallets = calculateStrappedPallets(ludlowQty, BIKES_PER_STRAPPED_PALLET);

    const c6436Qty = container6436Map?.get(entry.sku) ?? 0;
    const isFrom6436N = container6436Map ? container6436Map.has(entry.sku) : false;
    const dist6436Pallets = calculateStrappedPallets(c6436Qty, BIKES_PER_STRAPPED_PALLET);

    results.push({
      sku: entry.sku,
      description,
      size,
      color,
      year,
      category,
      isBike,
      isScratchDent,
      ludlowQty,
      containerQty,
      container6436Qty: c6436Qty,
      isFrom6436N,
      dist6436Pallets,
      totalQty: ludlowQty + containerQty,
      distPallets,
      warehouseLocationsLabel:
        warehouseLocStrings.length > 0 ? warehouseLocStrings.join(', ') : '—',
      warehouseLocations: warehouseLocStrings.map((s) => s.split(' ')[0]),
      containerLocationsLabel: containerLocStrings.length > 0 ? containerLocStrings.join(', ') : '',
      locationDetails,
    });
  }

  // Default sort by SKU ascending
  return results.sort((a, b) => a.sku.localeCompare(b.sku));
}
