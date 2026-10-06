import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { lookalikesNear, neighbourLocations, type Lookalike } from '../utils/lookalikeSkus';

interface Line {
  sku: string;
  location: string | null;
  warehouse?: string | null;
}

/**
 * Los SKUs parecidos que hay en stock en la fila de cada línea y en sus
 * vecinas (`utils/lookalikeSkus.ts`): lo que Double Check hace parpadear.
 *
 * Pide sólo esas filas, no el inventario entero: el contexto de inventario
 * viene paginado y no sirve para saber qué hay al lado.
 */
export function useLookalikes(lines: readonly Line[]): Map<string, Lookalike> {
  const [result, setResult] = useState<Map<string, Lookalike>>(new Map());
  const key = lines
    .map((l) => `${l.sku}@${l.location ?? ''}@${l.warehouse ?? ''}`)
    .sort()
    .join(',');

  useEffect(() => {
    let cancelled = false;
    const located = lines.filter((l) => l.location);
    if (located.length === 0) {
      setResult(new Map());
      return;
    }
    void (async () => {
      const { data: locs } = await supabase
        .from('locations')
        .select('warehouse, location, picking_order')
        .not('picking_order', 'is', null)
        .order('picking_order');
      const walk = (locs ?? []).map((l) => (l.location ?? '').trim().toUpperCase());
      const near = [
        ...new Set(located.flatMap((l) => neighbourLocations(l.location as string, walk))),
      ];
      const { data: stock, error } = await supabase
        .from('inventory')
        .select('sku, location, warehouse')
        .in('location', near)
        .gt('quantity', 0)
        .eq('is_active', true);
      if (cancelled || error || !stock) return;
      setResult(lookalikesNear(located, stock, walk));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return result;
}
