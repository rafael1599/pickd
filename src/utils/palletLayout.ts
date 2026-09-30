/**
 * Cómo armar una tarima para que salga lo más chica posible — y, por eso, qué
 * medidas tiene.
 *
 * Rafael, 29 sep 2026: «quiero una manera fácil de modificar o, si es posible,
 * automatizar completamente que salgan las medidas más óptimas para una
 * pallet», opción B: PickD no adivina cómo armó el piso, **le dice cómo
 * armarla**, y la medida sale de esa instrucción. Hasta ahora había dos reglas
 * fijas —la de grandes (`estimatePallet`, 4 ó 5 de canto por nivel) y la de
 * niño (`stackKids`, capas de 5)— y una tarima mixta caía en la de grandes: la
 * 4.ª de #881774/#881761 (7 de niño + 3 grandes) se estimó 55.75 × 40 × 77 y el
 * piso la armó 57 × 44 × 71.
 *
 * Una sola regla para grandes, de niño y mixtas; lo que se elige es cuántas se
 * acuestan, y gana el menor volumen.
 *
 * - Las cajas van de canto, **las más altas abajo** (y, a igual alto, las más
 *   anchas): es lo que ya pedía la regla de niño y lo que aguanta el peso.
 * - **Cuántas por nivel** (Rafael, 29 sep 2026: 5 de canto «sólo cuando nos
 *   ahorramos una tarima extra por hacer una de 12 bicicletas, no de 10»):
 *   4 hasta 10 cajas y 5 desde 11 ({@link boxesPerLevel}, la costumbre del
 *   piso); una capa **sólo de niño** lleva 5 siempre (#881677). Un nivel que
 *   mezcla grandes y niño cuenta como de grandes.
 * - Ningún nivel pasa de {@link LEVEL_WIDTH_MAX_IN} de ancho: el piso sí
 *   sobresale de la madera (40) —46" medidos en #881735— pero no más; con cajas
 *   de 11" caben menos.
 * - Hasta {@link MAX_FLAT_BOXES} acostadas encima, las más delgadas: suman al
 *   alto su lado delgado. Es lo que hizo el piso con la 5.ª CITIZEN de #881741
 *   (4 de canto + 1 acostada = 44"), donde la regla vieja abría un segundo
 *   nivel (66").
 * - Nunca más de {@link MAX_PALLET_HEIGHT_IN} con la madera.
 *
 * Puro y determinista. No reparte bicis entre tarimas —eso es `planPallets`—:
 * mide una tarima que ya tiene su carga.
 */
import {
  DECK_HEIGHT_IN,
  DECK_LENGTH_IN,
  DECK_WEIGHT_LBS,
  DECK_WIDTH_IN,
  boxesPerLevel,
  expandBoxes,
  KIDS_PER_LAYER,
  MAX_FLAT_BOXES,
  MAX_PALLET_HEIGHT_IN,
  withBulge,
  type Box,
  type PalletBoxMeta,
  type PalletEstimate,
  type PalletLine,
} from './palletDims';

/**
 * Lo más ancho que puede quedar un nivel de canto, en pulgadas. ❓ Sale de lo
 * medido (46" en #881735 con 11 bicis, 44" en la mixta de #881761); 48" solo
 * se ha visto en una tarima de niño (#881677). Si el piso acepta más, sube y
 * los niveles de 5 dejan de descartarse.
 */
export const LEVEL_WIDTH_MAX_IN = 46;

export interface PalletLayout {
  /** Los niveles de canto, de abajo arriba. */
  levels: Box[][];
  /** Las acostadas encima del último nivel. */
  flat: Box[];
  /** Tope de cajas por nivel de grandes con el que se armó: 4 ó 5. */
  perLevel: number;
  length: number;
  /** Ya con el abombado cuando pasa de la madera ({@link withBulge}). */
  width: number;
  height: number;
  weightLbs: number;
  boxes: number;
  unmeasured: number;
  /** Ninguna forma cabe en 90": ésta es la más baja, y hay que partir la tarima. */
  overHeight: boolean;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Alto de cada nivel = la caja más alta; ancho = lo que suman lado a lado. */
function measure(levels: Box[][], flat: Box[], all: Box[]) {
  const levelWidth = Math.max(0, ...levels.map((l) => sum(l.map((b) => b.width))));
  const height =
    DECK_HEIGHT_IN +
    sum(levels.map((l) => Math.max(...l.map((b) => b.height)))) +
    sum(flat.map((b) => b.width));
  const width = withBulge(Math.max(DECK_WIDTH_IN, levelWidth));
  const length = Math.max(DECK_LENGTH_IN, ...all.map((b) => b.length));
  return { levelWidth, height, width, length, volume: length * width * height };
}

/**
 * Llena los niveles de abajo arriba, en el orden dado: una caja sube al nivel
 * siguiente cuando el actual ya tiene su tope o se pasaría de ancho.
 */
function stack(standing: Box[], bigCap: number, isKid: (b: Box) => boolean): Box[][] {
  const levels: Box[][] = [];
  let level: Box[] = [];
  let width = 0;
  for (const b of standing) {
    const next = [...level, b];
    const cap = next.every(isKid) ? KIDS_PER_LAYER : bigCap;
    if (level.length > 0 && (next.length > cap || width + b.width > LEVEL_WIDTH_MAX_IN)) {
      levels.push(level);
      level = [b];
      width = b.width;
    } else {
      level = next;
      width += b.width;
    }
  }
  if (level.length > 0) levels.push(level);
  return levels;
}

export function layoutPallet(
  lines: readonly PalletLine[],
  metaFor: (sku: string) => PalletBoxMeta | undefined,
  /** Qué SKUs son de niño: sus capas llevan 5. Sin esto, todo cuenta como grande. */
  isKidSku: (sku: string) => boolean = () => false
): PalletLayout | null {
  const boxes = expandBoxes(lines, metaFor);
  // Un bulto de sólo eléctricas no es un bulto: cada una es su propio cartón.
  if (boxes.length === 0 || boxes.every((b) => b.electric)) return null;

  const tallFirst = [...boxes].sort((a, b) => b.height - a.height || b.width - a.width);
  // Las que se acuestan: las más delgadas, y entre ellas las más bajas.
  const thinFirst = [...tallFirst].sort((a, b) => a.width - b.width || a.height - b.height);

  type Candidate = ReturnType<typeof measure> & { levels: Box[][]; flat: Box[]; perLevel: number };
  let best: Candidate | null = null;
  let lowest: Candidate | null = null;
  const better = (c: Candidate, than: Candidate | null) =>
    !than ||
    c.volume < than.volume - 1e-6 ||
    (Math.abs(c.volume - than.volume) <= 1e-6 &&
      (c.height < than.height || (c.height === than.height && c.flat.length < than.flat.length)));

  const bigCap = boxesPerLevel(boxes.length);
  const isKid = (b: Box) => isKidSku(b.sku);
  for (let f = 0; f <= Math.min(MAX_FLAT_BOXES, boxes.length - 1); f += 1) {
    const flat = thinFirst.slice(0, f);
    const standing = tallFirst.filter((b) => !flat.includes(b));
    const levels = stack(standing, bigCap, isKid);
    const c: Candidate = { ...measure(levels, flat, boxes), levels, flat, perLevel: bigCap };
    if (!lowest || c.height < lowest.height) lowest = c;
    if (c.height <= MAX_PALLET_HEIGHT_IN && better(c, best)) best = c;
  }

  const pick = best ?? lowest!;
  return {
    levels: pick.levels,
    flat: pick.flat,
    perLevel: pick.perLevel,
    length: pick.length,
    width: pick.width,
    height: pick.height,
    weightLbs: sum(boxes.map((b) => (b.electric ? 0 : b.weight))) + DECK_WEIGHT_LBS,
    boxes: boxes.length,
    unmeasured: boxes.filter((b) => !b.measured).length,
    overHeight: best == null,
  };
}

/** Un nivel dicho para el piso: qué SKU y cuántas, en el orden de la tarima. */
export interface LayoutRow {
  sku: string;
  qty: number;
}

const toRows = (boxes: Box[]): LayoutRow[] => {
  const rows: LayoutRow[] = [];
  for (const b of boxes) {
    const last = rows[rows.length - 1];
    if (last && last.sku === b.sku) last.qty += 1;
    else rows.push({ sku: b.sku, qty: 1 });
  }
  return rows;
};

/** La instrucción: nivel por nivel de abajo arriba, y lo que va acostado. */
export function describeLayout(layout: PalletLayout): { levels: LayoutRow[][]; flat: LayoutRow[] } {
  return { levels: layout.levels.map(toRows), flat: toRows(layout.flat) };
}

/**
 * La medida de una tarima **es** la de su armado: lo que enseñan en gris Double
 * Check y la tabla de Ship, más la instrucción para el piso. Sustituye a
 * `estimatePallet` / `estimateKidsPallet` en las pantallas: con las 19 tarimas
 * medidas con cinta hasta el 29 sep 2026 el error medio de alto bajó de 4.4" a
 * 3.1" (14 de 19 a ±3", antes 12), y la mixta de #881761 de 77" a 69" (el piso
 * midió 71).
 */
export function estimateLayout(
  lines: readonly PalletLine[],
  metaFor: (sku: string) => PalletBoxMeta | undefined,
  isKidSku: (sku: string) => boolean = () => false
): (PalletEstimate & { layout: PalletLayout }) | null {
  const layout = layoutPallet(lines, metaFor, isKidSku);
  if (!layout) return null;
  return {
    length: layout.length,
    width: layout.width,
    height: layout.height,
    weightLbs: layout.weightLbs,
    boxes: layout.boxes,
    bikes: layout.boxes,
    perLevel: layout.perLevel,
    levels: layout.levels.length,
    flat: layout.flat.length,
    unmeasured: layout.unmeasured,
    layout,
  };
}

/**
 * Una caja colocada en la tarima, en pulgadas, para dibujarla (el 3D de Ship).
 * Ejes: `x` a lo ancho (los 40" de la madera), `y` hacia arriba desde el piso,
 * `z` a lo largo (los 48"). El centro de la madera es `x = z = 0`.
 */
export interface PlacedBox {
  sku: string;
  /** Centro de la caja. */
  x: number;
  y: number;
  z: number;
  /** Lo que ocupa en cada eje. */
  sx: number;
  sy: number;
  sz: number;
  /** Nivel de canto, 0 = abajo; `null` si va acostada encima. */
  level: number | null;
  /** Orden de armado, 0 = la primera que se pone. */
  order: number;
  /** Medidas de la caja tal como la conoce el catálogo: largo × ancho × alto. */
  box: { length: number; width: number; height: number };
  electric: boolean;
  measured: boolean;
}

/**
 * Dónde queda cada caja del armado. De canto: su lado delgado a lo ancho, su
 * alto hacia arriba y su largo a lo largo, una junto a otra y centradas sobre la
 * madera (lo que pasa de 40" sobresale igual por los dos lados). Acostadas: el
 * lado delgado hacia arriba, una encima de otra — que es lo que suma
 * `layoutPallet` al alto.
 */
export function placeBoxes(layout: PalletLayout): PlacedBox[] {
  const out: PlacedBox[] = [];
  let y = DECK_HEIGHT_IN;
  let order = 0;
  const base = (b: Box) => ({
    sku: b.sku,
    box: { length: b.length, width: b.width, height: b.height },
    electric: b.electric,
    measured: b.measured,
  });
  layout.levels.forEach((level, index) => {
    const total = sum(level.map((b) => b.width));
    const tallest = Math.max(...level.map((b) => b.height));
    let x = -total / 2;
    for (const b of level) {
      out.push({
        ...base(b),
        x: x + b.width / 2,
        y: y + b.height / 2,
        z: 0,
        sx: b.width,
        sy: b.height,
        sz: b.length,
        level: index,
        order: order++,
      });
      x += b.width;
    }
    y += tallest;
  });
  for (const b of layout.flat) {
    out.push({
      ...base(b),
      x: 0,
      y: y + b.width / 2,
      z: 0,
      sx: b.height,
      sy: b.width,
      sz: b.length,
      level: null,
      order: order++,
    });
    y += b.width;
  }
  return out;
}
