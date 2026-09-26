/**
 * El reparto de pallets, en un solo sitio.
 *
 * Hasta el 26 sep 2026 se calculaba en cinco lugares —la tabla de Ship, la
 * pantalla de Double Check y tres veces en el carrito al completar (la orden,
 * cada hermana, el Add-On)— copiando las mismas llamadas
 * (`docs/prds/ship-pallet-truth.md`, R1). Este módulo es el paso 1 de ese plan:
 * **extraer sin cambiar nada**. Las reglas siguen siendo las de
 * `utils/pickingLogic.ts`; aquí se juntan una vez para que el arreglo que viene
 * (la tarima de niño que no cuenta, R2; la mezcla de niño con grandes, R4) se
 * haga en un solo lugar y lo hereden todos.
 *
 * Puro: no importa Supabase. La parte que consulta el catálogo vive en
 * `api/cartPalletCount.ts`.
 */
import type { Location } from '../../../schemas/location.schema';
import {
  calculatePalletsWithBikeAwareness,
  redistributeWithOverrides,
  type Pallet,
  type PickingItem,
} from '../../../utils/pickingLogic';

/** Qué SKUs de la carga son bici, y cuáles de ellas de niño (subconjunto). */
export interface BikeSets {
  bikes: Set<string>;
  smallBikes: Set<string>;
}

export interface PlanPalletsOptions {
  /**
   * Lo que el picker fijó en Double Check: pallet → unidades. Hoy se aplica con
   * `redistributeWithOverrides`, tal cual (R4 lo arregla después).
   */
  overrides?: Map<number, number>;
}

/** Las tarimas de una carga, en el orden de las líneas que recibe. */
export function planPallets(
  lines: PickingItem[],
  sets: BikeSets,
  options: PlanPalletsOptions = {}
): Pallet[] {
  const pallets = calculatePalletsWithBikeAwareness(lines, sets.bikes, sets.smallBikes);
  return options.overrides && options.overrides.size > 0
    ? redistributeWithOverrides(pallets, options.overrides)
    : pallets;
}

/**
 * Cuántos pallets físicos son, como lo cuentan hoy Double Check y el carrito:
 * todo contenedor que no sea de partes. **Deja fuera la tarima de niño**, que
 * sale con `isParts: true` — es exactamente R2, y se corrige aquí en F0.
 */
export function countPhysicalPallets(pallets: readonly Pallet[]): number {
  return pallets.filter((p) => !p.isParts).length;
}

/**
 * Las ubicaciones que pide la ruta optimizada, armadas desde las filas de
 * inventario del carrito. Estaba copiado tres veces en el carrito.
 */
export function locationsFromInventory(
  rows: ReadonlyArray<{
    location_id?: string | null;
    location?: string | null;
    warehouse?: string | null;
  }>
): Location[] {
  return rows.map((i) => ({
    id: i.location_id || '',
    location: i.location || '',
    warehouse: i.warehouse as Location['warehouse'],
    zone: null,
    max_capacity: null,
    picking_order: null,
    is_active: true,
    counts_as_storage: true,
    pick_priority: 'normal',
    created_at: '',
    length_ft: null,
    bike_line: null,
  }));
}
