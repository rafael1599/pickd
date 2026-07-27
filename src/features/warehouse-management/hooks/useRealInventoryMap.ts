import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { type SlotUsage, type PlannedSlot } from '../../../utils/overstockPutaway';

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
  slots: PlannedSlot[];
  letters: string[];
  rowNumber: number;
  unassigned: RealInventoryItem[];
  availableRows: string[];
}

const DEFAULT_ROW = 'ROW 2';
const STANDARD_LETTERS = ['F', 'E', 'D', 'C', 'B', 'A'];

/**
 * Normalizes a raw location string like "2", "row 2", "ROW 2" into number 2
 */
export function extractRowNumber(loc: string | null): number {
  if (!loc) return 0;
  const match = loc.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Maps raw database inventory items into WarehouseGrid SlotUsage format
 */
export function transformRealInventoryToSlots(
  items: RealInventoryItem[],
  selectedRowName: string
): RealInventoryMapResult {
  const rowNum = extractRowNumber(selectedRowName);

  // 1. Gather all sublocations present in this row or default to A-F
  const presentSublocsSet = new Set<string>();
  const unassigned: RealInventoryItem[] = [];

  for (const item of items) {
    if (!item.sublocation || !item.sublocation.length) {
      unassigned.push(item);
      continue;
    }
    for (const sub of item.sublocation) {
      const letter = sub.trim().toUpperCase();
      if (letter) presentSublocsSet.add(letter);
    }
  }

  // Combine standard A-F range with any extra sublocations found in DB
  const allSublocs = new Set([...STANDARD_LETTERS, ...presentSublocsSet]);

  // Sort sublocations (alphabetical reverse: F down to A, or J down to A)
  const letters = Array.from(allSublocs).sort((a, b) => {
    return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
  });

  // Group items by sublocation letter
  const grouped = new Map<string, RealInventoryItem[]>();
  for (const item of items) {
    if (!item.sublocation || !item.sublocation.length) continue;
    for (const sub of item.sublocation) {
      const letter = sub.trim().toUpperCase();
      const list = grouped.get(letter) ?? [];
      list.push(item);
      grouped.set(letter, list);
    }
  }

  // 2. Build PlannedSlot array for every sublocation in letters
  const slots: PlannedSlot[] = [];

  for (const letter of letters) {
    const cellItems = grouped.get(letter) ?? [];

    if (!cellItems.length) {
      slots.push({
        row: rowNum as 33 | 32 | 31,
        letter: letter as 'A',
        sublocation: letter,
        usage: { kind: 'reserved' },
      } as unknown as PlannedSlot);
      continue;
    }

    const totalQty = cellItems.reduce((sum, i) => sum + i.quantity, 0);
    const primaryItem = cellItems[0];

    if (cellItems.length === 1 && totalQty >= 15) {
      // Single SKU Tower
      slots.push({
        row: rowNum as 33 | 32 | 31,
        letter: letter as 'A',
        sublocation: letter,
        usage: {
          kind: 'tower',
          sku: primaryItem.sku,
          units: totalQty,
        },
      } as unknown as PlannedSlot);
    } else {
      // Multiple SKUs or Lines
      const lineEntries = cellItems.map((i) => ({
        sku: i.sku,
        units: i.quantity,
      }));
      slots.push({
        row: rowNum as 33 | 32 | 31,
        letter: letter as 'A',
        sublocation: letter,
        usage: {
          kind: 'lines',
          entries: lineEntries,
        },
      } as unknown as PlannedSlot);
    }
  }

  return {
    slots,
    letters,
    rowNumber: rowNum,
    unassigned,
    availableRows: [selectedRowName],
  };
}

/**
 * Hook to query live physical stock for a single selected row
 */
export function useRealInventoryMap(selectedRowName: string = DEFAULT_ROW) {
  return useQuery({
    queryKey: ['real-inventory-map', selectedRowName],
    queryFn: async (): Promise<RealInventoryMapResult> => {
      const { data, error } = await supabase
        .from('inventory')
        .select('id, sku, location, sublocation, quantity, item_name, sku_metadata(weight_lbs)')
        .eq('location', selectedRowName)
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

      return transformRealInventoryToSlots(rawItems, selectedRowName);
    },
    enabled: !!selectedRowName,
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
        const numA = extractRowNumber(a);
        const numB = extractRowNumber(b);
        return numA - numB;
      });

      return sorted.length ? sorted : [DEFAULT_ROW, 'ROW 33', 'ROW 32', 'ROW 31'];
    },
    staleTime: 5 * 60 * 1000,
  });
}
