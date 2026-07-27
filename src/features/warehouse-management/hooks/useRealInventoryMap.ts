import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { type SlotUsage } from '../../../utils/overstockPutaway';

export interface RealInventoryItem {
  id: string;
  sku: string;
  location: string | null;
  sublocation: string[] | null;
  quantity: number;
  itemName: string | null;
  weightLbs: number | null;
}

export interface RealInventoryMapResult {
  slots: SlotUsage[];
  unassigned: RealInventoryItem[];
  availableRows: string[];
}

const DEFAULT_ROWS = ['ROW 33', 'ROW 32', 'ROW 31'];
const SUBLOCATIONS = ['J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];

/**
 * Normalizes a raw location string like "33", "row 33", "ROW 33" into "33"
 */
function extractRowNumber(loc: string | null): number | null {
  if (!loc) return null;
  const match = loc.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Maps raw database inventory items into WarehouseGrid SlotUsage format
 */
export function transformRealInventoryToSlots(
  items: RealInventoryItem[],
  selectedRows: string[]
): RealInventoryMapResult {
  // Extract row numbers from selected rows (e.g. ['ROW 33', 'ROW 32', 'ROW 31'] => [33, 32, 31])
  const targetRowNums = selectedRows.map(extractRowNumber).filter((n): n is number => n !== null);

  const slotsMap = new Map<string, SlotUsage>();
  const unassigned: RealInventoryItem[] = [];

  // Group items by key: `${rowNum}-${sublocationLetter}`
  const grouped = new Map<string, RealInventoryItem[]>();

  for (const item of items) {
    const rowNum = extractRowNumber(item.location);
    if (rowNum === null || !targetRowNums.includes(rowNum)) {
      unassigned.push(item);
      continue;
    }

    if (!item.sublocation || !item.sublocation.length) {
      unassigned.push(item);
      continue;
    }

    for (const sublet of item.sublocation) {
      const letter = sublet.trim().toUpperCase();
      if (!SUBLOCATIONS.includes(letter)) continue;

      const key = `${rowNum}-${letter}`;
      const list = grouped.get(key) ?? [];
      list.push(item);
      grouped.set(key, list);
    }
  }

  // Build SlotUsage for every cell in targetRowNums x SUBLOCATIONS
  for (const rowNum of targetRowNums) {
    for (const letter of SUBLOCATIONS) {
      const cellKey = `${rowNum}-${letter}`;
      const cellItems = grouped.get(cellKey) ?? [];

      if (!cellItems.length) {
        slotsMap.set(cellKey, {
          row: rowNum,
          sublocation: letter,
          usage: { kind: 'reserved' },
        });
        continue;
      }

      // Check total quantity across cell items
      const totalQty = cellItems.reduce((sum, i) => sum + i.quantity, 0);
      const primaryItem = cellItems[0];

      if (cellItems.length === 1 && totalQty >= 15) {
        // Single SKU Tower
        slotsMap.set(cellKey, {
          row: rowNum,
          sublocation: letter,
          usage: {
            kind: 'tower',
            sku: primaryItem.sku,
            units: totalQty,
          },
        });
      } else {
        // Multiple SKUs or Lines
        const lineEntries = cellItems.map((i) => ({
          sku: i.sku,
          units: i.quantity,
        }));
        slotsMap.set(cellKey, {
          row: rowNum,
          sublocation: letter,
          usage: {
            kind: 'lines',
            entries: lineEntries,
          },
        });
      }
    }
  }

  return {
    slots: Array.from(slotsMap.values()),
    unassigned,
    availableRows: selectedRows,
  };
}

/**
 * Hook to query live physical stock from Supabase inventory table
 */
export function useRealInventoryMap(selectedRows: string[] = DEFAULT_ROWS) {
  return useQuery({
    queryKey: ['real-inventory-map', selectedRows],
    queryFn: async (): Promise<RealInventoryMapResult> => {
      const { data, error } = await supabase
        .from('inventory')
        .select('id, sku, location, sublocation, quantity, item_name, sku_metadata(weight_lbs)')
        .in('location', selectedRows)
        .eq('is_active', true)
        .gt('quantity', 0);

      if (error) {
        throw new Error(`Failed to fetch real inventory: ${error.message}`);
      }

      const rawItems: RealInventoryItem[] = (data ?? []).map((d) => ({
        id: d.id,
        sku: d.sku,
        location: d.location,
        sublocation: d.sublocation as string[] | null,
        quantity: d.quantity,
        itemName: d.item_name,
        weightLbs: (d.sku_metadata as { weight_lbs: number | null } | null)?.weight_lbs ?? null,
      }));

      return transformRealInventoryToSlots(rawItems, selectedRows);
    },
    enabled: selectedRows.length > 0,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

/**
 * Hook to fetch distinct available rows in warehouse
 */
export function useAvailableWarehouseRows() {
  return useQuery({
    queryKey: ['available-warehouse-rows'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('inventory')
        .select('location')
        .eq('is_active', true)
        .gt('quantity', 0);

      if (error) throw error;

      const set = new Set<string>();
      for (const d of data ?? []) {
        if (d.location) {
          const loc = d.location.trim().toUpperCase();
          if (loc.startsWith('ROW')) set.add(loc);
        }
      }

      const sorted = Array.from(set).sort((a, b) => {
        const numA = extractRowNumber(a) ?? 0;
        const numB = extractRowNumber(b) ?? 0;
        return numB - numA;
      });

      return sorted.length ? sorted : DEFAULT_ROWS;
    },
    staleTime: 5 * 60 * 1000,
  });
}
