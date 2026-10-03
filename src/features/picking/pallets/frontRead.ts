/**
 * Lo que dice una foto del frente de una tarima: qué caja está en qué nivel, en
 * qué orden de izquierda a derecha y si va de pie o acostada (idea-245, F1;
 * `docs/prds/pallet-box-inference.md` §6.3).
 *
 * Entra lo que la sombra ya guarda de cada etiqueta —su SKU y sus 4 esquinas en
 * píxeles de la foto original, en orden de lectura de la etiqueta enderezada
 * (arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda)—. No toca
 * el lector, que sigue congelado: sólo lee lo que dejó.
 *
 * Tres hechos del piso lo hacen posible:
 *
 * - **Todas las etiquetas están en un mismo plano**: el frente queda parejo
 *   (Rafael, 29 sep 2026), las puntas de todas las cajas a la misma altura.
 * - **La etiqueta enderezada es vertical**, más alta que ancha. Si en la foto su
 *   borde de arriba va horizontal, la etiqueta está derecha y la caja **de
 *   pie**; si va vertical, la etiqueta está tumbada y la caja **acostada**. En
 *   las 243 etiquetas con esquinas al 3 oct, 224 derechas y 19 tumbadas: una o
 *   dos acostadas por tarima.
 * - **El lado corto de la etiqueta mide {@link LABEL_SHORT_IN}"**. Medido sin
 *   cinta, con las fotos: entre dos cajas de pie vecinas las etiquetas quedan
 *   separadas por el grueso de las dos cajas (`width_in`, sólo las medidas),
 *   86 parejas, mediana 3,6", la mitad central entre 3,3" y 3,9". El lado largo
 *   no sale con un solo valor (8,8" y 5,6–6,8", dos formatos), y no hace falta:
 *   con el corto basta para pasar de píxeles a pulgadas.
 *
 * La perspectiva se corrige con un campo de escala lineal (píxeles por pulgada
 * según dónde cae la etiqueta en la foto), ajustado con todas las etiquetas:
 * más cerca de la cámara, etiqueta más grande. Para ordenar y agrupar en
 * niveles alcanza; las pulgadas son aproximadas y `fitRmsIn` dice cuánto.
 *
 * Puro y determinista.
 */

/** El lado corto de la etiqueta de caja, en pulgadas (ver arriba). */
export const LABEL_SHORT_IN = 3.6;

/** Con menos etiquetas ubicadas la foto es un acercamiento, no un frente. */
export const FRONT_MIN_LABELS = 4;

/**
 * Dos etiquetas de pie a más de esto en altura están en niveles distintos. La
 * caja de bici de pie mide ~30" de alto (`height_in`); medio nivel separa sin
 * confundir una etiqueta pegada más arriba o más abajo en su caja.
 */
export const LEVEL_GAP_IN = 12;

type Pt = readonly [number, number];

export interface FrontLabel {
  sku: string | null;
  corners: readonly Pt[] | null | undefined;
}

export interface FrontBox {
  sku: string;
  /** De pie (etiqueta derecha) o acostada (etiqueta tumbada). */
  upright: boolean;
  /** Pulgadas en la cara, `x` a la derecha mirando el frente, `y` hacia arriba desde la etiqueta más baja. */
  x_in: number;
  y_in: number;
  /** Nivel de las de pie, 0 = abajo. `null` en una acostada: va encima. */
  level: number | null;
  /** Lugar dentro de su nivel (o entre las acostadas), 0 = la de la izquierda. */
  pos: number;
}

export interface FrontRead {
  /** ≥ {@link FRONT_MIN_LABELS} etiquetas con SKU y esquinas. */
  isFront: boolean;
  /** De abajo arriba y de izquierda a derecha; las acostadas al final. */
  boxes: FrontBox[];
  /** Cuánto se separa el lado corto de cada etiqueta del medido, con la escala ajustada (pulgadas, RMS). */
  fitRmsIn: number | null;
  /** Etiquetas sin SKU o sin 4 esquinas: no se pueden ubicar. */
  skipped: number;
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const norm = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n] : [0, 1];
};

interface Measured {
  sku: string;
  center: Pt;
  /** El borde de arriba, de izquierda a derecha de la etiqueta. */
  top: Pt;
  /** El costado, de arriba abajo de la etiqueta. */
  side: Pt;
  shortPx: number;
  upright: boolean;
}

function measure(label: FrontLabel): Measured | null {
  const c = label.corners;
  if (!label.sku || !Array.isArray(c) || c.length !== 4) return null;
  const [p0, p1, p2, p3] = c;
  const top = scale(add(sub(p1, p0), sub(p2, p3)), 0.5);
  const side = scale(add(sub(p3, p0), sub(p2, p1)), 0.5);
  const shortPx = Math.min(norm(top), norm(side));
  if (!(shortPx > 0)) return null;
  return {
    sku: label.sku,
    center: scale(add(add(p0, p1), add(p2, p3)), 0.25),
    top,
    side,
    shortPx,
    upright: Math.abs(top[0]) >= Math.abs(top[1]),
  };
}

/** Mínimos cuadrados de `s = a + b·x + c·y`; con pocos puntos o mal condicionado, la mediana. */
function fitScale(points: { p: Pt; s: number }[]): (p: Pt) => number {
  const sorted = points.map((q) => q.s).sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const flat = () => median;
  if (points.length < 4) return flat;
  // Ecuaciones normales 3×3, centradas para que el sistema esté bien condicionado.
  const mx = points.reduce((t, q) => t + q.p[0], 0) / points.length;
  const my = points.reduce((t, q) => t + q.p[1], 0) / points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxs = 0;
  let sys = 0;
  let ss = 0;
  for (const q of points) {
    const x = q.p[0] - mx;
    const y = q.p[1] - my;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxs += x * q.s;
    sys += y * q.s;
    ss += q.s;
  }
  const det = sxx * syy - sxy * sxy;
  if (!(Math.abs(det) > 1e-9)) return flat;
  const b = (sxs * syy - sys * sxy) / det;
  const c = (sys * sxx - sxs * sxy) / det;
  const a = ss / points.length;
  const at = (p: Pt) => a + b * (p[0] - mx) + c * (p[1] - my);
  // Una escala que se vuelve ≤ 0 dentro de la foto es un ajuste roto: mejor plana.
  if (points.some((q) => !(at(q.p) > 0))) return flat;
  return (p) => Math.max(at(p), median * 0.25);
}

export function readFront(labels: readonly FrontLabel[]): FrontRead {
  const measured = labels.map(measure);
  const ok = measured.filter((m): m is Measured => m !== null);
  const skipped = labels.length - ok.length;
  if (ok.length === 0) return { isFront: false, boxes: [], fitRmsIn: null, skipped };

  // Hacia abajo en la cara: el costado de las etiquetas derechas. Una etiqueta
  // pegada boca abajo tiene el costado al revés (78-0696 en el frente de prueba),
  // así que cada costado se orienta hacia el abajo de la foto antes de promediar.
  // Sin ninguna derecha, el abajo de la foto.
  const uprights = ok.filter((m) => m.upright);
  const down = uprights.length
    ? unit(
        uprights.reduce<Pt>(
          (t, m) => {
            const s = unit(m.side);
            return add(t, s[1] >= 0 ? s : scale(s, -1));
          },
          [0, 0]
        )
      )
    : ([0, 1] as Pt);
  // En píxeles la y crece hacia abajo: con abajo = (0, 1), derecha = (1, 0).
  const right: Pt = [down[1], -down[0]];

  const pxPerIn = fitScale(ok.map((m) => ({ p: m.center, s: m.shortPx / LABEL_SHORT_IN })));
  const fitRmsIn = Math.sqrt(
    ok.reduce((t, m) => t + (m.shortPx / pxPerIn(m.center) - LABEL_SHORT_IN) ** 2, 0) / ok.length
  );

  const origin = scale(
    ok.reduce<Pt>((t, m) => add(t, m.center), [0, 0]),
    1 / ok.length
  );
  const placed = ok.map((m) => {
    const d = sub(m.center, origin);
    const k = pxPerIn(scale(add(m.center, origin), 0.5));
    return { m, x: dot(d, right) / k, y: -dot(d, down) / k };
  });
  const floorY = Math.min(...placed.map((p) => p.y));

  const boxes: FrontBox[] = [];
  const standing = placed.filter((p) => p.m.upright).sort((a, b) => a.y - b.y);
  let level = 0;
  let lastY: number | null = null;
  const levels: (typeof standing)[] = [];
  for (const p of standing) {
    if (lastY != null && p.y - lastY > LEVEL_GAP_IN) level += 1;
    (levels[level] ??= []).push(p);
    lastY = p.y;
  }
  levels.forEach((row, lv) =>
    [...row]
      .sort((a, b) => a.x - b.x)
      .forEach((p, pos) =>
        boxes.push({
          sku: p.m.sku,
          upright: true,
          x_in: p.x,
          y_in: p.y - floorY,
          level: lv,
          pos,
        })
      )
  );
  placed
    .filter((p) => !p.m.upright)
    .sort((a, b) => a.x - b.x)
    .forEach((p, pos) =>
      boxes.push({ sku: p.m.sku, upright: false, x_in: p.x, y_in: p.y - floorY, level: null, pos })
    );

  return { isFront: ok.length >= FRONT_MIN_LABELS, boxes, fitRmsIn, skipped };
}
