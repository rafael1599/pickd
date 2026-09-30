/**
 * Pieza 1 del lector (idea-238, 29 sep 2026): encontrar cada etiqueta de caja
 * en la foto del pallet y devolverla **plana, derecha y a 800 px**, sin OCR.
 *
 * Por qué existe: el detector del OCR trabaja a ≤ 1.920 px sobre fotos de
 * 3.840, así que la línea del SKU le llega a ~10 px y no la ve. Recortar cada
 * etiqueta del original y leer sólo el recorte subió el recall por etiqueta del
 * banco de 0,54 a 0,88 (`label-bench/banco-dcv`, informes r6–r14). Es el mismo
 * algoritmo que se validó allí en Python/OpenCV, escrito sin dependencias para
 * correr en el Worker de la sombra:
 *
 *  1. Máscara en una versión de 1.280 px: píxel poco saturado, no oscuro y más
 *     claro que la media de su entorno (pegatina blanca sobre cartón marrón).
 *  2. Cierre/apertura, componentes, cuadrilátero (Douglas–Peucker sobre la
 *     envolvente convexa si da 4 vértices; si no, el rectángulo de área mínima).
 *  3. Dos mitades de una etiqueta partida por el fleje se unen si su envolvente
 *     no crece y tienen el mismo ancho a lo largo del corte (la pegatina del
 *     serial, más estrecha, no se pega).
 *  4. Una segunda pasada más permisiva añade sólo lo que trae un código de
 *     barras de la plantilla (firma de barras) y no pisa lo ya encontrado.
 *  5. Homografía de las 4 esquinas a 800 px; vertical; 0°/180° por plantilla.
 *
 * Puro: trabaja sobre `{width, height, data}` RGBA, sin canvas, para poder
 * probarlo en Node. La decodificación del Blob vive en el llamador.
 */

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export type Pt = [number, number];
/** Cuatro esquinas en px de la foto: arriba-izq., arriba-der., abajo-der., abajo-izq. */
export type Quad = [Pt, Pt, Pt, Pt];

interface CandParams {
  S: number;
  spread: number;
  floorV: number;
  delta: number;
  blur: number;
  close: number;
  minArea: number;
  maxArea: number;
  minFill: number;
  minRatio: number;
  maxRatio: number;
}

const STRICT: CandParams = {
  S: 1280,
  spread: 40,
  floorV: 90,
  delta: 18,
  blur: 81,
  close: 7,
  minArea: 0.002,
  maxArea: 0.5,
  minFill: 0.6,
  minRatio: 1.15,
  maxRatio: 4.0,
};
const PERMISSIVE: CandParams = {
  ...STRICT,
  minArea: 0.001,
  maxArea: 0.95,
  minRatio: 1.0,
  maxRatio: 6,
  minFill: 0.4,
};

/** Lado mayor de la etiqueta enderezada. */
export const LABEL_SIDE = 800;

// ─── geometría ──────────────────────────────────────────────────────────────

function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0)
      upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function perimeter(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++)
    s += Math.hypot(p[(i + 1) % p.length][0] - p[i][0], p[(i + 1) % p.length][1] - p[i][1]);
  return s;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  if (L === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.sqrt(L);
}

function dp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let idx = 0;
  let dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  const a = dp(pts.slice(0, idx + 1), eps);
  const b = dp(pts.slice(idx), eps);
  return a.slice(0, -1).concat(b);
}

/** Douglas–Peucker sobre un polígono cerrado (como `approxPolyDP(..., closed)`). */
export function approxClosed(poly: Pt[], eps: number): Pt[] {
  if (poly.length <= 4) return poly;
  let far = 0;
  let dmax = -1;
  for (let i = 1; i < poly.length; i++) {
    const d = Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]);
    if (d > dmax) {
      dmax = d;
      far = i;
    }
  }
  const a = dp(poly.slice(0, far + 1), eps);
  const b = dp(poly.slice(far).concat([poly[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function isConvex(p: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const c = p[(i + 2) % p.length];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (z !== 0) {
      if (sign === 0) sign = Math.sign(z);
      else if (Math.sign(z) !== sign) return false;
    }
  }
  return true;
}

/** Rectángulo de área mínima que contiene los puntos: sus 4 esquinas y lados. */
export function minAreaRect(points: Pt[]): { box: Pt[]; w: number; h: number } {
  const hull = convexHull(points);
  let best = { area: Infinity, box: [] as Pt[], w: 0, h: 0 };
  const n = hull.length;
  if (n < 3) {
    const xs = points.map((q) => q[0]);
    const ys = points.map((q) => q[1]);
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    return {
      box: [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      w: x1 - x0,
      h: y1 - y0,
    };
  }
  for (let i = 0; i < n; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const ux = (b[0] - a[0]) / len,
      uy = (b[1] - a[1]) / len;
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (const q of hull) {
      const u = q[0] * ux + q[1] * uy;
      const v = -q[0] * uy + q[1] * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const P = (u: number, v: number): Pt => [u * ux - v * uy, u * uy + v * ux];
      best = {
        area,
        box: [P(minU, minV), P(maxU, minV), P(maxU, maxV), P(minU, maxV)],
        w: maxU - minU,
        h: maxV - minV,
      };
    }
  }
  return { box: best.box, w: best.w, h: best.h };
}

/** Esquinas en orden arriba-izq., arriba-der., abajo-der., abajo-izq. */
export function orderQuad(q: Pt[]): Quad {
  const cx = q.reduce((s, p) => s + p[0], 0) / q.length;
  const cy = q.reduce((s, p) => s + p[1], 0) / q.length;
  const byAng = [...q].sort(
    (a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)
  );
  let i0 = 0;
  for (let i = 1; i < byAng.length; i++)
    if (byAng[i][0] + byAng[i][1] < byAng[i0][0] + byAng[i0][1]) i0 = i;
  const r = byAng.slice(i0).concat(byAng.slice(0, i0));
  return [r[0], r[1], r[2], r[3]] as Quad;
}

// ─── imagen ─────────────────────────────────────────────────────────────────

/** Reducción por promedio de área (como INTER_AREA). */
export function resizeArea(img: Rgba, W: number, H: number): Rgba {
  const out = new Uint8ClampedArray(W * H * 4);
  const sx = img.width / W,
    sy = img.height / H;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * sy),
      y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * sx),
        x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        let o = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1 && xx < img.width; xx++, o += 4) {
          r += img.data[o];
          g += img.data[o + 1];
          b += img.data[o + 2];
          n++;
        }
      }
      const q = (y * W + x) * 4;
      out[q] = r / n;
      out[q + 1] = g / n;
      out[q + 2] = b / n;
      out[q + 3] = 255;
    }
  }
  return { width: W, height: H, data: out };
}

export function toGray(img: Rgba): Float32Array {
  const g = new Float32Array(img.width * img.height);
  for (let i = 0, o = 0; i < g.length; i++, o += 4)
    g[i] = Math.round(0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]);
  return g;
}

/** Media en una ventana kw×kh (bordes recortados), por imagen integral. */
function boxBlur(src: Float32Array, W: number, H: number, kw: number, kh: number): Float32Array {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += src[y * W + x];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(W * H);
  const rx = kw >> 1,
    ry = kh >> 1;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - ry),
      y1 = Math.min(H, y + ry + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - rx),
        x1 = Math.min(W, x + rx + 1);
      const s =
        I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      out[y * W + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

function morph(m: Uint8Array, W: number, H: number, k: number, dilate: boolean): Uint8Array {
  const r = k >> 1;
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = dilate ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= W) continue;
        const s = m[y * W + xx];
        if (dilate ? s : !s) {
          v = dilate ? 1 : 0;
          break;
        }
      }
      tmp[y * W + x] = v;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = dilate ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= H) continue;
        const s = tmp[yy * W + x];
        if (dilate ? s : !s) {
          v = dilate ? 1 : 0;
          break;
        }
      }
      out[y * W + x] = v;
    }
  return out;
}

interface Candidate {
  quad: Quad;
  ratio: number;
  fill: number;
}

interface Blob2 {
  /** Área rellena (con los huecos del texto) en px de la versión reducida. */
  a: number;
  hull: Pt[];
}

/** Las manchas blancas de la foto (paso 1), una vez por foto: las dos pasadas sólo difieren en los filtros. */
const blobCache = new WeakMap<Rgba, { k: number; areaImg: number; blobs: Blob2[] }>();

function blobsOf(
  img: Rgba,
  p: CandParams = STRICT
): { k: number; areaImg: number; blobs: Blob2[] } {
  const hit = blobCache.get(img);
  if (hit) return hit;
  const k = p.S / Math.max(img.width, img.height);
  const W = Math.round(img.width * k),
    H = Math.round(img.height * k);
  const sm = resizeArea(img, W, H);
  const lum = new Float32Array(W * H);
  const pass = new Uint8Array(W * H);
  for (let i = 0, o = 0; i < W * H; i++, o += 4) {
    const r = sm.data[o],
      g = sm.data[o + 1],
      b = sm.data[o + 2];
    const mn = Math.min(r, g, b),
      mx = Math.max(r, g, b);
    lum[i] = (r + g + b) / 3;
    pass[i] = mx - mn <= p.spread && mn >= p.floorV ? 1 : 0;
  }
  const local = boxBlur(lum, W, H, p.blur, p.blur);
  let mask: Uint8Array = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = pass[i] && lum[i] >= local[i] + p.delta ? 1 : 0;
  mask = morph(morph(mask, W, H, p.close, true), W, H, p.close, false);
  mask = morph(morph(mask, W, H, 3, false), W, H, 3, true);

  // componentes (8-vecinos) y fondo exterior (4-vecinos desde el borde)
  const lab = new Int32Array(W * H).fill(-1);
  const stack = new Int32Array(W * H);
  const count: number[] = [];
  let nLab = 0;
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    let top = 0;
    stack[top++] = s;
    lab[s] = nLab;
    let c = 0;
    while (top) {
      const q = stack[--top];
      c++;
      const x = q % W,
        y = (q / W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const t = yy * W + xx;
          if (mask[t] && lab[t] < 0) {
            lab[t] = nLab;
            stack[top++] = t;
          }
        }
    }
    count.push(c);
    nLab++;
  }
  const outside = new Uint8Array(W * H);
  {
    let top = 0;
    const push = (t: number) => {
      if (!mask[t] && !outside[t]) {
        outside[t] = 1;
        stack[top++] = t;
      }
    };
    for (let x = 0; x < W; x++) {
      push(x);
      push((H - 1) * W + x);
    }
    for (let y = 0; y < H; y++) {
      push(y * W);
      push(y * W + W - 1);
    }
    while (top) {
      const q = stack[--top];
      const x = q % W,
        y = (q / W) | 0;
      if (x > 0) push(q - 1);
      if (x < W - 1) push(q + 1);
      if (y > 0) push(q - W);
      if (y < H - 1) push(q + W);
    }
  }
  // un componente dentro del hueco de otro no es externo (RETR_EXTERNAL)
  const external = new Uint8Array(nLab);
  for (let q = 0; q < W * H; q++) {
    const l = lab[q];
    if (l < 0 || external[l]) continue;
    const x = q % W,
      y = (q / W) | 0;
    if (
      x === 0 ||
      y === 0 ||
      x === W - 1 ||
      y === H - 1 ||
      outside[q - 1] ||
      outside[q + 1] ||
      outside[q - W] ||
      outside[q + W]
    )
      external[l] = 1;
  }
  const holes = new Float64Array(nLab);
  const rowMin = new Map<number, Int32Array>();
  const rowMax = new Map<number, Int32Array>();
  for (let y = 0; y < H; y++) {
    let last = -1;
    for (let x = 0; x < W; x++) {
      const q = y * W + x,
        l = lab[q];
      if (l >= 0) {
        if (external[l]) {
          last = l;
          let mn = rowMin.get(l),
            mx = rowMax.get(l);
          if (!mn) {
            mn = new Int32Array(H).fill(-1);
            mx = new Int32Array(H).fill(-1);
            rowMin.set(l, mn);
            rowMax.set(l, mx!);
          }
          if (mn[y] < 0) mn[y] = x;
          mx![y] = x;
        }
      } else if (!outside[q] && last >= 0) holes[last]++;
    }
  }
  const areaImg = W * H;
  const blobs: Blob2[] = [];
  for (let l = 0; l < nLab; l++) {
    if (!external[l]) continue;
    const a = count[l] + holes[l];
    if (a < 0.0005 * areaImg) continue;
    const mn = rowMin.get(l)!,
      mx = rowMax.get(l)!;
    const pts: Pt[] = [];
    for (let y = 0; y < H; y++)
      if (mn[y] >= 0) {
        pts.push([mn[y], y]);
        pts.push([mx[y], y]);
      }
    blobs.push({ a, hull: convexHull(pts) });
  }
  const res = { k, areaImg, blobs };
  blobCache.set(img, res);
  return res;
}

/** Candidatos a etiqueta (pasos 1–2), en px de la foto. */
export function candidates(img: Rgba, p: CandParams = STRICT): Candidate[] {
  const { k, areaImg, blobs } = blobsOf(img, p);
  const out: Candidate[] = [];
  for (const { a, hull } of blobs) {
    if (a < p.minArea * areaImg || a > p.maxArea * areaImg) continue;
    const ap = approxClosed(hull, 0.03 * perimeter(hull));
    const q: Pt[] = ap.length === 4 && isConvex(ap) ? ap : minAreaRect(hull).box;
    const qa = polyArea(q);
    if (qa <= 0 || a / qa < p.minFill) continue;
    const rr = minAreaRect(q);
    const ratio = Math.max(rr.w, rr.h) / Math.max(1e-6, Math.min(rr.w, rr.h));
    if (ratio < p.minRatio || ratio > p.maxRatio) continue;
    out.push({ quad: orderQuad(q.map(([x, y]) => [x / k, y / k] as Pt)), ratio, fill: a / qa });
  }
  return out;
}

// ─── unir mitades (fleje) ───────────────────────────────────────────────────

function sameWidth(A: Pt[], B: Pt[], tol = 0.75): boolean {
  const ma = A.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map((v) => v / A.length);
  const mb = B.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map((v) => v / B.length);
  const d = [mb[0] - ma[0], mb[1] - ma[1]];
  const n = Math.hypot(d[0], d[1]);
  if (n < 1e-6) return true;
  const perp = [-d[1] / n, d[0] / n];
  const ptp = (P: Pt[]) => {
    const v = P.map((p) => p[0] * perp[0] + p[1] * perp[1]);
    return Math.max(...v) - Math.min(...v);
  };
  const wa = ptp(A),
    wb = ptp(B);
  return Math.min(wa, wb) / Math.max(wa, wb) >= tol;
}

export function mergeGroups(qs: Quad[], k = 1.3): number[][] {
  const groups = qs.map((_, i) => [i]);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < groups.length; a++)
      for (let b = a + 1; b < groups.length; b++) {
        const A = groups[a].flatMap((i) => qs[i]);
        const B = groups[b].flatMap((i) => qs[i]);
        const ha = polyArea(convexHull(A.concat(B)));
        const sa = groups[a].concat(groups[b]).reduce((s, i) => s + polyArea(qs[i]), 0);
        if (ha <= k * sa && sameWidth(A, B)) {
          groups[a] = groups[a].concat(groups[b]);
          groups.splice(b, 1);
          changed = true;
          break outer;
        }
      }
  }
  return groups;
}

function groupQuad(qs: Quad[]): Quad {
  const pts = qs.flat();
  const hull = convexHull(pts);
  const ap = approxClosed(hull, 0.02 * perimeter(hull));
  return orderQuad(ap.length === 4 ? ap : minAreaRect(pts).box);
}

// ─── rectificar y orientar ──────────────────────────────────────────────────

/** Homografía que lleva `src[i]` a `dst[i]` (8×8 por eliminación gaussiana). */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i],
      [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j < 9; j++) A[r][j] -= f * A[c][j];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

export function applyH(h: number[], x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export interface RectifiedLabel {
  image: Rgba;
  quad: Quad;
  /** Lleva un punto del recorte final a la foto original. */
  toPhoto: (x: number, y: number) => Pt;
}

function warp(img: Rgba, quad: Quad, side: number): { image: Rgba; hDstToSrc: number[] } {
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2;
  const h = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2;
  const [dw, dh] =
    w >= h
      ? [side, Math.max(8, Math.round((side * h) / w))]
      : [Math.max(8, Math.round((side * w) / h)), side];
  const dst: Pt[] = [
    [0, 0],
    [dw, 0],
    [dw, dh],
    [0, dh],
  ];
  const H = homography(dst, quad);
  const out = new Uint8ClampedArray(dw * dh * 4);
  const W0 = img.width,
    H0 = img.height,
    D = img.data;
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const [sx, sy] = applyH(H, x + 0.5, y + 0.5);
      const fx = Math.min(Math.max(sx - 0.5, 0), W0 - 1.001),
        fy = Math.min(Math.max(sy - 0.5, 0), H0 - 1.001);
      const x0 = fx | 0,
        y0 = fy | 0,
        ax = fx - x0,
        ay = fy - y0;
      const o00 = (y0 * W0 + x0) * 4,
        o01 = o00 + 4,
        o10 = o00 + W0 * 4,
        o11 = o10 + 4;
      const q = (y * dw + x) * 4;
      for (let c = 0; c < 3; c++)
        out[q + c] =
          (D[o00 + c] * (1 - ax) + D[o01 + c] * ax) * (1 - ay) +
          (D[o10 + c] * (1 - ax) + D[o11 + c] * ax) * ay;
      out[q + 3] = 255;
    }
  return { image: { width: dw, height: dh, data: out }, hDstToSrc: H };
}

function rotate(img: Rgba, cw90: boolean): Rgba {
  const { width: W, height: H, data } = img;
  const out = new Uint8ClampedArray(W * H * 4);
  if (cw90) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4,
          t = (x * H + (H - 1 - y)) * 4;
        out[t] = data[s];
        out[t + 1] = data[s + 1];
        out[t + 2] = data[s + 2];
        out[t + 3] = 255;
      }
    return { width: H, height: W, data: out };
  }
  for (let i = 0, j = (W * H - 1) * 4; i < W * H * 4; i += 4, j -= 4) {
    out[j] = data[i];
    out[j + 1] = data[i + 1];
    out[j + 2] = data[i + 2];
    out[j + 3] = 255;
  }
  return { width: W, height: H, data: out };
}

function sobel(g: Float32Array, W: number, H: number, dx: boolean): Float32Array {
  const out = new Float32Array(W * H);
  const at = (x: number, y: number) =>
    g[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      out[y * W + x] = dx
        ? at(x + 1, y - 1) +
          2 * at(x + 1, y) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x - 1, y) -
          at(x - 1, y + 1)
        : at(x - 1, y + 1) +
          2 * at(x, y + 1) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x, y - 1) -
          at(x + 1, y - 1);
  return out;
}

function transpose(g: Float32Array, W: number, H: number): Float32Array {
  const t = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) t[x * H + y] = g[y * W + x];
  return t;
}

/**
 * Firma de código de barras: en alguna ventana del tamaño de un código, la
 * energía de gradiente a lo ancho domina a la de a lo alto. 1 = sólo barras.
 * Toda etiqueta de JAMIS lleva al menos un código 1D; el cartón, no.
 */
export function barcodeBlocks(img: Rgba): number {
  const g0 = toGray(img);
  let best = 0;
  for (const [g, W, H] of [
    [g0, img.width, img.height],
    [transpose(g0, img.width, img.height), img.height, img.width],
  ] as const) {
    const gx = sobel(g, W, H, true).map(Math.abs),
      gy = sobel(g, W, H, false).map(Math.abs);
    const kw = Math.max(9, Math.floor(W / 6)),
      kh = Math.max(5, Math.floor(H / 30));
    const ex = boxBlur(gx, W, H, kw, kh),
      ey = boxBlur(gy, W, H, kw, kh);
    for (let i = 0; i < W * H; i++)
      if (ex[i] > 40) best = Math.max(best, (ex[i] - ey[i]) / (ex[i] + ey[i] + 1));
  }
  return best;
}

function inkMask(g: Float32Array): Uint8Array {
  const s = Float32Array.from(g).sort();
  const med = s[Math.floor((s.length - 1) / 2)];
  const thr = Math.max(60, Math.min(140, med * 0.6));
  return Uint8Array.from(g, (v) => (v < thr ? 1 : 0));
}

function std(a: number[]): number {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
}

/** Clásica: el texto va alineado a la izquierda. > 0 = derecha. */
function leftScore(g: Float32Array, W: number, H: number): number {
  const m0 = inkMask(g);
  const y0 = Math.floor(0.04 * H),
    y1 = Math.floor(0.96 * H),
    x0 = Math.floor(0.04 * W),
    x1 = Math.floor(0.96 * W);
  const w = x1 - x0;
  const rowHas = (y: number) => {
    let s = 0;
    for (let x = x0; x < x1; x++) s += m0[y * W + x];
    return s > 0.02 * w;
  };
  const L: number[] = [],
    R: number[] = [];
  let y = y0;
  while (y < y1) {
    if (rowHas(y)) {
      const ys = y;
      while (y < y1 && rowHas(y)) y++;
      let lo = -1,
        hi = -1;
      for (let x = x0; x < x1; x++) {
        let any = 0;
        for (let yy = ys; yy < y; yy++) any |= m0[yy * W + x];
        if (any) {
          if (lo < 0) lo = x - x0;
          hi = x - x0;
        }
      }
      if (lo >= 0 && y - ys > 3) {
        L.push(lo);
        R.push(hi);
      }
    }
    y++;
  }
  if (L.length < 4) return 0;
  const sl = std(L),
    sr = std(R);
  return (sr - sl) / (sr + sl + 1e-6);
}

/** Power of Design: los códigos de barras están en la mitad de arriba. > 0 = derecha. */
function barScore(g: Float32Array, W: number, H: number): number {
  const gx = sobel(g, W, H, true),
    gy = sobel(g, W, H, false);
  let num = 0,
    den = 0;
  for (let y = 0; y < H; y++) {
    let e = 0;
    for (let x = 0; x < W; x++)
      e += Math.max(0, Math.abs(gx[y * W + x]) - 1.5 * Math.abs(gy[y * W + x]));
    num += e * y;
    den += e;
  }
  return 0.5 - num / (den + 1e-6) / H;
}

function darkBand(g: Float32Array, W: number, H: number): number {
  let rows = 0;
  for (let y = 0; y < H; y++) {
    let d = 0;
    for (let x = 0; x < W; x++) if (g[y * W + x] < 90) d++;
    if (d / W > 0.45) rows++;
  }
  return rows / H;
}

// ─── ajuste fino del contorno e inclinación residual (30 sep 2026) ───────────
//
// En las fotos de 900 px del archivo, el cuadrilátero calculado a 1.280 px traía a
// veces una franja de cartón (Rafael: «no solo extrae la etiqueta, si no que
// también un pedazo de cartón»). Cuando el borde del recorte tiene cartón, se
// endereza con margen, se busca dentro la pegatina blanca (umbral de Otsu entre
// los píxeles poco saturados) y sus esquinas se llevan de vuelta a la foto. En el
// banco (fotos de 3.840) casi nunca se activa y no mueve el error de esquina
// medido a ciegas (9,8 px); en el archivo corrige 1 de cada 9 recortes.

function expandQuad(q: Quad, m: number): Quad {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  return q.map(([x, y]) => [cx + (x - cx) * (1 + m), cy + (y - cy) * (1 + m)] as Pt) as Quad;
}

/** Fracción de cartón (píxeles saturados) en el 6 % de borde del recorte enderezado. */
export function borderCardboard(img: Rgba, quad: Quad): number {
  const { image } = warp(img, quad, 400);
  const { width: W, height: H, data } = image;
  const b = Math.max(2, Math.floor(0.06 * Math.min(W, H)));
  let n = 0,
    sat = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (x >= b && x < W - b && y >= b && y < H - b) continue;
      const o = (y * W + x) * 4;
      n++;
      if (
        Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]) >=
        45
      )
        sat++;
    }
  return n ? sat / n : 0;
}

function otsu(values: number[]): number {
  const hist = new Float64Array(256);
  for (const v of values) hist[v]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0,
    wB = 0,
    best = 0,
    thr = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) {
      best = v;
      thr = t;
    }
  }
  return thr;
}

/** El contorno de la pegatina blanca buscado dentro del recorte; `null` si no es fiable. */
export function refineQuad(img: Rgba, quad: Quad): Quad | null {
  const { image: c, hDstToSrc } = warp(img, expandQuad(quad, 0.12), 800);
  const { width: W, height: H, data } = c;
  const g = toGray(c);
  const low = new Uint8Array(W * H);
  const lowVals: number[] = [];
  for (let i = 0, o = 0; i < W * H; i++, o += 4) {
    const s =
      Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]);
    if (s < 45) {
      low[i] = 1;
      lowVals.push(g[i] | 0);
    }
  }
  if (lowVals.length < 100) return null;
  const thr = Math.max(otsu(lowVals), 110);
  let m: Uint8Array = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = low[i] && g[i] > thr ? 1 : 0;
  const k = Math.max(9, Math.floor(W / 25));
  m = morph(morph(m, W, H, k, true), W, H, k, false);
  m = morph(morph(m, W, H, 5, false), W, H, 5, true);
  // componente que contiene el centro, o la mayor
  const lab = new Int32Array(W * H).fill(-1);
  const stack = new Int32Array(W * H);
  const sizes: number[] = [];
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!m[s0] || lab[s0] >= 0) continue;
    let top = 0,
      n = 0;
    const l = sizes.length;
    stack[top++] = s0;
    lab[s0] = l;
    while (top) {
      const q = stack[--top];
      n++;
      const x = q % W,
        y = (q / W) | 0;
      for (const t of [
        x > 0 ? q - 1 : -1,
        x < W - 1 ? q + 1 : -1,
        y > 0 ? q - W : -1,
        y < H - 1 ? q + W : -1,
      ])
        if (t >= 0 && m[t] && lab[t] < 0) {
          lab[t] = l;
          stack[top++] = t;
        }
    }
    sizes.push(n);
  }
  if (!sizes.length) return null;
  let li = lab[((H / 2) | 0) * W + ((W / 2) | 0)];
  if (li < 0) li = sizes.indexOf(Math.max(...sizes));
  const pts: Pt[] = [];
  for (let y = 0; y < H; y++) {
    let lo = -1,
      hi = -1;
    for (let x = 0; x < W; x++)
      if (lab[y * W + x] === li) {
        if (lo < 0) lo = x;
        hi = x;
      }
    if (lo >= 0) pts.push([lo, y], [hi, y]);
  }
  const hull = convexHull(pts);
  const ap = approxClosed(hull, 0.02 * perimeter(hull));
  const qc = ap.length === 4 ? ap : minAreaRect(hull).box;
  const qp = qc.map(([x, y]) => applyH(hDstToSrc, x, y));
  const r = polyArea(qp) / Math.max(1, polyArea(quad));
  if (r < 0.55 || r > 1.25) return null;
  return orderQuad(qp);
}

function inkRows(g: Float32Array, W: number, H: number): Uint8Array {
  // tinta cerrada en horizontal (1×15): las letras de un renglón se funden y cada código de barras
  // queda como un bloque, así las barras verticales no dominan la estimación
  const ink = inkMask(g);
  const r = 7;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let last = -1e9;
    const row = y * W;
    const next = new Int32Array(W).fill(1e9);
    for (let x = W - 1, n = 1e9; x >= 0; x--) {
      if (ink[row + x]) n = x;
      next[x] = n;
    }
    for (let x = 0; x < W; x++) {
      if (ink[row + x]) last = x;
      out[row + x] = x - last <= 2 * r && next[x] - x <= 2 * r ? 1 : 0;
    }
  }
  return out;
}

/**
 * Inclinación que queda en la etiqueta enderezada, en grados, por el perfil de proyección de
 * los renglones (Bloomberg et al. 1995; Bao et al. 2022, según la revisión en R9): el ángulo en
 * [−5°, 5°] que hace más marcadas las filas de tinta.
 */
export function residualAngle(img: Rgba): number {
  const { width: W, height: H } = img;
  const m = inkRows(toGray(img), W, H);
  const xs: number[] = [],
    ys: number[] = [];
  // todas las filas (saltar filas pinta un peine que siempre gana en 0°); columnas de dos en dos
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x += 2)
      if (m[y * W + x]) {
        xs.push(x - W / 2);
        ys.push(y - H / 2);
      }
  let best = -1,
    bestTh = 0;
  const rows = new Float64Array(H + 2);
  for (let th = -5; th <= 5.0001; th += 0.2) {
    const a = (th * Math.PI) / 180,
      sn = Math.sin(a),
      cs = Math.cos(a);
    rows.fill(0);
    for (let i = 0; i < xs.length; i++) {
      const yr = Math.round(-sn * xs[i] + cs * ys[i] + H / 2);
      if (yr >= 0 && yr < H) rows[yr]++;
    }
    let mean = 0;
    for (let y = 0; y < H; y++) mean += rows[y];
    mean /= H;
    let v = 0;
    for (let y = 0; y < H; y++) v += (rows[y] - mean) * (rows[y] - mean);
    if (v > best) {
      best = v;
      bestTh = th;
    }
  }
  return Math.round(bestTh * 10) / 10;
}

/** Gira `deg` grados (positivo = antihorario, como `getRotationMatrix2D`), fondo blanco. */
function rotateDeg(img: Rgba, deg: number): Rgba {
  const { width: W, height: H, data } = img;
  const a = (deg * Math.PI) / 180,
    cs = Math.cos(a),
    sn = Math.sin(a);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x - W / 2,
        dy = y - H / 2;
      const sx = cs * dx - sn * dy + W / 2,
        sy = sn * dx + cs * dy + H / 2;
      const q = (y * W + x) * 4;
      if (sx < 0 || sy < 0 || sx > W - 1.001 || sy > H - 1.001) {
        out[q] = out[q + 1] = out[q + 2] = out[q + 3] = 255;
        continue;
      }
      const x0 = sx | 0,
        y0 = sy | 0,
        ax = sx - x0,
        ay = sy - y0;
      const o00 = (y0 * W + x0) * 4,
        o01 = o00 + 4,
        o10 = o00 + W * 4,
        o11 = o10 + 4;
      for (let c = 0; c < 3; c++)
        out[q + c] =
          (data[o00 + c] * (1 - ax) + data[o01 + c] * ax) * (1 - ay) +
          (data[o10 + c] * (1 - ax) + data[o11 + c] * ax) * ay;
      out[q + 3] = 255;
    }
  return { width: W, height: H, data: out };
}

/** La etiqueta girada 180°: la relectura cuando no salió SKU (una etiqueta boca abajo). */
export function rotate180(img: Rgba): Rgba {
  return rotate(img, false);
}

/**
 * Enderezar la etiqueta: si el borde trae cartón, primero se ajusta el contorno; homografía a
 * `side` px, vertical, 0°/180° por plantilla, y la inclinación residual (1°–5°) corregida.
 */
export function rectifyLabel(img: Rgba, quad0: Quad, side = LABEL_SIDE): RectifiedLabel {
  const quad = borderCardboard(img, quad0) >= 0.2 ? (refineQuad(img, quad0) ?? quad0) : quad0;
  const { image: w0, hDstToSrc } = warp(img, quad, side);
  let image = w0;
  const cw = image.width > image.height;
  if (cw) image = rotate(image, true);
  const g = toGray(image);
  const s =
    darkBand(g, image.width, image.height) >= 0.03
      ? leftScore(g, image.width, image.height)
      : barScore(g, image.width, image.height);
  const flip = s < 0;
  if (flip) image = rotate(image, false);
  const th = residualAngle(image);
  const deskew = Math.abs(th) >= 1 && Math.abs(th) < 5 ? th : 0;
  if (deskew) image = rotateDeg(image, deskew);
  const Wf = image.width,
    Hf = image.height,
    H0 = w0.height;
  const a = (deskew * Math.PI) / 180,
    cs = Math.cos(a),
    sn = Math.sin(a);
  const toPhoto = (x: number, y: number): Pt => {
    let u = x,
      v = y;
    if (deskew) {
      const dx = u - Wf / 2,
        dy = v - Hf / 2;
      u = cs * dx - sn * dy + Wf / 2;
      v = sn * dx + cs * dy + Hf / 2;
    }
    if (flip) {
      u = Wf - u;
      v = Hf - v;
    }
    if (cw) {
      const uu = v;
      v = H0 - u;
      u = uu;
    }
    return applyH(hDstToSrc, u, v);
  };
  return { image, quad, toPhoto };
}

// ─── IoU por rasterizado ────────────────────────────────────────────────────

function fillPoly(p: Pt[], W: number, H: number): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc))
        xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (
        let x = Math.max(0, Math.ceil(xs[i] - 0.5));
        x < Math.min(W, Math.ceil(xs[i + 1] - 0.5));
        x++
      )
        m[y * W + x] = 1;
  }
  return m;
}

export function quadIoU(a: Pt[], b: Pt[], width: number, height: number): number {
  const s = 320 / Math.max(width, height);
  const W = Math.ceil(width * s) + 1,
    H = Math.ceil(height * s) + 1;
  const ma = fillPoly(
    a.map(([x, y]) => [x * s, y * s] as Pt),
    W,
    H
  );
  const mb = fillPoly(
    b.map(([x, y]) => [x * s, y * s] as Pt),
    W,
    H
  );
  let i = 0,
    u = 0;
  for (let k = 0; k < W * H; k++) {
    i += ma[k] & mb[k];
    u += ma[k] | mb[k];
  }
  return u ? i / u : 0;
}

// ─── la pieza 1 completa ────────────────────────────────────────────────────

function groupsToQuads(img: Rgba, p: CandParams): { quad: Quad; area: number }[] {
  const qs = candidates(img, p).map((c) => c.quad);
  return mergeGroups(qs).map((g) => ({
    quad: groupQuad(g.map((i) => qs[i])),
    area: g.reduce((s, i) => s + polyArea(qs[i]), 0),
  }));
}

/**
 * Las etiquetas de la foto: la pasada estricta, más lo que la permisiva añade
 * con firma de código de barras (≥ 0,7) sin solaparse; si nada, la foto entera
 * cuando es una etiqueta (foto muy de cerca).
 */
export function locateLabels(img: Rgba): Quad[] {
  const strictG = groupsToQuads(img, STRICT);
  const amax = Math.max(0, ...strictG.map((g) => g.area));
  const strict = strictG.filter((g) => g.area / amax >= 0.25).map((g) => g.quad);

  const perm = groupsToQuads(img, PERMISSIVE)
    .map((g) => ({ ...g, bc: barcodeBlocks(warp(img, g.quad, LABEL_SIDE).image) }))
    .filter((g) => g.bc >= 0.7);
  let extra: Quad[];
  if (perm.length) {
    const pmax = Math.max(...perm.map((g) => g.area));
    extra = perm.filter((g) => g.area / pmax >= 0.2).map((g) => g.quad);
  } else {
    const full: Quad = [
      [0, 0],
      [img.width, 0],
      [img.width, img.height],
      [0, img.height],
    ];
    extra =
      strict.length === 0 && barcodeBlocks(warp(img, full, LABEL_SIDE).image) >= 0.7 ? [full] : [];
  }
  const add = extra.filter((q) => strict.every((s) => quadIoU(q, s, img.width, img.height) < 0.1));
  return strict.concat(add);
}
