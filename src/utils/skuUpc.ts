/**
 * Aprender el UPC de un SKU sin pisar lo que el catálogo ya sabe.
 *
 * Sobrevive al escáner en vivo, que se retiró el 23 sep 2026
 * (`docs/label-recognition/08-lo-que-dejo-el-escaner-en-vivo.md`). Nació allí
 * para que una caja leída enseñara su par UPC→SKU, y resultó que el valor lo
 * produce por el otro lado: el UPC que el operador **teclea** al imprimir una
 * etiqueta ya no muere en `asset_tags`, se queda en `sku_metadata`. De las 24
 * filas del catálogo que hoy tienen UPC, ninguna la puso una cámara.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { toUpcA } from '../lib/recognition/barcodeText';
import { normalizeSkuOnRegister } from './skuNormalize';

/** Qué pasó con el intento de aprender. Cada valor es una decisión distinta. */
export type PersistUpcOutcome =
  | 'saved' // el hueco estaba vacío y ahora tiene el UPC
  | 'unchanged' // el catálogo ya decía exactamente eso
  | 'conflict' // decía otra cosa: no se pisa, lo resuelve una persona
  | 'skipped'; // faltan datos, o el SKU no está en el catálogo

/** La misma regla que `sku_key` aplica en SQL, en JS. */
const toSkuKey = (sku: string): string => sku.replace(/[^A-Z0-9]/gi, '').toUpperCase();

/**
 * Cualquier GTIN-14, EAN-13 o UPC-A a la forma UPC-12 que usa Jamis.
 * `00845436088143` → `845436088143`.
 */
export function normalizeToUpcA(text: string): string | null {
  const trimmed = text.trim();
  const upc = toUpcA(trimmed);
  if (upc) return upc;

  // toUpcA valida el dígito de control; estos tres casos son la misma cifra con
  // ceros de relleno delante, y rechazarlos por el checksum sería perder un UPC
  // que está bien escrito.
  if (trimmed.length === 14 && trimmed.startsWith('00') && /^\d{14}$/.test(trimmed)) {
    return trimmed.slice(2);
  }
  if (trimmed.length === 13 && trimmed.startsWith('0') && /^\d{13}$/.test(trimmed)) {
    return trimmed.slice(1);
  }
  if (trimmed.length === 12 && /^\d{12}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Guarda el par UPC→SKU en `sku_metadata`, **sólo sobre un hueco vacío**.
 *
 * La fila se busca por `sku_key` —la columna generada del catálogo (`upper(sku)`
 * sin nada que no sea A-Z0-9, índice único, `20260826220000`)— y no por `sku`
 * tal cual. `03-4005-MN` y `03-4005MN` son la misma bici con dos grafías, y la
 * comparación cruda las declaraba distintas: devolvía `skipped` diciendo «sin
 * fila en sku_metadata», que es exactamente lo que dice ante un SKU que de
 * verdad no existe. De ahí salió una afirmación falsa sobre el inventario
 * (bug-138, 21 sep 2026).
 */
export async function persistSkuUpcMapping(
  supabaseClient: SupabaseClient,
  sku: string,
  upc: string
): Promise<PersistUpcOutcome> {
  if (!supabaseClient || !sku || !upc) return 'skipped';
  try {
    const cleanUpc = normalizeToUpcA(upc) || upc.replace(/\D/g, '');
    const cleanSku = normalizeSkuOnRegister(sku);
    if (!cleanUpc || !cleanSku) return 'skipped';

    const lookupKey = toSkuKey(cleanSku);

    const { data: existing, error: readError } = await supabaseClient
      .from('sku_metadata')
      .select('sku, upc')
      .eq('sku_key', lookupKey)
      .maybeSingle();

    if (readError || !existing) {
      console.warn(
        '[skuUpc] SKU sin fila en sku_metadata, no se aprende:',
        `${cleanSku} (sku_key ${lookupKey})`
      );
      return 'skipped';
    }

    const storedUpc = existing.upc ? normalizeToUpcA(existing.upc) || existing.upc : null;
    if (storedUpc === cleanUpc) return 'unchanged';
    if (storedUpc) {
      console.warn(
        `[skuUpc] CONFLICTO UPC en ${cleanSku}: catálogo ${storedUpc} vs caja ${cleanUpc}. No se sobreescribe.`
      );
      return 'conflict';
    }

    // `is('upc', null)` repite la condición en el servidor: si otra sesión
    // escribió el UPC entre la lectura y esta línea, esta escritura no pega.
    const { error } = await supabaseClient
      .from('sku_metadata')
      .update({ upc: cleanUpc })
      .eq('sku_key', lookupKey)
      .is('upc', null);

    if (error) {
      console.warn('[skuUpc] No se pudo guardar UPC en sku_metadata:', error.message);
      return 'skipped';
    }
    return 'saved';
  } catch (err) {
    console.warn('[skuUpc] Error persistiendo mapeo UPC:', err);
    return 'skipped';
  }
}
