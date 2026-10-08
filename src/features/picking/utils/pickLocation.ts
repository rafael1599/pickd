// Choosing which shelf to send the picker to when a SKU sits in several.
//
// The choice used to be quantity and nothing else: whichever row held the most
// units won. That reads as sensible and is wrong often enough to be the single
// biggest source of manual corrections — a third of every replacement recorded
// in five months is a picker changing the location of a SKU they were happy
// with otherwise. The clearest case is the buried row (named "42 BURIED" at the
// time, "ROW 42 BURIED" since): 39 units, so it beat a normal row holding 17,
// and the pickers re-routed it by hand four times in eight days.

import { LAST_RESORT_PICKING_ORDER, isLastResortOrder } from '../../../utils/pickingOrder';
import { isWarehouseContainer } from '../../registrar-container/lib/containers';

export { LAST_RESORT_PICKING_ORDER };

/**
 * Picking order per address, as `locations` records it.
 *
 * Keyed on warehouse *and* location, because the name alone is not unique: both
 * LUDLOW and ATS have a row called PALLETIZED, and they are ranked differently —
 * 9995 in one, the plain 999 "unranked" default in the other. Keyed on the name
 * alone, whichever row the query returned last decided the answer for both, so a
 * normal shelf could be skipped as buried or a buried one walked into.
 */
export type PickingOrderMap = ReadonlyMap<string, LocationRank> & {
  /**
   * Qué cuadros de cada ROW son accesibles — la tabla `row_squares` (8 oct
   * 2026). Viaja dentro del mapa porque es otra respuesta sobre la misma
   * dirección y así llega sola a cada camino que ya recibía el mapa. Sin ella
   * todo cuadro cuenta como accesible.
   */
  readonly squares?: RowSquaresMap;
};

/**
 * Los cuadros dibujados de cada ROW y si se alcanzan sin mover otro pallet:
 * `row_squares`, la copia en la base del `isFast` del motor del mapa
 * (`squareAccess.test.ts` falla si se separan). Clave: la ubicación en
 * mayúsculas; valor: letra → accesible.
 *
 * Es la misma tabla que lee `plan_square_picks` para decidir el cuadro dentro
 * de la fila, y por eso es la fuente aquí: la fila que elige este motor y el
 * cuadro que imprime y descuenta la base salen de la misma geometría.
 */
export type RowSquaresMap = ReadonlyMap<string, ReadonlyMap<string, boolean>>;

/**
 * El mapa sólo dibuja LUDLOW (Bay 2 y Bay 3; el comentario de `row_squares`).
 * Una ROW de otro almacén con el mismo nombre no es ese pasillo: no tiene
 * cuadros dibujados y cuenta como accesible.
 */
export const ROW_SQUARES_WAREHOUSE = 'LUDLOW';

/**
 * De dónde sale la unidad cuando el SKU está en varios sitios — la columna
 * `locations.pick_priority`.
 *
 * Es una pregunta distinta de `picking_order`, que dice *cuándo* se pasa por
 * ahí en el recorrido. Mientras las dos respuestas coincidieron, un solo número
 * bastaba: lo enterrado está al final del paseo y también es de donde menos
 * quieres coger. Dejaron de coincidir el 17 sep 2026, cuando CANCELLED PALLET
 * pasó a recorrerse antes de ROW 10 y a la vez a ser la primera fuente.
 */
export type PickPriority = 'first' | 'normal' | 'last';

/** Las dos respuestas que `locations` da sobre una dirección. */
export interface LocationRank {
  pickingOrder: number | null;
  pickPriority: PickPriority;
}

const norm = (s: string | null | undefined): string => (s || '').trim().toUpperCase();

const addressKey = (warehouse: string | null | undefined, location: string | null | undefined) =>
  `${norm(warehouse)}|${norm(location)}`;

/** Enough of a row to look its ranking up. */
export interface Address {
  warehouse?: string | null;
  location: string | null;
}

/**
 * Whether this address is a last resort. An unranked location is *not* — half
 * the warehouse has no picking_order, containers included, and demoting all of
 * them would change where nearly every pick is sourced from. Only a location
 * someone deliberately ranked out of the way qualifies.
 *
 * An address whose warehouse is unknown never matches, which lands on the safe
 * side: the row is treated as a normal shelf, exactly as before this existed.
 *
 * The threshold itself lives in shared utils: warehouse-management reads the
 * same one to show that a location has been ranked out of the route.
 */
export function isLastResort(
  address: Address | null | undefined,
  order?: PickingOrderMap
): boolean {
  if (!order || !address) return false;
  return order.get(addressKey(address.warehouse, address.location))?.pickPriority === 'last';
}

/**
 * El pallet del área de envío donde esperan las unidades de una orden
 * cancelada. Lo escribe `cancel_completed_order`; `locations` tiene una fila
 * para él con `pick_priority = 'first'`.
 *
 * El nombre sigue aquí como respaldo: un consumidor que no cargó `locations`
 * no puede leer la prioridad, y aun así debe vaciar este sitio primero.
 */
export const CANCELLED_PALLET_LOCATION = 'CANCELLED PALLET';

/**
 * Si de esta dirección hay que coger antes que de cualquier otra que tenga el
 * SKU.
 *
 * Una unidad aquí ya salió del estante y le debe un viaje a alguien: mandar la
 * siguiente orden a una fila deja el montón donde está y lo hace crecer, así
 * que la orden que necesita el SKU vacía esto primero y sólo después camina las
 * filas (Rafael, 1 sep 2026, sobre el sitio que entonces se llamaba RETURN TO
 * STOCK: "cualquier orden nueva quiero que prefiera items que están en return
 * to stock por encima de los otros"; desde el 17 sep 2026 ese pallet es
 * CANCELLED PALLET y RETURN TO STOCK pasó a ser lo contrario — donde descansan
 * las bicis que sólo se cogen si no queda otra).
 *
 * Se decide por `pick_priority`, no por el recorrido: el 420 de CANCELLED
 * PALLET dice *cuándo* se pasa por ahí —tras ROW 43, en el área de envío—, no
 * que gane. RETURN TO STOCK se recorre antes (294, antes de ROW 10) y aun así
 * es de lo último que se coge: son dos preguntas distintas.
 */
export function isFirstChoice(
  address: Address | null | undefined,
  order?: PickingOrderMap
): boolean {
  if (!address) return false;
  const rank = order?.get(addressKey(address.warehouse, address.location));
  if (rank) return rank.pickPriority === 'first';
  return norm(address.location) === CANCELLED_PALLET_LOCATION;
}

/**
 * Un grupo de `distribution` tal como lo necesita el motor: cuántas unidades y
 * en qué cuadro de la fila. El resto del grupo (tipo, etiqueta) no decide nada
 * aquí.
 */
export interface SquareGroup {
  count?: number | null;
  units_each?: number | null;
  square?: string | null;
}

/** The subset of an inventory row this comparison needs. */
interface LocatedRow extends Address {
  quantity?: number | null;
  sublocation?: string[] | null;
  /** Sin ella la fila no tiene cantidad por cuadro y compite con la de la fila. */
  distribution?: readonly SquareGroup[] | null;
}

/** Qué tan a mano está un cuadro: lo mismo que ordena `plan_square_picks`. */
const Reach = {
  /** Accesible: `is_fast`, una fila que el mapa no dibuja o un grupo sin cuadro. */
  Open: 0,
  /** Enterrado, pero al lado de uno accesible. */
  NextToOpen: 1,
  Buried: 2,
} as const;
type Reach = (typeof Reach)[keyof typeof Reach];

/** Tramo de `pick_priority`: el pallet de canceladas, lo normal, el último recurso. */
const Tier = { First: 0, Normal: 1, Last: 2 } as const;
type Tier = (typeof Tier)[keyof typeof Tier];

/** De dónde sale una unidad: un cuadro concreto de una fila concreta. */
interface SquareSource {
  /** `null` = la fila no dice cuánto hay en cada cuadro. */
  square: string | null;
  units: number;
  reach: Reach;
}

const SQUARE_LETTER = /^[A-Z]$/;

const groupUnits = (g: SquareGroup): number =>
  Math.max(0, Math.trunc(Number(g.count) || 0)) *
  Math.max(0, Math.trunc(Number(g.units_each) || 0));

const tierOf = (row: Address, order?: PickingOrderMap): Tier =>
  isFirstChoice(row, order) ? Tier.First : isLastResort(row, order) ? Tier.Last : Tier.Normal;

/** Los cuadros dibujados de esta dirección, o `undefined` si el mapa no la dibuja. */
function drawnSquares(
  row: Address,
  order?: PickingOrderMap
): ReadonlyMap<string, boolean> | undefined {
  const warehouse = norm(row.warehouse) || ROW_SQUARES_WAREHOUSE;
  if (warehouse !== ROW_SQUARES_WAREHOUSE) return undefined;
  const drawn = order?.squares?.get(norm(row.location));
  return drawn && drawn.size > 0 ? drawn : undefined;
}

/**
 * Los cuadros de una fila en el orden en que se vacían, que es el de
 * `plan_square_picks` (`20261007025547`) copiado tal cual: accesible → al lado
 * de uno accesible → menos unidades → letra más alta; en una fila que el mapa
 * no dibuja, de la A en adelante. Copiado a propósito y no reinventado: la
 * base descuenta con ese orden al completar, así que el cuadro que este motor
 * apunta en la línea es el mismo del que sale el descuento. Si cambia allá,
 * cambiar acá (y el test de los casos de #881852).
 *
 * Una fila sin cantidad por cuadro (grupos sin `square`, una ubicación que no
 * es ROW) es una sola fuente con la cantidad de la fila, accesible — el default
 * aprobado el 8 oct 2026 —, y va detrás de las que sí la tienen.
 */
function squareSources(row: LocatedRow, order?: PickingOrderMap): SquareSource[] {
  const qty = Math.max(0, Math.trunc(Number(row.quantity) || 0));
  if (qty === 0) return [];

  const groups = Array.isArray(row.distribution) ? row.distribution : [];
  const known =
    norm(row.location).startsWith('ROW') &&
    groups.length > 0 &&
    groups.every((g) => SQUARE_LETTER.test(norm(g.square)));
  if (!known) return [{ square: null, units: qty, reach: Reach.Open }];

  const perSquare = new Map<string, number>();
  for (const g of groups) {
    const letter = norm(g.square);
    perSquare.set(letter, (perSquare.get(letter) ?? 0) + groupUnits(g));
  }

  const drawn = drawnSquares(row, order);
  const reachOf = (letter: string): Reach => {
    if (!drawn || drawn.get(letter)) return Reach.Open;
    const code = letter.charCodeAt(0);
    const neighbour = [String.fromCharCode(code - 1), String.fromCharCode(code + 1)];
    return neighbour.some((n) => drawn.get(n)) ? Reach.NextToOpen : Reach.Buried;
  };

  const sources: SquareSource[] = [...perSquare.entries()]
    .filter(([, units]) => units > 0)
    .map(([square, units]) => ({ square, units, reach: reachOf(square) }));
  sources.sort((a, b) =>
    drawn
      ? a.reach - b.reach || a.units - b.units || (b.square ?? '').localeCompare(a.square ?? '')
      : (a.square ?? '').localeCompare(b.square ?? '')
  );

  // La cantidad de la fila manda sobre la suma de sus grupos. Lo que falta
  // (otra orden lo tiene apartado, o la distribución no se puso al día) sale de
  // los primeros cuadros, que es de donde lo sacará esa otra orden; lo que
  // sobra no tiene cuadro conocido y va como fuente sin cuadro.
  let excess = sources.reduce((sum, s) => sum + s.units, 0) - qty;
  for (const s of sources) {
    if (excess <= 0) break;
    const gone = Math.min(s.units, excess);
    s.units -= gone;
    excess -= gone;
  }
  const out = sources.filter((s) => s.units > 0);
  if (excess < 0) out.push({ square: null, units: -excess, reach: Reach.Open });
  return out;
}

/**
 * Cuál de dos fuentes se vacía antes, con todas las filas del SKU compitiendo
 * a la vez (8 oct 2026, Rafael: «priorizar rows con acceso a pasillo y menor
 * cantidad»):
 *
 *   1. el pallet de canceladas (`pick_priority = 'first'`);
 *   2. accesible antes que enterrado (y, entre enterrados, el que está al lado
 *      de uno accesible);
 *   3. con cantidad por cuadro antes que sin ella;
 *   4. menos unidades;
 *   5. la letra más alta (regla del 18 sep, hoy desempate);
 *   6. `pick_priority = 'last'` al final aunque sea accesible.
 *
 * Hasta este día la fila la elegía la cantidad —la de MÁS unidades— y el
 * cuadro lo elegía después la base con el criterio contrario: dos motores. En
 * #881852 eso mandó 03-4038BL a ROW 32 (60 u, D y E enterrados) teniendo ROW 30
 * E (una line pallet de 7, accesible), y 03-3740BK a ROW 27 A (30) teniendo
 * ROW 26 A (5). El picker los cambió a mano.
 */
function compareSources(
  a: { tier: Tier; source: SquareSource; location: string | null },
  b: { tier: Tier; source: SquareSource; location: string | null }
): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.source.reach !== b.source.reach) return a.source.reach - b.source.reach;
  const knownA = a.source.square === null ? 1 : 0;
  const knownB = b.source.square === null ? 1 : 0;
  if (knownA !== knownB) return knownA - knownB;
  if (a.source.units !== b.source.units) return a.source.units - b.source.units;
  const letter = (b.source.square ?? '').localeCompare(a.source.square ?? '');
  if (letter !== 0) return letter;
  return norm(a.location).localeCompare(norm(b.location));
}

/**
 * Orders candidate rows best-first with the same rule the planner uses: each
 * row competes with the first square it would be picked from (see
 * `compareSources`). The cancelled pallet first, last-resort rows last, and in
 * between the accessible square with the fewest units.
 *
 * For callers that need one row, not a route — the variant sibling, the
 * canonical SKU, the address Double Check fills in for a line that has none.
 * Without `squares` in the map every square counts as accessible; without the
 * map at all the cancelled pallet is still recognised by name.
 */
export function byPickPreference<T extends LocatedRow>(
  order?: PickingOrderMap
): (a: T, b: T) => number {
  const head = (row: T) => ({
    tier: tierOf(row, order),
    source: squareSources(row, order)[0] ?? { square: null, units: 0, reach: Reach.Open },
    location: row.location,
  });
  return (a, b) => compareSources(head(a), head(b));
}

/**
 * Builds the lookup `byPickPreference` expects from raw `locations` rows.
 *
 * Select `warehouse` alongside `location`, `picking_order` **y
 * `pick_priority`**: sin warehouse la fila no se puede emparejar y su ranking
 * se ignora en silencio; sin `pick_priority` se cae al puente de abajo.
 *
 * El puente: una fila que no trae la columna se clasifica por el significado
 * viejo del número (≥9000 = último recurso). Así una consulta que todavía no
 * la pide se comporta exactamente como antes en lugar de tratar media bodega
 * como normal.
 *
 * `squareRows` son las filas de `row_squares` (8 oct 2026): con ellas el mapa
 * sabe también qué cuadro es accesible. `fetchPickingOrderMap`
 * (`api/pickingOrder.ts`) trae las dos tablas a la vez.
 */
export function toPickingOrderMap(
  rows:
    | {
        warehouse?: string | null;
        location: string | null;
        picking_order: number | null;
        pick_priority?: string | null;
      }[]
    | null
    | undefined,
  squareRows?: readonly { location: string; letter: string; is_fast: boolean }[] | null
): PickingOrderMap {
  const map = new Map<string, LocationRank>() as Map<string, LocationRank> & {
    squares?: RowSquaresMap;
  };
  for (const row of rows ?? []) {
    const declared = row.pick_priority;
    const pickPriority: PickPriority =
      declared === 'first' || declared === 'normal' || declared === 'last'
        ? declared
        : isLastResortOrder(row.picking_order)
          ? 'last'
          : 'normal';
    map.set(addressKey(row.warehouse, row.location), {
      pickingOrder: row.picking_order,
      pickPriority,
    });
  }
  if (squareRows && squareRows.length > 0) map.squares = toRowSquaresMap(squareRows);
  return map;
}

/** `row_squares` → ubicación → letra → accesible. */
export function toRowSquaresMap(
  rows: readonly { location: string; letter: string; is_fast: boolean }[]
): RowSquaresMap {
  const out = new Map<string, Map<string, boolean>>();
  for (const r of rows) {
    const loc = norm(r.location);
    const letters = out.get(loc) ?? new Map<string, boolean>();
    letters.set(norm(r.letter), !!r.is_fast);
    out.set(loc, letters);
  }
  return out;
}

/** One stop of a pick: the units that come off this exact address. */
export interface PickLeg {
  location: string | null;
  sublocation: string[] | null;
  /** Units to take here. */
  qty: number;
  /** Units the shelf holds — what the picker sees when they get there. */
  available: number;
  isLastResort: boolean;
}

/** How one SKU's pick is covered across the shelves that actually hold it. */
export interface PickPlan {
  legs: PickLeg[];
  /** Units nothing on the floor can cover — a real shortage, not a routing problem. */
  shortfall: number;
}

/**
 * Marks a pick that had to be spread over more than one address, so the card
 * can say which stop it is instead of looking like a duplicate SKU.
 *
 * A type alias rather than an interface on purpose: this rides inside
 * `picking_lists.items`, and only an alias gets the implicit index signature
 * that makes it assignable to the generated `Json` type.
 */
export type PickSplit = {
  /** 1-based stop number. */
  part: number;
  of: number;
  /** Units the whole pick needs, across every leg. */
  totalQty: number;
  isLastResort: boolean;
};

/** An order row that may be one leg of a split pick. */
interface CollapsibleItem {
  sku: string;
  pickingQty?: number;
  pickSplit?: PickSplit | null;
}

/**
 * Folds a split pick back into a single row for `sku`, keeping the first stop
 * and the full quantity.
 *
 * Corrections address a SKU, not an address — Edit Order has no notion of
 * "leg 2 of 3". Applied leg by leg they misfire in ways that are hard to see
 * afterwards: adjust_qty writes the new quantity onto every leg and multiplies
 * the order, and a swap leaves two rows carrying identical
 * (sku, warehouse, location), which `pick_item` matches by — so the second one
 * can never be checked off.
 *
 * Collapsing first makes the correction mean what the operator meant. Nothing
 * is lost by it: the route is recomputed from live inventory on every rebase,
 * never inherited, so the pick splits again on the way out if the stock still
 * demands it.
 */
export function collapseSplitForSku<T extends CollapsibleItem>(items: T[], sku: string): T[] {
  const legs = items.filter((i) => i.sku === sku && i.pickSplit);
  if (legs.length < 2) return items;

  const totalQty = legs.reduce((sum, i) => sum + Number(i.pickingQty || 0), 0);

  let kept = false;
  const collapsed: T[] = [];
  for (const i of items) {
    if (i.sku !== sku || !i.pickSplit) {
      collapsed.push(i);
      continue;
    }
    if (kept) continue;
    kept = true;
    collapsed.push({ ...i, pickingQty: totalQty, pickSplit: null });
  }
  return collapsed;
}

/**
 * Works out where a pick of `requiredQty` actually comes from — which rows and
 * which squares of them, with every row of the SKU competing at once.
 *
 * The order is `compareSources` (8 Oct 2026): the cancelled pallet, then the
 * accessible square with the fewest units, buried squares only once nothing
 * accessible is left, last-resort rows at the very end. Within a row the
 * squares go in `plan_square_picks` order, so the leg's `sublocation` names
 * the squares the database will deduct from.
 *
 * One stop still beats two when an accessible address can do the whole job:
 * the first one in that order wins, and `frozenLocation` breaks the tie in
 * favour of staying put. The shortcut never keeps a pick on a buried square or
 * a last-resort row while an accessible one could take it (Rafael, 8 Oct 2026):
 * an address only qualifies with the units it has in the open.
 *
 * When the accessible squares cannot cover the pick, they are emptied first
 * and the rest comes off the buried ones (the default approved for the ❓ of 8
 * Oct): the pick splits into stops, which `pickSplit` already tells apart.
 */
export function planPickAcrossLocations<T extends LocatedRow>(
  rows: T[],
  requiredQty: number,
  order?: PickingOrderMap,
  frozenLocation?: string | null
): PickPlan {
  const needed = Math.max(0, Math.trunc(Number(requiredQty) || 0));
  if (needed === 0) return { legs: [], shortfall: 0 };

  // A container ('7005N') is staging for stock not yet put away, not a shelf —
  // it never qualifies as a pick source, not even as a last resort. Excluded
  // here, before anything else, so no path below can route a pick to one.
  const available = rows.filter(
    (r) => Number(r.quantity || 0) > 0 && !isWarehouseContainer(r.location)
  );
  if (available.length === 0) return { legs: [], shortfall: needed };

  // Una cola por dirección, en el orden en que se vacían sus cuadros. Clave
  // (warehouse, location), como `addressKey`: ROW 30 de LUDLOW y ROW 30 de ATS
  // son dos sitios.
  interface Queue {
    key: string;
    rows: T[];
    tier: Tier;
    sources: SquareSource[];
  }
  const queues = new Map<string, Queue>();
  for (const row of available) {
    const key = addressKey(row.warehouse, row.location);
    const q = queues.get(key);
    if (q) {
      q.rows.push(row);
      q.sources.push(...squareSources(row, order));
    } else {
      queues.set(key, {
        key,
        rows: [row],
        tier: tierOf(row, order),
        sources: squareSources(row, order),
      });
    }
  }

  interface Taken {
    qty: number;
    squares: string[];
    unknown: boolean;
  }
  const taken = new Map<string, Taken>();
  let remaining = needed;

  // `openOnly`: el atajo de una parada sólo cuenta lo que la dirección tiene a
  // mano, y sólo eso toma.
  const takeFrom = (q: Queue, limit: number, openOnly = false): void => {
    for (const s of q.sources) {
      if (remaining <= 0 || limit <= 0) break;
      if (s.units <= 0 || (openOnly && s.reach !== Reach.Open)) continue;
      const qty = Math.min(s.units, remaining, limit);
      const t = taken.get(q.key) ?? { qty: 0, squares: [], unknown: false };
      t.qty += qty;
      if (s.square === null) t.unknown = true;
      else if (!t.squares.includes(s.square)) t.squares.push(s.square);
      taken.set(q.key, t);
      remaining -= qty;
      limit -= qty;
      s.units -= qty;
    }
    q.sources = q.sources.filter((s) => s.units > 0);
  };

  const headOf = (q: Queue) => ({
    tier: q.tier,
    source: q.sources[0],
    location: q.rows[0].location,
  });
  const best = (pool: Queue[]): Queue | undefined =>
    pool
      .filter((q) => q.sources.length > 0)
      .sort((a, b) => compareSources(headOf(a), headOf(b)))[0];

  // El pallet de canceladas va primero, y no entra en el atajo de una sola
  // parada de abajo: un estante que cubriera la línea entera no puede dejar
  // esas unidades en el suelo, porque deben un viaje de todas formas. Cogerlas
  // aquí ES ese viaje.
  const all = [...queues.values()];
  const first = all.filter((q) => q.tier === Tier.First);
  for (let q = best(first); q && remaining > 0; q = best(first)) takeFrom(q, remaining);

  // Una sola parada si una dirección normal cubre lo que falta con lo que
  // tiene a mano. La congelada gana el empate; si no, la primera en el orden.
  const openUnits = (q: Queue): number =>
    q.sources.filter((s) => s.reach === Reach.Open).reduce((sum, s) => sum + s.units, 0);
  if (remaining > 0) {
    const frozen = frozenLocation ? norm(frozenLocation) : null;
    const covering = all
      .filter((q) => q.tier === Tier.Normal && openUnits(q) >= remaining)
      .sort((a, b) => compareSources(headOf(a), headOf(b)));
    const solo = covering.find((q) => norm(q.rows[0].location) === frozen) ?? covering[0];
    if (solo) takeFrom(solo, remaining, true);
  }

  // Si no: cuadro a cuadro, siempre el mejor que quede en cualquier fila.
  for (let q = best(all); q && remaining > 0; q = best(all)) takeFrom(q, q.sources[0].units);

  const legs: PickLeg[] = [];
  for (const [key, t] of taken) {
    const q = queues.get(key)!;
    const rowLetters = q.rows.flatMap((r) => r.sublocation ?? []);
    const letters = t.unknown ? [...new Set([...t.squares, ...rowLetters])] : t.squares;
    legs.push({
      location: q.rows[0].location,
      sublocation: letters.length > 0 ? letters : null,
      qty: t.qty,
      available: q.rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0),
      isLastResort: q.tier === Tier.Last,
    });
  }

  return { legs, shortfall: remaining };
}

/**
 * Cuántas de `qty` unidades tomadas en esta dirección salen de un cuadro
 * enterrado o de una fila de último recurso — lo que cuesta sacar.
 *
 * Es la pregunta con la que el guardia decide si una línea ya planificada se
 * queda donde está (8 oct 2026): cubrir no basta si para cubrir hay que
 * desenterrar mientras otra dirección lo tiene a mano.
 */
export function buriedUnitsAt<T extends LocatedRow>(
  rows: readonly T[],
  warehouse: string | null | undefined,
  location: string | null | undefined,
  qty: number,
  order?: PickingOrderMap
): number {
  let left = Math.max(0, Math.trunc(Number(qty) || 0));
  const key = addressKey(warehouse, location);
  const here = rows.filter(
    (r) => Number(r.quantity || 0) > 0 && addressKey(r.warehouse, r.location) === key
  );
  if (here.length === 0 || left === 0) return 0;
  if (tierOf(here[0], order) === Tier.Last) return left;
  let buried = 0;
  for (const s of here.flatMap((r) => squareSources(r, order))) {
    if (left <= 0) break;
    const take = Math.min(s.units, left);
    if (s.reach !== Reach.Open) buried += take;
    left -= take;
  }
  return buried;
}
