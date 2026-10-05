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
  calculatePalletsWithBikeAwareness,
  type Pallet,
  type PickingItem,
} from '../../../utils/pickingLogic';
import {
  KIDS_BIKES_BEFORE_TAPE,
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
 * La tarima grande que se lleva encima las pocas de niño: la que quede más baja
 * con ellas, siempre que no pase de 90" ni de dos cajas echadas. En empate, la
 * última — la que se está armando cuando se recogen, en ROW 42. `null` si
 * ninguna las aguanta.
 */
function pickKidsHost(
  adults: readonly PlannedPallet[],
  kidsItems: readonly PickingItem[],
  metaFor: (sku: string) => PalletBoxMeta | undefined,
  isKidSku: (sku: string) => boolean
): number | null {
  let best: { id: number; height: number } | null = null;
  for (const p of adults) {
    const est = layoutPallet([...p.items, ...kidsItems], metaFor, isKidSku);
    if (!est || est.overHeight || est.height > MAX_PALLET_HEIGHT_IN) continue;
    if (!best || est.height <= best.height) best = { id: p.id, height: est.height };
  }
  return best?.id ?? null;
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

  // 2. El resto, con el reparto de siempre y ordinales alrededor de los fijos.
  // Primero las tarimas físicas —grandes, después las de niño— y al final los
  // contenedores, que no son tarima: así «Pallet 3 de 5» es lo mismo en Double
  // Check y en Ship, sin un número gastado en la caja de partes.
  const rest = pool.filter((l) => l.pickingQty > 0);
  const base = calculatePalletsWithBikeAwareness(rest, sets.bikes, sets.smallBikes);
  const adults: PlannedPallet[] = [];
  const containers: PlannedPallet[] = [];
  let kidsItems: PickingItem[] = [];
  for (const p of base) {
    if (p.containerKind === 'smallBikes') kidsItems = p.items;
    else if (p.isParts) containers.push({ ...p });
    else adults.push({ ...p, id: nextOrdinal() });
  }

  // 4a. Pocas de niño: a qué tarima grande van encima. Se decide sobre el
  // reparto calculado, antes de lo tecleado, para que teclear una cifra no las
  // mude de tarima.
  const kidsUnits = qtyOf(kidsItems);
  const fewKids = kidsUnits > 0 && kidsUnits <= KIDS_BIKES_BEFORE_TAPE;
  const isKidSku = (sku: string) => sets.smallBikes.has(sku);
  const metaFor = options.metaFor ?? (() => undefined);
  // 4b. **Si toda la carga cabe en una tarima, va en una** (Rafael, 29 sep 2026:
  // «al combinar 2 órdenes de 2 bicicletas cada una el resultado debe ser una
  // orden combinada que sólo tiene 1 pallet»). Con una sola tarima grande, las
  // de niño —sean cuantas sean— van con ella si el armado con gravedad cabe
  // (≤ 90", ≤ 46"): #881678/#881780, 1 HELIX + 3 LASER, salía en dos. Si el
  // piso ya dijo en cuántas tarimas van las de niño (`split`), manda eso.
  const floorSplitsKids = floor.some((e) => (typedCount(e.split) ?? 0) > 1);
  const allOnOne =
    !fewKids &&
    kidsUnits > 0 &&
    adults.length === 1 &&
    !floorSplitsKids &&
    (() => {
      const l = layoutPallet([...adults[0].items, ...kidsItems], metaFor, isKidSku);
      return l != null && !l.overHeight;
    })();
  let hostId = fewKids
    ? pickKidsHost(adults, kidsItems, metaFor, isKidSku)
    : allOnOne
      ? adults[0].id
      : null;

  // 4c. **Tarimas parejas** (Rafael, 5 oct 2026: «distribuir en partes
  // similares y dejar las de 12 grandes como último recurso»). Cuando las de
  // niño van solas en una tarima al lado de las grandes, esa tarima recibe
  // grandes abajo —las últimas que se recogen antes de ROW 42— hasta que las
  // dos queden parejas, mientras el armado quepa (≤ 90", ≤ 2 echadas). #881828:
  // 12 grandes + 7 de niño salía 12 y 7; queda 10 y 9.
  //
  // Y el número tecleado manda: si el piso dice menos bicis en las grandes de
  // las que hay, las que sobran van a la de niño aunque no haya hecho falta
  // emparejar. Antes volvían a la misma tarima y la cifra no hacía nada.
  const kidsAlone =
    kidsUnits > 0 &&
    !fewKids &&
    hostId == null &&
    !floorSplitsKids &&
    adults.length > 0 &&
    (options.metaFor
      ? planKidsPallets(sortKidsLines(kidsItems, options.metaFor), options.metaFor).length === 1
      : true);
  if (kidsAlone) {
    const fits = (extra: readonly PickingItem[]) => {
      const l = layoutPallet([...extra, ...kidsItems], metaFor, isKidSku);
      return l != null && !l.overHeight && l.height <= MAX_PALLET_HEIGHT_IN;
    };
    const work = adults.map((p) => ({ ...p, items: p.items.map((l) => ({ ...l })) }));
    let moved: PickingItem[] = [];
    for (;;) {
      // La más cargada; en empate, la última.
      const big = work.reduce((a, b) => (qtyOf(b.items) >= qtyOf(a.items) ? b : a));
      if (qtyOf(big.items) - (kidsUnits + qtyOf(moved)) < 2) break;
      const tail = [...big.items].reverse().find((l) => l.pickingQty > 0);
      if (!tail) break;
      const same = (l: PickingItem) => l.sku === tail.sku && l.location === tail.location;
      const trial = moved.some(same)
        ? moved.map((l) => (same(l) ? { ...l, pickingQty: l.pickingQty + 1 } : l))
        : [...moved, { ...tail, pickingQty: 1 }];
      if (!fits(trial)) break;
      tail.pickingQty -= 1;
      moved = trial;
    }
    const adultUnits = qtyOf(adults.flatMap((p) => p.items));
    const said = adults.map((p) => typedCount(entryAt(p.id)?.bikes));
    const stranded =
      said.every((n) => n != null) && said.reduce<number>((t, n) => t + (n ?? 0), 0) < adultUnits;
    if (moved.length > 0 || stranded) {
      adults.splice(
        0,
        adults.length,
        ...work.map((p) => {
          const items = p.items.filter((l) => l.pickingQty > 0);
          return { ...p, items, totalUnits: qtyOf(items) };
        })
      );
      const host = makePallet(nextOrdinal(), moved);
      adults.push(host);
      hostId = host.id;
    }
  }

  // 4d. Con pocas de niño encima de una grande, lo parejo es el total de cada
  // fila, no sólo las grandes: la que las lleva carga menos grandes. #881764,
  // 14 + 2: 8 y 8, no 7 y 9.
  if (fewKids && hostId != null && adults.length > 1) {
    const total = qtyOf(adults.flatMap((p) => p.items)) + kidsUnits;
    const base = Math.floor(total / adults.length);
    let extra = total % adults.length;
    const even = new Map<number, number>();
    for (const p of adults) {
      if (p.id === hostId) even.set(p.id, Math.max(0, base - kidsUnits));
      else even.set(p.id, base + (extra-- > 0 ? 1 : 0));
    }
    adults.splice(0, adults.length, ...applyAdultCounts(adults, even));
  }

  // 3. Las bicis tecleadas por tarima, en las grandes. En la que lleva las de
  // niño encima, la cifra es el total que se ve en la fila: esas no son grandes.
  const typed = new Map<number, number>();
  for (const p of adults) {
    const n = typedCount(entryAt(p.id)?.bikes);
    if (n != null) typed.set(p.id, p.id === hostId ? Math.max(0, n - kidsUnits) : n);
  }
  const counted = applyAdultCounts(adults, typed).map((p) =>
    p.id === hostId
      ? {
          ...p,
          items: [...p.items, ...kidsItems],
          totalUnits: p.totalUnits + kidsUnits,
          // Sin grandes al final (el piso las pidió en otra), vuelve a ser la de niño.
          ...(p.items.length === 0 && kidsAlone ? { containerKind: 'smallBikes' as const } : {}),
        }
      : p
  );

  // 4. Las de niño.
  const kids: PlannedPallet[] = [];
  if (fewKids && hostId == null) {
    // Ninguna tarima grande las aguanta (o no hay): su propia tarima.
    kids.push(makePallet(nextOrdinal(), kidsItems, { containerKind: 'smallBikes' }));
  } else if (kidsUnits > 0 && !fewKids && hostId == null) {
    const first = nextOrdinal();
    const sorted = options.metaFor ? sortKidsLines(kidsItems, options.metaFor) : kidsItems;
    const planned = options.metaFor
      ? planKidsPallets(sorted, options.metaFor).map(qtyOf)
      : [kidsUnits];
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

  const numberedContainers = containers.map((p) => ({ ...p, id: nextOrdinal() }));
  return [...manual, ...counted, ...kids, ...numberedContainers]
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
