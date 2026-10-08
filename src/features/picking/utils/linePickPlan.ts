// Lo que la tarjeta de Double Check dice de UNA línea: de qué tarimas sale y
// cuántas unidades tiene cada una (el icono y la cifra junto al SKU).
//
// Hasta el 8 oct 2026 eso se calculaba por SKU, juntando la distribución de
// TODAS sus filas y ordenándola top primero. En #881852 el picker cambió
// 03-4038BL de ROW 32 a ROW 30 y la tarjeta siguió diciendo «30 E» con el
// icono de TOP y «12» —la tarima de ROW 32 E— cuando en ROW 30 E hay una line
// pallet de 7. Ahora se lee sólo la dirección de la línea, y dentro de ella
// sólo los cuadros que el plan de la base (`plan_square_picks`) dice que se
// tocan.

const norm = (s: string | null | undefined): string => (s || '').trim().toUpperCase();

/** Inventory rows without a warehouse are LUDLOW's, as everywhere in Double Check. */
const DEFAULT_WAREHOUSE = 'LUDLOW';

/**
 * El orden en que se vacían los grupos de un cuadro: el de `deduct_from_groups`
 * (top primero; torres y líneas son sólo de bicis de niño). Menor = antes.
 */
export const DISTRIBUTION_PRIORITY: Record<string, number> = {
  TOP: 0,
  BASE: 1,
  LINE_PALLET: 2,
  LINE: 3,
  TOWER: 4,
};

/**
 * La clave de una dirección en el plan de cuadros (`plan_square_picks_batch`).
 * Lleva el almacén: LUDLOW y ATS tienen filas con el mismo nombre, y sin él
 * una se quedaba con el plan de la otra.
 */
export const squarePlanKey = (
  sku: string,
  warehouse: string | null | undefined,
  location: string | null | undefined
): string => `${sku}-${norm(warehouse) || DEFAULT_WAREHOUSE}-${norm(location)}`;

export interface LineGroup {
  type: string;
  count: number;
  units_each: number;
  square?: string | null;
}

export interface LinePalletStep {
  type: string;
  /** Units taken off this group. */
  units: number;
  units_each: number;
}

/**
 * The groups a line's units come off, read from the line's own address.
 *
 * With a square plan, only the squares it names, each for the units it takes
 * there — the same squares the database deducts from. Without one (a row the
 * plan does not cover, or still loading), every group at the address in pick
 * order. Never a group from another row: if the address holds nothing, the
 * answer is nothing.
 */
export function linePalletSteps(input: {
  rows: readonly {
    warehouse?: string | null;
    location: string | null;
    distribution: readonly LineGroup[];
  }[];
  warehouse: string | null | undefined;
  location: string | null | undefined;
  qty: number;
  squarePlan?: readonly { square: string; take: number }[] | null;
}): LinePalletStep[] {
  const wh = norm(input.warehouse) || DEFAULT_WAREHOUSE;
  const loc = norm(input.location);
  if (!loc) return [];

  const groups = input.rows
    .filter((r) => (norm(r.warehouse) || DEFAULT_WAREHOUSE) === wh && norm(r.location) === loc)
    .flatMap((r) => r.distribution)
    .filter((g) => g.count > 0 && g.units_each > 0);
  if (groups.length === 0) return [];

  const byPickOrder = (a: LineGroup, b: LineGroup) =>
    (DISTRIBUTION_PRIORITY[a.type] ?? 99) - (DISTRIBUTION_PRIORITY[b.type] ?? 99) ||
    a.units_each - b.units_each;

  const steps: LinePalletStep[] = [];
  const consume = (pool: LineGroup[], qty: number) => {
    let remaining = qty;
    for (const g of [...pool].sort(byPickOrder)) {
      if (remaining <= 0) break;
      const units = Math.min(remaining, g.count * g.units_each);
      steps.push({ type: g.type, units, units_each: g.units_each });
      remaining -= units;
    }
  };

  const plan = (input.squarePlan ?? []).filter((p) => p.take > 0);
  if (plan.length > 0) {
    for (const p of plan) {
      consume(
        groups.filter((g) => norm(g.square) === norm(p.square)),
        p.take
      );
    }
    if (steps.length > 0) return steps;
  }

  consume(groups, Math.max(1, Math.trunc(Number(input.qty) || 0)));
  return steps;
}
