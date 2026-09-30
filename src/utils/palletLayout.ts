/**
 * Cómo se arma una tarima —y, por eso, qué medidas tiene—, con gravedad.
 *
 * Rafael, 29 sep 2026: «quiero una manera fácil de modificar o, si es posible,
 * automatizar completamente que salgan las medidas más óptimas para una
 * pallet», opción B: PickD no adivina cómo armó el piso, **le dice cómo
 * armarla**, y la medida sale de esa instrucción.
 *
 * ## Por qué gravedad y no niveles (29 sep 2026, tarde)
 *
 * La primera versión apilaba por niveles planos: cada nivel medía lo que su
 * caja más alta, y el de encima se apoyaba en ese plano. Con alturas mezcladas
 * eso es física imposible —Rafael: «no tiene lógica que las cajas estén
 * flotando en un nivel, no podemos jugar con la física»—: en la 4.ª de
 * #881774/#881761 las LASER (22") quedaban bajo un hueco de 12" y las de
 * encima en el aire. El piso hizo otra cosa, y las fotos lo dicen: abajo
 * TRAIL XR + FAULTLINE A2 + DEFCON E2 de canto y, en la esquina, **LASER una
 * encima de otra en columna**; encima, el resto de LASER apoyadas en lo que
 * tuvieran debajo, alguna ladeada. 5 + 3 × 22 = 71", lo que midió la cinta.
 *
 * Así que esto es un empaque en 2D por **skyline** en el corte transversal de
 * la tarima (ancho × alto; el largo de cada caja corre a lo largo de la madera
 * y no se apila): cada caja cae hasta tocar lo más alto que haya bajo su ancho,
 * y se pone donde quede más baja. Las cortas acaban en columna junto a las
 * altas, como en el piso.
 *
 * - Orden: **las más altas primero** (y, a igual alto, las más anchas): abajo
 *   va lo que aguanta.
 * - **Ancho de la carga** = lo que suman las {@link boxesPerLevel} cajas más
 *   anchas (4 hasta 10 cajas, 5 desde 11; 5 en una tarima sólo de niño). Es la
 *   regla de Rafael —5 de canto «sólo cuando nos ahorramos una tarima extra por
 *   hacer una de 12, no de 10»— dicha como ancho, que es lo que la gravedad
 *   entiende. Nunca más de {@link LEVEL_WIDTH_MAX_IN}.
 * - **Acostadas:** sólo las dos últimas pueden ir de plano (su lado delgado
 *   hacia arriba), y sólo si así quedan más bajas: la 5.ª CITIZEN de #881741
 *   (4 de canto + 1 acostada = 44").
 * - **Ladeadas:** una caja cuyo centro no cae sobre su apoyo se inclina hacia
 *   el lado sin apoyo, hasta {@link MAX_TILT_RAD}, y lo ladeado **suma alto**
 *   (Rafael: «van aseguradas con film y con tape, pero eso incrementa la altura
 *   de la pallet»).
 * - Nunca más de {@link MAX_PALLET_HEIGHT_IN} con la madera; si no cabe, se
 *   dice (`overHeight`).
 *
 * Puro y determinista. No reparte bicis entre tarimas —eso es `planPallets`—:
 * mide una tarima que ya tiene su carga.
 */
import {
  boxesPerLevel,
  DECK_HEIGHT_IN,
  DECK_LENGTH_IN,
  DECK_WEIGHT_LBS,
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
 * Lo más ancho que puede quedar la carga, en pulgadas. ❓ Sale de lo medido
 * (46" en #881735 con 11 bicis, 44" en la mixta de #881761); 48" solo se ha
 * visto en una tarima de niño (#881677).
 */
export const LEVEL_WIDTH_MAX_IN = 46;

/** Lo más que se ladea una caja mal apoyada: el film y la cinta no dejan más. */
export const MAX_TILT_RAD = (7 * Math.PI) / 180;

/** Dos apoyos a menos de esto son el mismo: el cartón cede. */
const SUPPORT_TOLERANCE_IN = 0.5;

/** Una caja ya puesta en el corte transversal (x a lo ancho, y hacia arriba). */
export interface Placement {
  box: Box;
  /** Borde izquierdo y base, en pulgadas, con la carga empezando en `x = 0`. */
  x: number;
  y: number;
  /** Lo que ocupa a lo ancho y a lo alto antes de ladearse. */
  w: number;
  h: number;
  flat: boolean;
  /** Cuántas cajas tiene debajo en su columna: 0 = sobre la madera. */
  level: number;
  /** Inclinación en radianes, positiva hacia la izquierda, y el borde sobre el que gira. */
  tilt: number;
  pivot: number;
  /** Lo más alto que llega, ya ladeada. */
  top: number;
  order: number;
}

export interface PalletLayout {
  placements: Placement[];
  /** Las mismas cajas agrupadas por nivel, de abajo arriba (sin las acostadas). */
  levels: Box[][];
  /** Las acostadas. */
  flat: Box[];
  /** Tope de cajas por fila con el que se armó: 4 ó 5. */
  perLevel: number;
  length: number;
  /** Ya con el abombado cuando pasa de la madera ({@link withBulge}). */
  width: number;
  height: number;
  weightLbs: number;
  boxes: number;
  unmeasured: number;
  /** No cabe en 90": hay que partir la tarima. */
  overHeight: boolean;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** El perfil de lo ya apilado: tramos de x con su alto y su nivel. */
interface Segment {
  x0: number;
  x1: number;
  y: number;
  level: number;
}

const under = (sky: Segment[], x0: number, x1: number) =>
  sky.filter((s) => s.x1 > x0 + 1e-6 && s.x0 < x1 - 1e-6);

/** Dónde queda una caja de ancho `w` puesta en `x`: base, apoyo y cuánto se ladea. */
function drop(sky: Segment[], x: number, w: number, h: number) {
  const segs = under(sky, x, x + w);
  const base = Math.max(...segs.map((s) => s.y));
  const level = Math.max(...segs.filter((s) => s.y >= base - 1e-6).map((s) => s.level)) + 1;
  const support = segs
    .filter((s) => s.y >= base - SUPPORT_TOLERANCE_IN)
    .map((s) => [Math.max(s.x0, x), Math.min(s.x1, x + w)] as const);
  const supported = sum(support.map(([a, b]) => b - a)) / w;
  const cx = x + w / 2;
  const left = Math.min(...support.map(([a]) => a));
  const right = Math.max(...support.map(([, b]) => b));
  let tilt = 0;
  let pivot = cx;
  if (cx < left - 1e-6 || cx > right + 1e-6) {
    // El centro cae fuera del apoyo: vuelca hacia el lado sin apoyo, girando
    // sobre el borde del apoyo, hasta tocar lo que haya debajo de ese lado.
    const towardLeft = cx < left;
    pivot = towardLeft ? left : right;
    const free = towardLeft ? under(sky, x, pivot) : under(sky, pivot, x + w);
    const lower = Math.max(...free.map((s) => s.y));
    const reach = towardLeft ? pivot - x : x + w - pivot;
    tilt = Math.min(MAX_TILT_RAD, Math.atan2(Math.max(0, base - lower), reach));
    if (!towardLeft) tilt = -tilt;
  }
  // Lo más alto de la caja ladeada: sus dos esquinas de arriba giradas sobre el pivote.
  const corner = (dx: number) => dx * Math.sin(tilt) + h * Math.cos(tilt);
  const top = base + Math.max(corner(x - pivot), corner(x + w - pivot));
  return { base, level, supported, tilt, pivot, top };
}

function place(sky: Segment[], x: number, w: number, top: number, level: number): Segment[] {
  const out: Segment[] = [];
  for (const s of sky) {
    if (s.x1 <= x + 1e-6 || s.x0 >= x + w - 1e-6) {
      out.push(s);
      continue;
    }
    if (s.x0 < x) out.push({ ...s, x1: x });
    if (s.x1 > x + w) out.push({ ...s, x0: x + w });
  }
  out.push({ x0: x, x1: x + w, y: top, level });
  return out.sort((a, b) => a.x0 - b.x0);
}

/** Las posiciones que vale la pena probar: pegada a la izquierda o a la derecha de cada tramo. */
function candidates(sky: Segment[], w: number, from: number, to: number, width: number): number[] {
  // Los bordes de la carga siempre: salirse de ellos es la excepción, no el punto de partida.
  const xs = new Set<number>([0, width - w]);
  for (const s of sky) {
    xs.add(s.x0);
    xs.add(s.x1 - w);
  }
  return [...xs].filter((x) => x >= from - 1e-6 && x + w <= to + 1e-6).sort((a, b) => a - b);
}

/** Cuánto puede salirse una caja de pie del ancho de la carga, por un lado u otro. */
export const OVERHANG_IN = 3;

/** Dos alturas a menos de esto valen lo mismo: entonces manda que el nivel quede junto. */
const HEIGHT_TIE_IN = 1.25;

type Pick = ReturnType<typeof drop> & { x: number; w: number; h: number };

/**
 * Una forma de armar: las de pie por gravedad, las más altas primero, y las
 * `flat` acostadas al final, encima de todo. `null` si alguna no tiene sitio
 * sin romper una regla.
 */
function pack(
  standing: Box[],
  flat: Box[],
  width: number,
  perLevel: number,
  isKid: (b: Box) => boolean
): Placement[] | null {
  const maxExtent = Math.min(LEVEL_WIDTH_MAX_IN, width + OVERHANG_IN) + 0.01;
  let sky: Segment[] = [
    { x0: -OVERHANG_IN, x1: width + OVERHANG_IN, y: DECK_HEIGHT_IN, level: -1 },
  ];
  const placements: Placement[] = [];
  const perRow = new Map<number, Box[]>();
  let minX = Infinity;
  let maxX = -Infinity;
  const sequence = [
    ...standing.map((box) => ({ box, w: box.width, h: box.height, flat: false })),
    ...flat.map((box) => ({ box, w: box.height, h: box.width, flat: true })),
  ];
  for (const [i, item] of sequence.entries()) {
    let best: Pick | null = null;
    let bestTouch = -1;
    for (const x of candidates(sky, item.w, -OVERHANG_IN, width + OVERHANG_IN, width)) {
      // Nunca más ancha que el ancho de la carga más 3" por un lado, ni que 46".
      if (Math.max(maxX, x + item.w) - Math.min(minX, x) > maxExtent) continue;
      const d = drop(sky, x, item.w, item.h);
      // Una acostada va encima bien apoyada: nunca ladeada sobre un hueco.
      if (item.flat && d.tilt !== 0) continue;
      if (!item.flat) {
        // 4 por nivel (5 desde 11 cajas); una fila sólo de niño lleva 5.
        const row = [...(perRow.get(d.level) ?? []), item.box];
        const cap = row.every(isKid) ? Math.max(perLevel, KIDS_PER_LAYER) : perLevel;
        if (row.length > cap) continue;
      }
      // Cuánto toca a sus vecinas o al borde: un nivel se arma junto, sin huecos sueltos.
      const touch =
        (placements.some((p) => Math.abs(p.x + p.w - x) < 1e-6 && p.level === d.level) ||
        Math.abs(x) < 1e-6
          ? 1
          : 0) +
        (placements.some((p) => Math.abs(p.x - (x + item.w)) < 1e-6 && p.level === d.level)
          ? 1
          : 0);
      const better =
        !best ||
        d.top < best.top - HEIGHT_TIE_IN ||
        (d.top <= best.top + HEIGHT_TIE_IN &&
          (touch > bestTouch ||
            (touch === bestTouch &&
              (d.supported > best.supported + 1e-6 ||
                (Math.abs(d.supported - best.supported) <= 1e-6 && d.top < best.top - 1e-6)))));
      if (better) {
        best = { ...d, x, w: item.w, h: item.h };
        bestTouch = touch;
      }
    }
    if (!best) return null;
    if (!item.flat) perRow.set(best.level, [...(perRow.get(best.level) ?? []), item.box]);
    minX = Math.min(minX, best.x);
    maxX = Math.max(maxX, best.x + best.w);
    placements.push({
      box: item.box,
      x: best.x,
      y: best.base,
      w: best.w,
      h: best.h,
      flat: item.flat,
      level: best.level,
      tilt: best.tilt,
      pivot: best.pivot,
      top: best.top,
      order: i,
    });
    sky = place(sky, best.x, best.w, best.top, best.level);
  }
  return placements;
}

export function layoutPallet(
  lines: readonly PalletLine[],
  metaFor: (sku: string) => PalletBoxMeta | undefined,
  /** Qué SKUs son de niño: una tarima sólo de niño lleva 5 por fila. */
  isKidSku: (sku: string) => boolean = () => false
): PalletLayout | null {
  const boxes = expandBoxes(lines, metaFor);
  // Un bulto de sólo eléctricas no es un bulto: cada una es su propio cartón.
  if (boxes.length === 0 || boxes.every((b) => b.electric)) return null;

  const allKids = boxes.every((b) => isKidSku(b.sku));
  const perLevel = allKids ? KIDS_PER_LAYER : boxesPerLevel(boxes.length);
  const isKid = (b: Box) => isKidSku(b.sku);
  const order = [...boxes].sort((a, b) => b.height - a.height || b.width - a.width);
  const widest = [...boxes].sort((a, b) => b.width - a.width).slice(0, perLevel);
  const width = Math.min(LEVEL_WIDTH_MAX_IN, sum(widest.map((b) => b.width)));

  // Quién va acostada: ninguna, una o dos, entre las más delgadas —lo acostado
  // suma su grueso al alto, así que un triciclo de 14" acostado es la peor
  // elección aunque sea la caja más baja (#881761, tarima 2)—. Gana la tarima
  // más baja; a igual alto, la más angosta y con menos acostadas.
  const thin = [...order].sort((a, b) => a.width - b.width || a.height - b.height).slice(0, 5);
  const choices: Box[][] = [[]];
  for (let i = 0; i < thin.length; i += 1) {
    choices.push([thin[i]]);
    for (let j = i + 1; j < thin.length; j += 1) choices.push([thin[i], thin[j]]);
  }
  let best: { placements: Placement[]; height: number; used: number; flat: number } | null = null;
  for (const flat of choices) {
    if (flat.length > MAX_FLAT_BOXES || flat.length >= boxes.length) continue;
    const placements = pack(
      order.filter((b) => !flat.includes(b)),
      [...flat].sort((a, b) => b.height - a.height),
      width,
      perLevel,
      isKid
    );
    if (!placements) continue;
    const height = Math.max(...placements.map((p) => p.top));
    const used =
      Math.max(...placements.map((p) => p.x + p.w)) - Math.min(...placements.map((p) => p.x));
    const over = (h: number) => (h > MAX_PALLET_HEIGHT_IN + 1e-6 ? 1 : 0);
    const better =
      !best ||
      over(height) < over(best.height) ||
      (over(height) === over(best.height) &&
        (height < best.height - 0.25 ||
          (Math.abs(height - best.height) <= 0.25 &&
            (used < best.used - 0.25 ||
              (Math.abs(used - best.used) <= 0.25 && flat.length < best.flat)))));
    if (better) best = { placements, height, used, flat: flat.length };
  }
  if (!best) return null;

  const { placements, height, used } = best;
  const levels: Box[][] = [];
  for (const p of placements) {
    if (p.flat) continue;
    (levels[p.level] ??= []).push(p.box);
  }
  return {
    placements,
    levels: levels.filter(Boolean),
    flat: placements.filter((p) => p.flat).map((p) => p.box),
    perLevel,
    length: Math.max(DECK_LENGTH_IN, ...boxes.map((b) => b.length)),
    width: withBulge(Math.max(40, used)),
    height,
    weightLbs: sum(boxes.map((b) => (b.electric ? 0 : b.weight))) + DECK_WEIGHT_LBS,
    boxes: boxes.length,
    unmeasured: boxes.filter((b) => !b.measured).length,
    overHeight: height > MAX_PALLET_HEIGHT_IN + 1e-6,
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
export function describeLayout(layout: PalletLayout): {
  levels: LayoutRow[][];
  flat: LayoutRow[];
} {
  return { levels: layout.levels.map(toRows), flat: toRows(layout.flat) };
}

/**
 * La medida de una tarima **es** la de su armado: lo que enseñan en gris Double
 * Check y la tabla de Ship, y lo que dibuja el 3D. Sustituye a
 * `estimatePallet` / `estimateKidsPallet` en las pantallas.
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
  /** Centro de la caja, ya ladeada. */
  x: number;
  y: number;
  z: number;
  /** Lo que ocupa en cada eje, sin ladear. */
  sx: number;
  sy: number;
  sz: number;
  /** Giro sobre el eje largo (z), en radianes, positivo hacia la izquierda. */
  tilt: number;
  /** Cuántas tiene debajo en su columna (0 = sobre la madera); `null` si va acostada. */
  level: number | null;
  /** Orden de armado, 0 = la primera que se pone. */
  order: number;
  /** Medidas de la caja tal como la conoce el catálogo: largo × ancho × alto. */
  box: { length: number; width: number; height: number };
  electric: boolean;
  measured: boolean;
}

/**
 * Dónde queda cada caja. A lo ancho, la carga centrada sobre la madera. A lo
 * largo, **el frente parejo** (Rafael, 29 sep 2026: «la parte de adelante de una
 * pallet debe quedar pareja, todas las cajas a la misma altura; todos los otros
 * lados no importan»): cada caja apoya su punta en el mismo plano, `+z`, donde
 * van las etiquetas, y la más larga queda centrada sobre la madera. Atrás, lo
 * que salga.
 */
export function placeBoxes(layout: PalletLayout): PlacedBox[] {
  const ps = layout.placements;
  const minX = Math.min(...ps.map((p) => p.x));
  const maxX = Math.max(...ps.map((p) => p.x + p.w));
  const shift = -(minX + maxX) / 2;
  const front = Math.max(...ps.map((p) => p.box.length)) / 2;
  return ps.map((p) => {
    // El centro, girado sobre el pivote (el borde del apoyo, en la base).
    const dx = p.x + p.w / 2 - p.pivot;
    const dy = p.h / 2;
    const cx = p.pivot + dx * Math.cos(p.tilt) - dy * Math.sin(p.tilt);
    const cy = p.y + dx * Math.sin(p.tilt) + dy * Math.cos(p.tilt);
    return {
      sku: p.box.sku,
      x: cx + shift,
      y: cy,
      z: front - p.box.length / 2,
      sx: p.w,
      sy: p.h,
      sz: p.box.length,
      tilt: p.tilt,
      level: p.flat ? null : p.level,
      order: p.order,
      box: { length: p.box.length, width: p.box.width, height: p.box.height },
      electric: p.box.electric,
      measured: p.box.measured,
    };
  });
}
