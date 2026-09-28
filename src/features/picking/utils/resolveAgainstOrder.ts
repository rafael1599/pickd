/**
 * Lo que leyó el lector, resuelto contra las líneas de la orden (idea-238, paso 1).
 *
 * El motor lee sin saber qué se espera, y se equivoca de formas que la orden
 * delata: corta la última letra del color (`06-4588B`), duda entre dos
 * candidatos y uno es el de la orden (`CONFLICTO: 90-7290A ≠ 06-4590BL`), o
 * cambia un dígito (`03-3902BL` por `03-3982BL`). Medido el 28 sep 2026 en la
 * sombra de Double Check: 62 de 72 lecturas exactas; con esta resolución, 71.
 *
 * **Nunca fabrica un verde falso.** Resolver es decir «esta caja es de la
 * orden», así que sólo se hace cuando la lectura **no es un SKU real** del
 * catálogo: si el picker puso `03-3980BL` y la orden pide `03-3982BL`, la
 * lectura `03-3980BL` existe, es otra bici y se queda como está. Y sólo cuando
 * el candidato de la orden es **uno**: dos posibles es no saber.
 *
 * Pura. La lectura cruda no se toca — quien la guarda guarda las dos, para
 * que la medición del motor siga siendo comparable.
 */
import { normalizeSkuOnRegister } from '../../../utils/skuNormalize';

/** Cómo se llegó al SKU de la orden. */
export type Resolution = 'exact' | 'conflict' | 'truncated' | 'one_char';

export interface ResolvedRead {
  /** El SKU de la orden, tal como lo escribe la orden. */
  sku: string;
  how: Resolution;
}

/** La clave con la que se comparan: la de `dcv_sku_key` en SQL (canónico, A-Z0-9). */
export function skuKey(sku: string | null | undefined): string {
  if (!sku) return '';
  return normalizeSkuOnRegister(sku)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Cuántas letras de color puede perder una lectura cortada. */
const MAX_TRUNCATED = 2;
/** Una lectura más corta que esto no se resuelve por un carácter: es ruido. */
const MIN_KEY_FOR_ONE_CHAR = 7;

/** Distancia de edición ≤ 1 (cambiar, quitar o poner un carácter). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Los candidatos de una lectura: uno, o los de un `CONFLICTO: A ≠ B`. */
function candidatesOf(read: string): { keys: string[]; conflict: boolean } {
  const m = /^CONFLICTO:\s*(.+)$/i.exec(read.trim());
  if (!m) return { keys: [skuKey(read)].filter(Boolean), conflict: false };
  return {
    keys: m[1]
      .split('≠')
      .map((c) => skuKey(c.trim()))
      .filter(Boolean),
    conflict: true,
  };
}

/**
 * Resuelve una lectura contra los SKU de la orden. `isCatalogSku` dice si una
 * clave existe en el catálogo; sin él no se resuelve nada que no sea exacto,
 * porque no se puede descartar que la lectura sea otra bici de verdad.
 */
export function resolveAgainstOrder(
  read: string | null | undefined,
  orderSkus: readonly string[],
  isCatalogSku?: (key: string) => boolean
): ResolvedRead | null {
  if (!read) return null;
  const byKey = new Map<string, string>();
  for (const sku of orderSkus) {
    const key = skuKey(sku);
    if (key && !byKey.has(key)) byKey.set(key, sku);
  }
  if (byKey.size === 0) return null;
  const { keys, conflict } = candidatesOf(read);
  if (keys.length === 0) return null;

  // 1. Exacta (o, en un conflicto, un solo candidato que es de la orden).
  const exact = [...new Set(keys.filter((k) => byKey.has(k)))];
  if (exact.length === 1) {
    return { sku: byKey.get(exact[0])!, how: conflict ? 'conflict' : 'exact' };
  }
  if (exact.length > 1) return null;
  if (!isCatalogSku) return null;

  // Lo que sigue es aproximado: una lectura que es un SKU real es otra bici.
  const unknown = keys.filter((k) => !isCatalogSku(k));
  if (unknown.length !== keys.length) return null;

  const unique = (matches: string[]) => {
    const found = [...new Set(matches)];
    return found.length === 1 ? found[0] : null;
  };
  const orderKeys = [...byKey.keys()];

  // 2. Cortada: la orden empieza por lo leído y le faltan 1–2 letras de color.
  const cut = unique(
    keys.flatMap((k) =>
      orderKeys.filter(
        (o) => o.length > k.length && o.length - k.length <= MAX_TRUNCATED && o.startsWith(k)
      )
    )
  );
  if (cut) return { sku: byKey.get(cut)!, how: 'truncated' };

  // 3. Un carácter distinto, en lecturas con cuerpo de SKU.
  const near = unique(
    keys
      .filter((k) => k.length >= MIN_KEY_FOR_ONE_CHAR)
      .flatMap((k) => orderKeys.filter((o) => withinOneEdit(k, o)))
  );
  if (near) return { sku: byKey.get(near)!, how: 'one_char' };

  return null;
}
