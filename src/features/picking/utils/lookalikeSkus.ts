/**
 * SKUs que se confunden al recoger (Rafael, 5 oct 2026).
 *
 * #881828 pedía 2 × 03-4537GY (ROW 2) y subieron 2 × 03-4547MN, una fila más
 * allá: el mismo ALLEGRO A2, un dígito y el color de diferencia. El parpadeo de
 * Double Check sólo miraba los dos primeros y los dos últimos caracteres con el
 * centro idéntico, así que ni éste ni 03-3855GY / 03-3955GN avisaban.
 *
 * Dos reglas, las dos puras:
 *
 * - **Se parecen** ({@link skuDiffPositions}) dos SKUs de bici `DD-NNNN…` cuyos
 *   seis dígitos difieren en uno, o en dos vecinos cambiados de lugar (4537 /
 *   4573); el color puede ser cualquiera. Devuelve qué caracteres distinguen al
 *   de la orden: esos son los que parpadean.
 * - **Están cerca** ({@link areNeighbours}): la misma fila, la de número vecino o
 *   la siguiente en el recorrido. Lejos no se confunde: nadie baja una caja de
 *   otro pasillo por una de éste.
 *
 * Los números de Jamis son correlativos (cada talla y color, el siguiente) y el
 * almacén guarda las familias juntas, así que en las 941 líneas de los 30 días
 * al 5 oct, el 74 % tenía un parecido cerca. Rafael eligió el parpadeo igual:
 * «el que parpadee alerta al usuario».
 */

const BIKE_SKU = /^(\d{2})-(\d{4})([A-Z]*)$/;

/** Índice en el SKU de cada uno de sus seis dígitos (`DD-NNNN`). */
const DIGIT_AT = [0, 1, 3, 4, 5, 6];

/**
 * Los caracteres de `sku` que lo distinguen de `other`, o `null` si no se
 * parecen (ver arriba). Mayúsculas y minúsculas dan igual.
 */
export function skuDiffPositions(sku: string, other: string): number[] | null {
  const a = sku.trim().toUpperCase();
  const b = other.trim().toUpperCase();
  if (a === b) return null;
  const x = BIKE_SKU.exec(a);
  const y = BIKE_SKU.exec(b);
  if (!x || !y) return null;
  const da = x[1] + x[2];
  const db = y[1] + y[2];
  const diff: number[] = [];
  for (let i = 0; i < 6; i += 1) if (da[i] !== db[i]) diff.push(i);
  const swapped =
    diff.length === 2 &&
    diff[1] === diff[0] + 1 &&
    da[diff[0]] === db[diff[1]] &&
    da[diff[1]] === db[diff[0]];
  if (diff.length > 1 && !swapped) return null;

  const out = diff.map((i) => DIGIT_AT[i]);
  const sa = x[3];
  const sb = y[3];
  for (let i = 0; i < sa.length; i += 1) if (sa[i] !== sb[i]) out.push(7 + i);
  return out;
}

const rowNumber = (location: string) => {
  const m = /^ROW\s+(\d+)$/i.exec(location.trim());
  return m ? Number(m[1]) : null;
};

/**
 * La misma ubicación, la fila de número vecino o la siguiente en el recorrido.
 * `walk` = las ubicaciones del almacén en orden de recogida.
 */
export function areNeighbours(a: string, b: string, walk: readonly string[] = []): boolean {
  const na = a.trim().toUpperCase();
  const nb = b.trim().toUpperCase();
  if (na === nb) return true;
  const ra = rowNumber(na);
  const rb = rowNumber(nb);
  if (ra != null && rb != null && Math.abs(ra - rb) === 1) return true;
  const ia = walk.indexOf(na);
  const ib = walk.indexOf(nb);
  return ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1;
}

/** Las ubicaciones vecinas de `location` (ella incluida), para pedir su stock. */
export function neighbourLocations(location: string, walk: readonly string[] = []): string[] {
  const loc = location.trim().toUpperCase();
  const out = new Set([loc]);
  const n = rowNumber(loc);
  if (n != null) {
    out.add(`ROW ${n - 1}`);
    out.add(`ROW ${n + 1}`);
  }
  const i = walk.indexOf(loc);
  if (i > 0) out.add(walk[i - 1]);
  if (i >= 0 && i < walk.length - 1) out.add(walk[i + 1]);
  return [...out];
}

export interface LookalikeHit {
  sku: string;
  location: string;
}

export interface Lookalike {
  /** Los caracteres del SKU de la orden que parpadean. */
  positions: Set<number>;
  near: LookalikeHit[];
}

/**
 * Para cada SKU de la orden, los parecidos que hay en stock cerca de donde se
 * recoge. Un SKU sin parecidos cerca no sale.
 */
export function lookalikesNear(
  lines: readonly { sku: string; location: string | null; warehouse?: string | null }[],
  stock: readonly { sku: string; location: string | null; warehouse?: string | null }[],
  walk: readonly string[] = []
): Map<string, Lookalike> {
  const out = new Map<string, Lookalike>();
  const wh = (w: string | null | undefined) => (w ?? '').trim().toUpperCase();
  for (const line of lines) {
    if (!line.location) continue;
    for (const row of stock) {
      if (!row.location || wh(row.warehouse) !== wh(line.warehouse)) continue;
      if (!areNeighbours(line.location, row.location, walk)) continue;
      const pos = skuDiffPositions(line.sku, row.sku);
      if (!pos) continue;
      const hit = out.get(line.sku) ?? { positions: new Set<number>(), near: [] };
      pos.forEach((p) => hit.positions.add(p));
      if (!hit.near.some((h) => h.sku === row.sku && h.location === row.location)) {
        hit.near.push({ sku: row.sku, location: row.location });
      }
      out.set(line.sku, hit);
    }
  }
  return out;
}

export interface PhotoSuspect {
  /** Lo que leyó la foto y no está en la orden. */
  readSku: string;
  count: number;
  /** Los caracteres del SKU de la orden que lo distinguen. */
  positions: number[];
}

/**
 * Lo que una foto leyó que no está en la orden pero se parece a una línea que
 * sí: casi seguro, esa línea se recogió mal. Por SKU de la orden.
 */
export function photoSuspects(
  readSkus: readonly (string | null | undefined)[],
  orderSkus: readonly string[]
): Map<string, PhotoSuspect[]> {
  const order = new Set(orderSkus.map((s) => s.trim().toUpperCase()));
  const counts = new Map<string, number>();
  for (const raw of readSkus) {
    const s = (raw ?? '').trim().toUpperCase();
    if (!s || order.has(s)) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const out = new Map<string, PhotoSuspect[]>();
  for (const [readSku, count] of counts) {
    for (const sku of orderSkus) {
      const positions = skuDiffPositions(sku, readSku);
      if (!positions) continue;
      out.set(sku, [...(out.get(sku) ?? []), { readSku, count, positions }]);
    }
  }
  return out;
}
