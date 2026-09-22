import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import {
  buildSkuPalletDistribution,
  type InventorySourceRow,
  type SkuPalletDistribution,
} from '../utils/strappedPalletDistribution';

/** El contenedor que esta pantalla reparte. Una constante mientras sea uno solo. */
const CONTAINER_CODE = '6436N';

export const STRAPPED_PALLETS_QUERY_KEY = ['inventory', 'strapped-pallets'] as const;

export interface UseStrappedPalletsOptions {
  includeZeroStock?: boolean;
}

export function useStrappedPallets(options: UseStrappedPalletsOptions = {}) {
  const { includeZeroStock = false } = options;

  return useQuery({
    queryKey: [...STRAPPED_PALLETS_QUERY_KEY, { includeZeroStock }],
    queryFn: async (): Promise<SkuPalletDistribution[]> => {
      // El inventario sale SIEMPRE de la base. Hubo un respaldo que leía
      // `/data/inventory-prod.json` cuando la consulta fallaba o volvía vacía;
      // eso son 2.374 filas de inventario real servidas desde `public/`, o sea
      // publicadas en el sitio y —este repo es público— en GitHub. Y además
      // mentía en silencio: una consulta vacía pintaba la foto de otro día como
      // si fuera el stock de ahora. Si la base no contesta, la pantalla lo dice.
      const { data: invData, error: invError } = await supabase
        .from('inventory')
        .select(
          'id, sku, quantity, location, warehouse, sublocation, item_name, sku_metadata(sku, model, size, color, category, as400_description, received_year, is_bike, is_scratch_dent)'
        )
        .eq('is_active', true)
        .gt('quantity', 0);

      if (invError) throw invError;

      const rows: InventorySourceRow[] = (invData ?? []).map((row) => ({
        id: row.id,
        sku: row.sku,
        quantity: row.quantity,
        location: row.location,
        warehouse: row.warehouse,
        sublocation: Array.isArray(row.sublocation) ? (row.sublocation as string[]) : null,
        item_name: row.item_name,
        sku_metadata: Array.isArray(row.sku_metadata)
          ? (row.sku_metadata[0] ?? null)
          : ((row.sku_metadata as InventorySourceRow['sku_metadata']) ?? null),
      }));

      // If user wants to see catalog SKUs even if they have 0 stock
      if (includeZeroStock) {
        const existingSkus = new Set(rows.map((r) => r.sku.trim().toUpperCase()));
        try {
          const { data: metaData, error: metaError } = await supabase
            .from('sku_metadata')
            .select(
              'sku, model, size, color, category, as400_description, received_year, is_bike, is_scratch_dent'
            )
            .eq('is_bike', true)
            .eq('is_scratch_dent', false)
            .order('sku', { ascending: true })
            .limit(2000);

          if (!metaError && metaData) {
            for (const m of metaData) {
              const normalized = m.sku.trim().toUpperCase();
              if (!existingSkus.has(normalized)) {
                rows.push({
                  id: -Math.floor(Math.random() * 1000000),
                  sku: m.sku,
                  quantity: 0,
                  location: null,
                  warehouse: 'LUDLOW',
                  sublocation: null,
                  item_name: m.as400_description || null,
                  sku_metadata: m,
                });
                existingSkus.add(normalized);
              }
            }
          }
        } catch {
          // Ignore offline error for 0-stock search
        }
      }

      // Lo que trajo el contenedor lo dice el libro de inventario: los ADD que
      // entraron a esa ubicación. Estaba en `/data/container-6436n.json`, y no
      // hacía falta — los logs dan **exactamente** lo mismo, 33 SKUs y 285
      // unidades, comprobado contra producción el 22 sep 2026. Leerlo de ahí
      // además vale para el contenedor siguiente sin generar otro archivo.
      //
      // Se leen las entradas y no el stock vivo porque un contenedor se vacía
      // al repartirlo: 6436N está hoy en cero, y la pregunta que contesta esta
      // pantalla es «qué llegó», no «qué queda».
      const container6436Map = new Map<string, number>();
      const { data: intake, error: intakeError } = await supabase
        .from('inventory_logs')
        .select('sku, quantity_change')
        .eq('to_location', CONTAINER_CODE)
        .gt('quantity_change', 0);

      if (intakeError) throw intakeError;

      for (const log of intake ?? []) {
        const sku = String(log.sku ?? '')
          .trim()
          .toUpperCase();
        if (!sku) continue;
        container6436Map.set(
          sku,
          (container6436Map.get(sku) ?? 0) + Number(log.quantity_change ?? 0)
        );
      }

      // Y si todavía queda algo dentro del contenedor, eso manda sobre el
      // histórico para ese SKU: es stock que nadie ha repartido aún.
      for (const r of rows) {
        if ((r.location || '').trim().toUpperCase() === CONTAINER_CODE) {
          container6436Map.set(r.sku.trim().toUpperCase(), r.quantity || 0);
        }
      }

      return buildSkuPalletDistribution(rows, container6436Map);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
