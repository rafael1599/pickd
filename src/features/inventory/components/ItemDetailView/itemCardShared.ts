/**
 * What the item card's pieces share that is not a component: names, words and
 * the two hooks behind Where (docs/prds/item-detail-register.md).
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';

import { supabase } from '../../../../lib/supabase';
import { useLocationManagement } from '../../hooks/useLocationManagement.ts';
import { predictLocation } from '../../../../utils/locationPredictor.ts';
import { normalizeSkuOnRegister } from '../../../../utils/skuNormalize';
import { inventoryService } from '../../api/inventory.service.ts';
import {
  isRowLocation,
  squaresForRow,
  unitsBySquare,
  type RegisterField,
} from '../../utils/registerItem';
import type { InventoryItemWithMetadata } from '../../../../schemas/inventory.schema';

export const HEADING = { fontFamily: 'var(--font-heading)' } as const;

export const FIELD_LABEL: Record<RegisterField, string> = {
  sku: 'SKU',
  model: 'MODEL',
  size: 'SIZE',
  color: 'COLOR',
  serial: 'SERIAL',
  upc: 'UPC',
};

export const whereText = (location: string | null, squares: string[]) =>
  location ? `${location}${squares.length ? ` · ${squares.join(',')}` : ''}` : 'Where?';

const FIXED_SUGGESTIONS = ['RETURN TO STOCK', 'UNKNOWN'];

/**
 * Where a box of this SKU most likely goes — where the SKU already is, and where
 * its model sits — plus the row's squares with the units each already holds.
 */
export function useWhereChoices({
  enabled,
  warehouse,
  sku,
  model,
  location,
  query,
}: {
  enabled: boolean;
  warehouse: string;
  sku: string;
  model: string;
  location: string | null;
  query: string;
}) {
  const { locations } = useLocationManagement();
  const locationNames = useMemo(
    () =>
      Array.from(
        new Set((locations ?? []).filter((l) => l.warehouse === warehouse).map((l) => l.location))
      ),
    [locations, warehouse]
  );

  const { data: suggested = [] } = useQuery({
    queryKey: ['item-card', 'suggest', warehouse, sku, model],
    enabled: enabled && (!!sku || !!model),
    staleTime: 60_000,
    queryFn: async () => {
      const out: { location: string; why: string }[] = [];
      const seen = new Set<string>();
      const add = (l: string, why: string) => {
        if (!l || seen.has(l)) return;
        seen.add(l);
        out.push({ location: l, why });
      };
      if (sku) {
        const { data } = await supabase
          .from('inventory')
          .select('location, quantity')
          .eq('warehouse', warehouse)
          .eq('sku', normalizeSkuOnRegister(sku))
          .gt('quantity', 0)
          .order('quantity', { ascending: false })
          .limit(3);
        for (const r of data ?? []) add(r.location ?? '', 'this SKU');
      }
      if (model) {
        const { data } = await supabase
          .from('inventory')
          .select('location, quantity')
          .eq('warehouse', warehouse)
          .ilike('item_name', `${model}%`)
          .gt('quantity', 0)
          .limit(60);
        const byLoc = new Map<string, number>();
        for (const r of data ?? []) {
          if (!r.location) continue;
          byLoc.set(r.location, (byLoc.get(r.location) ?? 0) + Number(r.quantity ?? 0));
        }
        [...byLoc.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .forEach(([l]) => add(l, 'same model'));
      }
      return out;
    },
  });

  const chips = useMemo(() => {
    const list = [...suggested];
    for (const l of FIXED_SUGGESTIONS) {
      if (!list.some((c) => c.location === l)) list.push({ location: l, why: '' });
    }
    return list;
  }, [suggested]);

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const guess = predictLocation(q, locationNames).bestGuess;
    const hits = locationNames.filter((l) => l.toUpperCase().includes(q)).slice(0, 8);
    return guess && !hits.includes(guess) ? [guess, ...hits.slice(0, 7)] : hits;
  }, [query, locationNames]);

  const isRow = isRowLocation(location);
  const { data: rowLines = [] } = useQuery({
    queryKey: ['item-card', 'row', warehouse, location],
    enabled: enabled && isRow,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory')
        .select('sublocation, quantity')
        .eq('warehouse', warehouse)
        .eq('location', location as string)
        .gt('quantity', 0);
      return (data ?? []) as { sublocation: string[] | null; quantity: number | null }[];
    },
  });
  const squareUnits = useMemo(() => unitsBySquare(rowLines), [rowLines]);
  const squares = useMemo(() => squaresForRow(squareUnits.keys()), [squareUnits]);

  /** The location as the database spells it, or the typed text in capitals. */
  const resolve = (loc: string) =>
    locationNames.find((l) => l.toUpperCase() === loc.trim().toUpperCase()) ??
    loc.trim().toUpperCase();

  return { chips, results, isRow, squares, squareUnits, resolve };
}

/** Whether this SKU already has a row at that location (excluding the row itself). */
export function useExistsAt(
  enabled: boolean,
  sku: string,
  location: string | null,
  warehouse: string,
  excludeId?: string | number
) {
  const key = `${sku}|${location ?? ''}|${warehouse}|${excludeId ?? ''}`;
  const [answer, setAnswer] = useState<{ key: string; exists: boolean } | null>(null);
  useEffect(() => {
    if (!enabled || !sku || !location) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const found = await inventoryService.checkExistence(
          normalizeSkuOnRegister(sku),
          location,
          warehouse,
          excludeId
        );
        if (!cancelled) setAnswer({ key, exists: !!found });
      } catch {
        /* the save still works; the hint is a courtesy */
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [enabled, sku, location, warehouse, excludeId, key]);
  return enabled && answer?.key === key && answer.exists;
}

/**
 * A new or removed photo, on every Stock list that holds the SKU. The lists
 * live under keys like `['inventory', 'grouped-all', showInactive]`, so a
 * `setQueryData` on the bare root reached none of them and the card kept its
 * old thumbnail until a reload. Search caches `{ items, total }`.
 */
export function setSkuPhotoInCaches(
  queryClient: QueryClient,
  sku: string,
  imageUrl: string | null
): void {
  const patchRows = (rows: InventoryItemWithMetadata[]) =>
    rows.map((row) =>
      row.sku === sku
        ? { ...row, sku_metadata: { ...(row.sku_metadata ?? { sku }), image_url: imageUrl } }
        : row
    );
  queryClient.setQueriesData({ queryKey: ['inventory'] }, (old: unknown) => {
    if (Array.isArray(old)) return patchRows(old as InventoryItemWithMetadata[]);
    if (old && typeof old === 'object' && Array.isArray((old as { items?: unknown }).items)) {
      const o = old as { items: InventoryItemWithMetadata[] };
      return { ...o, items: patchRows(o.items) };
    }
    return old;
  });
}

/** The S/D bike that already holds a SKU, when there is one on a shelf. */
export interface ScratchDentHolder {
  sku: string;
  name: string | null;
  serial: string | null;
  location: string;
}

/**
 * An S/D is one bike per SKU. Registering a second box under a SKU that is
 * already an S/D on a shelf puts two bikes behind one catalogue row — one
 * photo, one serial, one model for both — and every edit to one shows up on
 * the other (01-0357, 29 Sep 2026: a Xenith registered under the Hudson's
 * number; their photos kept trading places). This is the question the
 * register screen asks before it lets that happen.
 */
export function useScratchDentHolder(enabled: boolean, sku: string) {
  const canonical = sku ? normalizeSkuOnRegister(sku) : '';
  const { data } = useQuery({
    queryKey: ['item-card', 'sd-holder', canonical],
    enabled: enabled && canonical.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<ScratchDentHolder | null> => {
      const { data: meta } = await supabase
        .from('sku_metadata')
        .select('sku, is_scratch_dent, serial_number')
        .eq('sku', canonical)
        .maybeSingle();
      if (!meta?.is_scratch_dent) return null;
      const { data: rows } = await supabase
        .from('inventory')
        .select('location, item_name, quantity')
        .eq('sku', canonical)
        .gt('quantity', 0)
        .order('quantity', { ascending: false })
        .limit(1);
      const row = rows?.[0];
      if (!row) return null;
      return {
        sku: meta.sku,
        name: row.item_name ?? null,
        serial: meta.serial_number ?? null,
        location: row.location ?? '—',
      };
    },
  });
  return enabled && canonical ? (data ?? null) : null;
}
