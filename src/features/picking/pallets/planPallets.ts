/**
 * El reparto de pallets, en un solo sitio.
 *
 * Hasta el 26 sep 2026 se calculaba en cinco lugares —la tabla de Ship, la
 * pantalla de Double Check y tres veces en el carrito al completar—
 * (`docs/prds/ship-pallet-truth.md`, R1). Desde el 28 sep es también **el único
 * que sabe lo que dijo el piso** (Rafael: «tiene que ser unificado incluido
 * dcv… es el error que hemos estado cometiendo desde siempre»): hasta entonces
 * Ship aplicaba las bicis por tarima y la regla de niño por su cuenta, Double
 * Check guardaba sus ajustes en memoria y el carrito no sabía de ninguno.
 *
 * Entrada: las líneas en orden de recogida, qué es bici y qué es de niño, las
 * medidas del catálogo y **`pallet_dims`** —lo que el piso dijo de cada
 * tarima—. Salida: las tarimas tal como salen por la puerta, con su ordinal.
 * Lo usan Double Check, Ship, el carrito al completar, el resumen y el
 * progreso; nadie más decide tarimas.
 *
 * Las reglas, en el orden en que se aplican:
 *
 * 1. **Una tarima armada a mano** (`items`) manda: se aparta primero, con su
 *    ordinal, y el resto se reparte alrededor.
 * 2. Las grandes, con `calculatePalletsWithBikeAwareness` de siempre; las
 *    partes, en su contenedor.
 * 3. **Las bicis tecleadas por tarima** (`bikes`) mandan en las grandes; la
 *    última sin número absorbe la diferencia.
 * 4. **Las de niño**: dos o menos van **encima de la tarima grande que las
 *    aguante** (la que quede más baja con ellas, sin pasar de 90" ni de dos
 *    echadas), y si ninguna las aguanta, en su propia tarima — nunca en un
 *    contenedor que no se pinta (#881764, 28 sep 2026: la tabla de Ship decía
 *    8 + 6 y las dos Laser no salían en ninguna fila ni en el peso). Más de
 *    dos, en sus tarimas con la regla de `planKidsPallets` — o las que diga el
 *    «+/–» (`split`) y las bicis tecleadas en cada una.
 *
 * Puro: no importa Supabase y no muta su entrada.
 */
import type { Location } from '../../../schemas/location.schema';
import {
  consolidateIntoSinglePallet,
  type Pallet,
  type PickingItem,
} from '../../../utils/pickingLogic';
import {
  ADULTS_PER_PALLET_MAX,
  KIDS_PER_PALLET_MAX,
  KIDS_SPLIT_MAX,
  MAX_PALLET_HEIGHT_IN,
  planKidsPallets,
  sortKidsLines,
  splitLines,
  type PalletBoxMeta,
  type PalletDimsEntry,
} from '../../../utils/palletDims';
import { layoutPallet } from '../../../utils/palletLayout';

/** Qué SKUs de la carga son bici, y cuáles de ellas de niño (subconjunto). */
export interface BikeSets {
  bikes: Set<string>;
  smallBikes: Set<string>;
}

export interface PlanPalletsOptions {
  /** Lo que el piso dijo de cada tarima (`pallet_dims`), por ordinal. */
  floor?: readonly PalletDimsEntry[] | null;
  /**
   * Las medidas del catálogo. Sin ellas las de niño no tienen regla de alto y
   * van en una sola tarima (salvo que el piso diga otra cosa).
   */
  metaFor?: (sku: string) => PalletBoxMeta | undefined;
}

/** Una tarima del plan: el `Pallet` de siempre y de dónde salió. */
export interface PlannedPallet extends Pallet {
  /** La armó el picker a mano (`pallet_dims[].items`). */
  manual?: boolean;
  /** En una tarima de niño: el ordinal de la primera (la que guarda `split`) y cuántas son. */
  kidsOf?: number;
  kidsSplit?: number;
}

const qtyOf = (items: readonly { pickingQty: number }[]) =>
  items.reduce((sum, i) => sum + Math.max(0, i.pickingQty || 0), 0);

const typedCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

const makePallet = (
  id: number,
  items: PickingItem[],
  extra: Partial<PlannedPallet> = {}
): PlannedPallet => ({
  id,
  items,
  totalUnits: qtyOf(items),
  footprint_in2: 0,
  limitPerPallet: 0,
  ...extra,
});

/**
 * Saca `qty` unidades de `sku` (de esa ubicación si se dice, si no de
 * cualquiera) del montón, en orden. Devuelve lo sacado, con sus campos.
 */
function carve(
  pool: PickingItem[],
  sku: string,
  location: string | null | undefined,
  qty: number
): PickingItem[] {
  const out: PickingItem[] = [];
  let left = qty;
  const passes = location != null ? [true, false] : [false];
  for (const strict of passes) {
    for (const line of pool) {
      if (left <= 0) break;
      if (line.sku !== sku || line.pickingQty <= 0) continue;
      if (strict && (line.location ?? null) !== location) continue;
      const take = Math.min(left, line.pickingQty);
      out.push({ ...line, pickingQty: take });
      line.pickingQty -= take;
      left -= take;
    }
  }
  return out;
}

/** `total` en `n` partes que difieren en una como mucho; las primeras, las más llenas. */
const evenSizes = (total: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));

/** Las últimas `n` unidades de las líneas, en su orden: las que se recogen al final. */
function tailUnits(lines: readonly PickingItem[], n: number): PickingItem[] {
  const out: PickingItem[] = [];
  let left = n;
  for (let i = lines.length - 1; i >= 0 && left > 0; i -= 1) {
    const take = Math.min(left, Math.max(0, lines[i].pickingQty || 0));
    if (take > 0) out.unshift({ ...lines[i], pickingQty: take });
    left -= take;
  }
  return out;
}

/**
 * Corta `lines` (en el orden dado, que es el de recogida) en tramos continuos
 * de los tamaños pedidos. Un SKU que cae entre dos tramos se parte.
 */
function sliceLinesByCounts(
  lines: readonly PickingItem[],
  sizes: readonly number[]
): PickingItem[][] {
  const pool = lines.map((l) => ({ ...l }));
  let cursor = 0;
  return sizes.map((n) => {
    let left = n;
    const items: PickingItem[] = [];
    while (left > 0 && cursor < pool.length) {
      const line = pool[cursor];
      const take = Math.min(left, line.pickingQty);
      if (take > 0) items.push({ ...line, pickingQty: take });
      line.pickingQty -= take;
      left -= take;
      if (line.pickingQty <= 0) cursor += 1;
    }
    return items;
  });
}

/**
 * Las grandes con las bicis tecleadas por tarima (`bikes`). Una tarima con
 * número toma esas unidades, en orden, del montón de **todas** las grandes; las
 * demás conservan lo calculado y la última sin número se lleva lo que sobre. No
 * se crean ni se quitan tarimas (bug-045).
 */
function applyAdultCounts(adults: PlannedPallet[], typed: Map<number, number>): PlannedPallet[] {
  if (adults.length === 0 || !adults.some((p) => typed.has(p.id))) return adults;
  const pool = adults.flatMap((p) => p.items.map((l) => ({ ...l })));
  let left = qtyOf(pool);
  const lastFree = [...adults].reverse().find((p) => !typed.has(p.id))?.id;
  const targets = new Map<number, number>();
  for (const p of adults) {
    if (!typed.has(p.id)) continue;
    const t = Math.min(typed.get(p.id)!, left);
    targets.set(p.id, t);
    left -= t;
  }
  for (const p of adults) {
    if (typed.has(p.id) || p.id === lastFree) continue;
    const t = Math.min(qtyOf(p.items), left);
    targets.set(p.id, t);
    left -= t;
  }
  if (lastFree != null) targets.set(lastFree, left);
  else if (left > 0) {
    const last = adults[adults.length - 1].id;
    targets.set(last, (targets.get(last) ?? 0) + left);
  }
  let cursor = 0;
  return adults.map((p) => {
    let n = targets.get(p.id) ?? 0;
    const items: PickingItem[] = [];
    while (n > 0 && cursor < pool.length) {
      const line = pool[cursor];
      const k = Math.min(n, line.pickingQty);
      if (k > 0) items.push({ ...line, pickingQty: k });
      line.pickingQty -= k;
      n -= k;
      if (line.pickingQty <= 0) cursor += 1;
    }
    return { ...p, items, totalUnits: qtyOf(items) };
  });
}

/**
 * Encuentra el reparto de bicis grandes que minimiza el número de tarimas y,
 * dentro de ese mínimo, las deja lo más parejas posible llevando las de niño
 * encima de la última tarima (Rafael, 8 oct 2026).
 *
 * Devuelve `null` si las de niño no caben encima de ninguna combinación que
 * respete los topes físicos (≤ 90", ≤ 2 echadas, ≤ 12 grandes por tarima).
 */
function planAdultsWithKidsOnHost(
  adultLines: readonly PickingItem[],
  kidsItems: readonly PickingItem[],
  metaFor: (sku: string) => PalletBoxMeta | undefined,
  isKidSku: (sku: string) => boolean
): { adultSizes: number[]; hostIndex: number } | null {
  const adultUnits = qtyOf(adultLines);
  const kidsUnits = qtyOf(kidsItems);
  if (adultUnits === 0) return null;

  const fits = (adultTail: readonly PickingItem[]) => {
    const l = layoutPallet([...adultTail, ...kidsItems], metaFor, isKidSku);
    return l != null && !l.overHeight && l.height <= MAX_PALLET_HEIGHT_IN;
  };

  const minP = Math.max(1, Math.ceil(adultUnits / ADULTS_PER_PALLET_MAX));

  // 1. Primero el mínimo de tarimas (12 grandes, 15 de niño; las de niño encima de la última
  //    si caben ≤ 90" y ≤ 2 echadas, si no en la suya).
  //    Probamos primero con minP tarimas. Si no caben en minP, probamos con minP + 1.
  for (const P of [minP, minP + 1]) {
    const others = P - 1;
    if (others === 0) {
      if (adultUnits <= ADULTS_PER_PALLET_MAX && fits(adultLines)) {
        return { adultSizes: [adultUnits], hostIndex: 0 };
      }
      continue;
    }

    const lo = Math.max(0, adultUnits - ADULTS_PER_PALLET_MAX * others);
    const hi = Math.min(ADULTS_PER_PALLET_MAX, adultUnits - others);

    const candidates: { sizes: number[]; spread: number; maxRow: number; h: number }[] = [];

    for (let h = lo; h <= hi; h += 1) {
      const otherSizes = evenSizes(adultUnits - h, others);
      if (otherSizes.some((s) => s > ADULTS_PER_PALLET_MAX)) continue;

      const rows = [...otherSizes, h + kidsUnits];
      const spread = Math.max(...rows) - Math.min(...rows);
      const maxRow = Math.max(...rows);

      if (fits(tailUnits(adultLines, h))) {
        candidates.push({
          sizes: [...otherSizes, h],
          spread,
          maxRow,
          h,
        });
      }
    }

    if (candidates.length > 0) {
      // 2. Con ese número fijo, reparto parejo (menor spread, luego menor maxRow, luego primeras más llenas).
      candidates.sort((a, b) => a.spread - b.spread || a.maxRow - b.maxRow || a.h - b.h);
      return {
        adultSizes: candidates[0].sizes,
        hostIndex: P - 1,
      };
    }
  }

  return null;
}

/** Las tarimas de una carga, con lo que dijo el piso, ordenadas por ordinal. */
export function planPallets(
  lines: readonly PickingItem[],
  sets: BikeSets,
  options: PlanPalletsOptions = {}
): PlannedPallet[] {
  const floor = options.floor ?? [];
  const entryAt = (ordinal: number) => floor.find((e) => e.pallet === ordinal);
  const pool: PickingItem[] = lines.map((l) => ({ ...l }));

  // 1. Las tarimas armadas a mano, primero y con su ordinal.
  const manual: PlannedPallet[] = [];
  for (const entry of [...floor].sort((a, b) => a.pallet - b.pallet)) {
    if (!Array.isArray(entry.items) || entry.items.length === 0) continue;
    const items = entry.items.flatMap((pick) =>
      typedCount(pick?.qty) ? carve(pool, pick.sku, pick.location, typedCount(pick.qty)!) : []
    );
    if (items.length === 0) continue;
    // Sólo de niño: se mide con su regla (capas de 5), no con la de grandes.
    const allKids = items.every((i) => sets.smallBikes.has(i.sku));
    manual.push(
      makePallet(entry.pallet, items, {
        manual: true,
        ...(allKids ? { containerKind: 'smallBikes' as const } : {}),
      })
    );
  }
  const used = new Set(manual.map((p) => p.id));
  let cursor = 1;
  const nextOrdinal = () => {
    while (used.has(cursor)) cursor += 1;
    used.add(cursor);
    return cursor;
  };

  // 2. El resto, en orden de recogida.
  const rest = pool.filter((l) => l.pickingQty > 0);
  const parts = rest.filter((l) => !sets.bikes.has(l.sku));
  const adultLines = rest.filter((l) => sets.bikes.has(l.sku) && !sets.smallBikes.has(l.sku));
  const kidsItems = rest.filter((l) => sets.smallBikes.has(l.sku));

  const adultUnits = qtyOf(adultLines);
  const kidsUnits = qtyOf(kidsItems);
  const isKidSku = (sku: string) => sets.smallBikes.has(sku);
  const metaFor = options.metaFor ?? (() => undefined);
  const floorSplitsKids = floor.some((e) => (typedCount(e.split) ?? 0) > 1);

  const containers: PlannedPallet[] = [];
  if (parts.length > 0) {
    const merged = consolidateIntoSinglePallet(parts)[0];
    containers.push({
      id: 0,
      items: merged?.items ?? [],
      totalUnits: merged?.totalUnits ?? 0,
      footprint_in2: 0,
      limitPerPallet: 0,
      isParts: true,
      containerKind: 'parts',
    });
  }

  // 3. Primero el mínimo de tarimas, reparto parejo en orden de recogida.
  // Las de niño van encima de la última si caben (≤ 90", ≤ 2 echadas, ≤ 15 niños).
  const kidsFitOnOne =
    kidsUnits > 0 &&
    kidsUnits <= KIDS_PER_PALLET_MAX &&
    !floorSplitsKids &&
    (options.metaFor
      ? planKidsPallets(sortKidsLines(kidsItems, options.metaFor), options.metaFor).length === 1
      : true);

  const hostPlan =
    kidsFitOnOne && adultUnits > 0
      ? planAdultsWithKidsOnHost(adultLines, kidsItems, metaFor, isKidSku)
      : null;

  let adults: PlannedPallet[] = [];
  const kids: PlannedPallet[] = [];

  if (hostPlan) {
    const chunks = sliceLinesByCounts(adultLines, hostPlan.adultSizes);
    adults = chunks.map((chunk) => makePallet(nextOrdinal(), chunk));
    const hostId = adults[hostPlan.hostIndex].id;

    // 4. El piso manda: lo tecleado no se mueve.
    const typed = new Map<number, number>();
    for (const p of adults) {
      const n = typedCount(entryAt(p.id)?.bikes);
      if (n != null) typed.set(p.id, p.id === hostId ? Math.max(0, n - kidsUnits) : n);
    }
    adults = applyAdultCounts(adults, typed).map((p) =>
      p.id === hostId
        ? {
            ...p,
            items: [...p.items, ...kidsItems],
            totalUnits: p.totalUnits + kidsUnits,
            ...(p.items.length === 0 ? { containerKind: 'smallBikes' as const } : {}),
          }
        : p
    );
  } else {
    if (adultUnits > 0) {
      const minP = Math.max(1, Math.ceil(adultUnits / ADULTS_PER_PALLET_MAX));
      const sizes = evenSizes(adultUnits, minP);
      const chunks = sliceLinesByCounts(adultLines, sizes);
      adults = chunks.map((chunk) => makePallet(nextOrdinal(), chunk));

      // 4. El piso manda: lo tecleado no se mueve.
      const typed = new Map<number, number>();
      for (const p of adults) {
        const n = typedCount(entryAt(p.id)?.bikes);
        if (n != null) typed.set(p.id, n);
      }
      const said = adults.map((p) => typedCount(entryAt(p.id)?.bikes));
      const stranded =
        said.every((n) => n != null) && said.reduce<number>((t, n) => t + (n ?? 0), 0) < adultUnits;
      if (stranded) {
        adults.push(makePallet(nextOrdinal(), []));
      }
      adults = applyAdultCounts(adults, typed);
    }

    if (kidsUnits > 0) {
      const first = nextOrdinal();
      const sorted = options.metaFor ? sortKidsLines(kidsItems, options.metaFor) : kidsItems;
      const planned = options.metaFor
        ? planKidsPallets(sorted, options.metaFor).map(qtyOf)
        : evenSizes(kidsUnits, Math.ceil(kidsUnits / KIDS_PER_PALLET_MAX));
      const split = typedCount(entryAt(first)?.split);
      const n = split ? Math.max(1, Math.min(KIDS_SPLIT_MAX, split)) : Math.max(1, planned.length);
      const ordinals = [first];
      while (ordinals.length < n) ordinals.push(nextOrdinal());
      const said = ordinals.map((o) => typedCount(entryAt(o)?.bikes));
      const counts = said.some((c) => c != null) ? said : n === planned.length ? planned : [];
      splitLines(sorted, n, counts).forEach((items, i) => {
        kids.push(
          makePallet(ordinals[i], items, {
            containerKind: 'smallBikes',
            kidsOf: first,
            kidsSplit: n,
          })
        );
      });
    }
  }

  const numberedContainers = containers.map((p) => ({ ...p, id: nextOrdinal() }));
  return [...manual, ...adults, ...kids, ...numberedContainers]
    .filter((p) => p.items.length > 0)
    .sort((a, b) => a.id - b.id);
}

/**
 * Cuántas tarimas físicas son: todas menos los contenedores —la caja de
 * partes—. Las tarimas de niño cuentan
 * (R2 de `ship-pallet-truth.md`, cerrado el 28 sep 2026).
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
