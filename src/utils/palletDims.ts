/**
 * El pallet como bulto: cuánto mide y cuánto pesa lo que sale por la puerta.
 *
 * Audit Source cotiza una carga regular por **bultos**, no por su contenido: pide
 * cuántos pallets, cuánto pesan y —en LTL— cuánto miden. PickD nunca tuvo ese
 * dato. El operador lo teclea en Double Check con la cinta en la mano; este
 * módulo calcula lo que va **en gris debajo**, para que teclear sea corregir y
 * no llenar tres campos vacíos (PRD `docs/prds/ship-pallet-dimensions.md`).
 *
 * ## El armado, que es lo que decide la geometría
 *
 * Las cajas van **de canto**, una junto a otra, en dos niveles, y lo que no cabe
 * de canto se pone **acostado encima**. Cuántas caben por nivel lo dice el
 * tamaño del pallet: cuatro hasta diez bicis, cinco de once en adelante — que es
 * exactamente de dónde salen las capacidades 8 / 10 / 12 que `calculatePallets`
 * usa desde siempre (4+4, 4+4+2, 5+5+2).
 *
 * **Qué caja va en qué nivel no se adivina: se lee del orden de recogida**
 * (Rafael, 22 sep 2026), que es el de la vista Double Check —
 * `getOptimizedPickingPath`, el recorrido por `picking_order` — armando de
 * derecha a izquierda. Las acostadas son «las dos últimas bicicletas
 * recogidas». La dirección no cambia ninguna suma; cambiaría un dibujo.
 *
 * ## Los tres ejes, que en PickD no se llaman como uno espera
 *
 * `sku_metadata` guarda `length/width/height` como **longest / thinnest /
 * middle** (ver CLAUDE.md, export a FSM). En el pallet cada uno hace un trabajo
 * distinto, y cruzarlos es declarar un bulto que no existe:
 *
 * | En el pallet | Sale de | El eje |
 * |---|---|---|
 * | Largo | la bici más larga | `length_in` |
 * | Ancho | la suma de un nivel, de canto | `width_in` (el delgado) |
 * | Alto | la más alta de cada nivel | `height_in` (el intermedio) |
 * | Alto extra | cada caja acostada encima | su `width_in` |
 *
 * ## Dos cosas que este módulo hace a propósito
 *
 * - **Estima aunque falten medidas.** 529 bicis están sobre los defaults del
 *   trigger; exigir `dimensions_verified` dejaría casi toda orden sin número, y
 *   las mediciones van saliendo poco a poco (Rafael, 22 sep 2026: «no quiero que
 *   eso nos frene»). Así que se estima y se **dice de qué está hecho** —
 *   `unmeasured` es la cuenta de cajas sin medir, que la pantalla pinta en ámbar
 *   y que es además la cola de `/export/measure`.
 * - **La e-bike no cuenta.** Viaja dentro del pallet, pero Audit Source la
 *   quiere declarada como cartón aparte con su propio peso y sus propias
 *   medidas (idea-167), así que se le resta al pallet las dos cosas o la carga
 *   se declara dos veces. `ShipScreen` ya hace lo mismo con el peso total.
 */
import { BIKE_SKU_DEFAULTS } from './skuDefaults';

/** La tarima de madera bajo las cajas: 48 × 40, 5" de alto, 40 lb (Rafael, 22 sep 2026). */
export const DECK_LENGTH_IN = 48;
export const DECK_WIDTH_IN = 40;
export const DECK_HEIGHT_IN = 5;
export const DECK_WEIGHT_LBS = 40;

/**
 * Cuántas cajas caben de canto en un nivel. Cuatro hasta diez bicis, cinco de
 * once en adelante: con dos niveles y hasta dos acostadas encima eso cubre
 * 8 / 10 / 12, los tres tamaños de pallet que PickD arma.
 */
export const boxesPerLevel = (boxes: number): number => (boxes <= 10 ? 4 : 5);

/** Cuántos niveles de canto llegan a montarse: uno o dos, nunca tres. */
export const MAX_LEVELS = 2;

/** Lo que hace falta saber de una caja para medir el pallet que la lleva. */
export interface PalletBoxMeta {
  length_in?: number | null;
  width_in?: number | null;
  height_in?: number | null;
  weight_lbs?: number | null;
  /** `false` o ausente = nadie la midió; cuenta en `unmeasured`, pero no frena. */
  dimensions_verified?: boolean | null;
}

/** Una línea del pallet, en el orden en que Double Check la enseña. */
export interface PalletLine {
  sku: string;
  pickingQty: number;
  /**
   * `true` cuando la línea es una bici eléctrica: viaja en el pallet pero se
   * declara como cartón aparte, así que no suma ni al peso ni a la geometría.
   */
  isElectric?: boolean;
}

/** Las tres medidas de un bulto, en pulgadas, tal como se declaran. */
export interface PalletSize {
  /** El lado más largo apoyado en el piso — la bici más larga, o el deck. */
  length: number;
  /** El otro lado del piso — lo que suma un nivel de canto, o el deck. */
  width: number;
  /** Del piso a lo más alto, incluida la tarima. */
  height: number;
}

export interface PalletEstimate extends PalletSize {
  /** Cajas + tarima, en libras. */
  weightLbs: number;
  /** Cajas contadas: unidades del pallet menos las eléctricas. */
  boxes: number;
  /** Cuántas van de canto en cada nivel. */
  perLevel: number;
  /** Niveles de canto montados: 1 ó 2. */
  levels: number;
  /** Cuántas quedaron acostadas encima. */
  flat: number;
  /** Cuántas de esas cajas nadie ha medido — el número que sale en ámbar. */
  unmeasured: number;
}

const positive = (value: number | null | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** Una caja ya resuelta: sus tres lados y su peso, con los defaults aplicados. */
interface Box {
  length: number;
  width: number;
  height: number;
  weight: number;
  measured: boolean;
}

/**
 * Las cajas del pallet, una por unidad y en el orden de recogida — que es el
 * orden en que se arman. Una línea de tres bicis iguales son tres cajas: la
 * aritmética de niveles cuenta cajas, no líneas.
 */
function expandBoxes(
  lines: readonly PalletLine[],
  metaFor: (sku: string) => PalletBoxMeta | undefined
): Box[] {
  const boxes: Box[] = [];
  for (const line of lines) {
    if (!line || line.isElectric) continue;
    const qty = Math.max(0, Math.floor(line.pickingQty || 0));
    if (qty === 0) continue;
    const meta = metaFor(line.sku);
    const box: Box = {
      length: positive(meta?.length_in, BIKE_SKU_DEFAULTS.length_in),
      width: positive(meta?.width_in, BIKE_SKU_DEFAULTS.width_in),
      height: positive(meta?.height_in, BIKE_SKU_DEFAULTS.height_in),
      weight: positive(meta?.weight_lbs, BIKE_SKU_DEFAULTS.weight_lbs),
      measured: meta?.dimensions_verified === true,
    };
    for (let i = 0; i < qty; i += 1) boxes.push({ ...box });
  }
  return boxes;
}

/**
 * Lo que mediría y pesaría este pallet si nadie lo mide: la cifra que sale en
 * gris bajo los tres campos. `null` cuando no hay ninguna caja que declarar —
 * un contenedor de partes, o un pallet que era sólo eléctricas.
 */
export function estimatePallet(
  lines: readonly PalletLine[],
  metaFor: (sku: string) => PalletBoxMeta | undefined
): PalletEstimate | null {
  const boxes = expandBoxes(lines, metaFor);
  if (boxes.length === 0) return null;

  const perLevel = boxesPerLevel(boxes.length);
  const standing = Math.min(boxes.length, MAX_LEVELS * perLevel);
  const levels = Math.ceil(standing / perLevel);
  const flat = boxes.length - standing;

  let width = DECK_WIDTH_IN;
  let height = 0;
  for (let level = 0; level < levels; level += 1) {
    const inLevel = boxes.slice(level * perLevel, Math.min((level + 1) * perLevel, standing));
    width = Math.max(
      width,
      inLevel.reduce((sum, box) => sum + box.width, 0)
    );
    height += inLevel.reduce((tallest, box) => Math.max(tallest, box.height), 0);
  }

  // Las acostadas son las últimas del orden de recogida, y lo que suman de alto
  // es su lado delgado: están de plano sobre el último nivel.
  for (const box of boxes.slice(standing)) height += box.width;

  return {
    length: Math.max(DECK_LENGTH_IN, ...boxes.map((box) => box.length)),
    width,
    height: height + DECK_HEIGHT_IN,
    weightLbs: boxes.reduce((sum, box) => sum + box.weight, 0) + DECK_WEIGHT_LBS,
    boxes: boxes.length,
    perLevel,
    levels,
    flat,
    unmeasured: boxes.filter((box) => !box.measured).length,
  };
}

/* ------------------------------------------------------------------ *
 * Lo que el operador teclea, y cómo convive con lo calculado
 * ------------------------------------------------------------------ */

/**
 * Una medida guardada, tal como vive en `picking_lists.pallet_dims`.
 *
 * Los tres ejes son `null` cuando **nadie los tecleó** — nunca cero: un cero
 * guardado es una medida, y una medida de cero llega al portal del carrier.
 * Por eso tampoco se guarda de dónde salió el número: se deriva de qué ejes
 * están en `null` ({@link dimensionSource}). Una bandera guardada junto a los
 * valores que la determinan es un segundo dueño del mismo hecho, y se
 * desincroniza — la lección de `sku_not_found` (bug-020).
 */
export interface PalletDimsEntry {
  /** Ordinal del pallet dentro del carrito, 1-based — el mismo `pallet.id`. */
  pallet: number;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  /** Unidades que tenía el pallet al teclear: la huella de vigencia. */
  units: number;
  measured_by?: string | null;
  measured_at?: string | null;
}

/** De dónde sale la medida que se está mostrando. */
export type DimensionSource = 'manual' | 'partial' | 'computed';

/** Lo más chico y lo más grande que se acepta teclear, en pulgadas. */
export const DIM_MIN_IN = 1;
/**
 * 130" es el largo+contorno que FedEx ya cobra aparte (idea-214) y ningún bulto
 * de este almacén se acerca. El tope está para atrapar el decimal perdido — el
 * `8.75` tecleado `875` que ya pasó con `03-4046MN` —, no para poner un límite
 * al almacén.
 */
export const DIM_MAX_IN = 130;

/**
 * Lo tecleado, convertido a pulgadas. `null` cuando el campo está vacío o
 * cuando lo escrito no es un número utilizable: vacío significa «nadie midió»,
 * que es un hecho que hay que poder guardar.
 */
export function sanitizeInches(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '') return null;
  // Un solo punto decimal; el resto de caracteres se cae.
  const cleaned = text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
  if (cleaned === '' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  if (value < DIM_MIN_IN || value > DIM_MAX_IN) return null;
  return value;
}

/** Los ejes que alguien tecleó de verdad. */
const typedAxes = (entry: PalletDimsEntry | null | undefined): number =>
  entry ? [entry.length_in, entry.width_in, entry.height_in].filter((v) => v != null).length : 0;

/**
 * `manual` con los tres tecleados, `partial` con uno o dos, `computed` sin
 * ninguno. Parcial es válido y se guarda: quien midió sólo el alto hizo trabajo
 * real, y los ejes que faltan salen de la estimación.
 */
export function dimensionSource(entry: PalletDimsEntry | null | undefined): DimensionSource {
  const typed = typedAxes(entry);
  if (typed === 3) return 'manual';
  return typed === 0 ? 'computed' : 'partial';
}

/**
 * Si la medida se tomó sobre un pallet que ya no es éste. No borra nada: la
 * pantalla la pinta en ámbar diciendo con cuántas unidades se midió. Lo que no
 * cuadra se lista, nunca se esconde.
 */
export function isStale(entry: PalletDimsEntry | null | undefined, currentUnits: number): boolean {
  if (!entry || typedAxes(entry) === 0) return false;
  return entry.units !== currentUnits;
}

export interface EffectivePalletSize extends PalletSize {
  source: DimensionSource;
  stale: boolean;
}

/**
 * La medida que se declara: lo tecleado manda, y lo que falte lo pone la
 * estimación. `null` sólo cuando no hay ni lo uno ni lo otro.
 */
export function effectivePalletSize(
  entry: PalletDimsEntry | null | undefined,
  estimate: PalletEstimate | null,
  currentUnits: number
): EffectivePalletSize | null {
  const length = entry?.length_in ?? estimate?.length ?? null;
  const width = entry?.width_in ?? estimate?.width ?? null;
  const height = entry?.height_in ?? estimate?.height ?? null;
  if (length == null || width == null || height == null) return null;
  return {
    length,
    width,
    height,
    source: dimensionSource(entry),
    stale: isStale(entry, currentUnits),
  };
}

/**
 * `55×43×83` — pulgadas enteras redondeadas **hacia arriba**, igual que
 * `formatCartonDims` y que el export a FSM: un bulto nunca se declara más chico
 * de lo que es, porque eso es lo que el carrier refactura.
 */
export function formatPalletSize(size: PalletSize): string {
  return `${Math.ceil(size.length)}×${Math.ceil(size.width)}×${Math.ceil(size.height)}`;
}

/** El mismo tamaño para pegar en un portal ajeno: `x` ASCII, nunca `×`. */
export function palletSizeForClipboard(size: PalletSize): string {
  return formatPalletSize(size).replace(/×/g, 'x');
}
