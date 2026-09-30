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
 * Aquí no hay regla por tipo de bici: se prueban **todas** las formas válidas
 * y gana la de menor volumen.
 *
 * - Las cajas van de canto, **las más altas abajo** (y, a igual alto, las más
 *   anchas): es lo que ya pedía la regla de niño y lo que aguanta el peso.
 * - Cada nivel lleva `perLevel` cajas y no puede pasar de
 *   {@link LEVEL_WIDTH_MAX_IN} de ancho: el piso sí sobresale de la madera (40)
 *   —46" medidos en #881735— pero no más.
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
  expandBoxes,
  MAX_FLAT_BOXES,
  MAX_PALLET_HEIGHT_IN,
  withBulge,
  type Box,
  type PalletBoxMeta,
  type PalletLine,
} from './palletDims';

/**
 * Lo más ancho que puede quedar un nivel de canto, en pulgadas. ❓ Sale de lo
 * medido (46" en #881735 con 11 bicis, 44" en la mixta de #881761); 48" solo
 * se ha visto en una tarima de niño (#881677). Si el piso acepta más, sube y
 * los niveles de 5 dejan de descartarse.
 */
export const LEVEL_WIDTH_MAX_IN = 46;

/** Cuántas cajas de canto se prueban por nivel. */
const PER_LEVEL_MIN = 2;
const PER_LEVEL_MAX = 7;

export interface PalletLayout {
  /** Los niveles de canto, de abajo arriba. */
  levels: Box[][];
  /** Las acostadas encima del último nivel. */
  flat: Box[];
  /** Cajas por nivel con las que se armó (el último puede llevar menos). */
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

export function layoutPallet(
  lines: readonly PalletLine[],
  metaFor: (sku: string) => PalletBoxMeta | undefined
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

  for (let f = 0; f <= Math.min(MAX_FLAT_BOXES, boxes.length - 1); f += 1) {
    const flat = thinFirst.slice(0, f);
    const standing = tallFirst.filter((b) => !flat.includes(b));
    for (let p = PER_LEVEL_MIN; p <= PER_LEVEL_MAX; p += 1) {
      const levels: Box[][] = [];
      for (let i = 0; i < standing.length; i += p) levels.push(standing.slice(i, i + p));
      const m = measure(levels, flat, boxes);
      if (m.levelWidth > LEVEL_WIDTH_MAX_IN && p > PER_LEVEL_MIN) continue;
      const c: Candidate = { ...m, levels, flat, perLevel: p };
      if (!lowest || c.height < lowest.height) lowest = c;
      if (m.height <= MAX_PALLET_HEIGHT_IN && better(c, best)) best = c;
    }
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
