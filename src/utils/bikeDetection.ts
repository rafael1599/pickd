/**
 * Canonical bike detection helper.
 * `sku_metadata.is_bike` in the database is the SOLE source of truth.
 *
 * Fallback for a SKU the catalog does not know (`is_bike` null/undefined): the
 * Jamis line prefix, the same rule the database applies when it creates the row
 * (`LEFT(sku, 2) IN ('01','02','03','06','07')`, tr_sku_metadata trigger and
 * stamp_item_sku_metadata), then weight (`>= 15` lb, boxed bikes weigh 25–50+).
 * Without the prefix an unregistered scratch-and-dent bike (`01-0531`,
 * order 881701, 24 sep 2026) left the pallet as a part.
 */
export const BIKE_SKU_PREFIXES = ['01', '02', '03', '06', '07'] as const;

function hasBikePrefix(sku: string | undefined): boolean {
  const prefix = (sku ?? '').trim().slice(0, 2);
  return (BIKE_SKU_PREFIXES as readonly string[]).includes(prefix);
}

export function isBikeSku(
  skuOrObj?:
    | string
    | {
        sku?: string;
        is_bike?: boolean | null;
        weight_lbs?: number | null;
        sku_metadata?: { is_bike?: boolean | null; weight_lbs?: number | null } | null;
      }
    | null,
  skuMetadata?: { is_bike?: boolean | null; weight_lbs?: number | null } | null
): boolean {
  if (!skuOrObj) return false;

  let isBikeFlag: boolean | null | undefined;
  let weightLbs: number | null | undefined;
  const sku = typeof skuOrObj === 'string' ? skuOrObj : skuOrObj.sku;

  if (typeof skuOrObj === 'string') {
    isBikeFlag = skuMetadata?.is_bike;
    weightLbs = skuMetadata?.weight_lbs;
  } else if (typeof skuOrObj === 'object') {
    if ('sku_metadata' in skuOrObj && skuOrObj.sku_metadata) {
      isBikeFlag = skuOrObj.sku_metadata.is_bike;
      weightLbs = skuOrObj.sku_metadata.weight_lbs;
    } else {
      isBikeFlag = skuOrObj.is_bike;
      weightLbs = skuOrObj.weight_lbs;
    }
    if (isBikeFlag === undefined && skuMetadata?.is_bike !== undefined) {
      isBikeFlag = skuMetadata.is_bike;
    }
    if (weightLbs === undefined && skuMetadata?.weight_lbs !== undefined) {
      weightLbs = skuMetadata.weight_lbs;
    }
  }

  // 1. Explicit DB flag in sku_metadata is the SOLE canonical source of truth
  if (isBikeFlag === true) return true;
  if (isBikeFlag === false) return false;

  // 2. Fallback ONLY for uncataloged items (is_bike null/undefined): the line
  // prefix the DB would stamp, then boxed bicycles weigh >= 15 lbs.
  if (hasBikePrefix(sku)) return true;
  if (typeof weightLbs === 'number' && weightLbs >= 15) return true;

  return false;
}

/**
 * Una bici de línea juvenil o de rueda chica.
 *
 * No es un juicio sobre el peso ni sobre la talla del cuadro: es la línea de
 * producto. El cartón lo confirma — con dimensiones verificadas, las 14 bicis
 * con caja de 26" de alto o menos son exactamente éstas, y ninguna adulta baja
 * de 27" — pero el peso no sirve de criterio y por eso no se usa: la Ventura
 * A1 y la Renegade C1 pesan 31–33 lb, menos que una CAPRI 2.4, y son bicis de
 * carretera de caja entera.
 *
 * Las señales, en orden de cobertura real (15 sep 2026, 39 SKUs / 1.202 u):
 *   - **Prefijo `07-`**: el código de línea juvenil de Jamis. 27 SKUs, 1.001
 *     unidades — la señal que de verdad pesa, y la única que llega gratis con
 *     cada SKU nuevo que cree el registrador o el escáner del AS400.
 *   - **`JUV` al principio** de la descripción del AS400 o del modelo: recoge
 *     la juvenil que quedó fuera del prefijo (`02-3683GN`).
 *   - **Taxi de rueda 16/20/24**: la Taxi 26" es adulta (caja de 28–30"), la
 *     de 24" no (25–25.5"). 5 SKUs, 198 unidades.
 *   - **Nombre de modelo juvenil** para las filas viejas escaneadas sin número
 *     de Jamis: `Starlite`, `XR.20`, `XR.24`.
 *
 * **Sólo tiene sentido preguntárselo a una bici.** El catálogo de partes está
 * lleno de `JRP GRIP LASER 2.0`, `JRP PEDAL CAPRI 2.4` y `JRP GRIP STARLITE`:
 * 30 partes contestarían que sí. Quien llame a esto cruza el resultado con el
 * conjunto de bicis — {@link resolveBikeSets} lo hace por dentro.
 */
export function isSmallBikeSku(
  skuOrRow?:
    | string
    | { sku?: string; model?: string | null; as400_description?: string | null }
    | null,
  meta?: { model?: string | null; as400_description?: string | null } | null
): boolean {
  if (!skuOrRow) return false;

  const sku = (typeof skuOrRow === 'string' ? skuOrRow : (skuOrRow.sku ?? '')).trim().toUpperCase();
  const row = typeof skuOrRow === 'string' ? meta : skuOrRow;
  const model = (row?.model ?? meta?.model ?? '').trim();
  const desc = (row?.as400_description ?? meta?.as400_description ?? '').trim();

  // El código de línea de Jamis. Vale por sí solo y sin ficha: un `07-` recién
  // creado ya se sabe juvenil antes de que el escáner lo lea.
  if (sku.startsWith('07-')) return true;

  const text = `${model} ${desc}`;
  if (/^\s*JUV\b/i.test(model) || /^\s*JUV\b/i.test(desc)) return true;

  // La rueda tiene que ir pegada a TAXI: `TAXI 26" S/O 18` no es chica.
  if (/\bTAXI\s*(?:10X)?(?:16|20|24)\b/i.test(text)) return true;

  // Modelos juveniles escritos sin el `JUV` delante (filas escaneadas viejas).
  // `XR.20` lleva punto a propósito: `TRAIL XR S/O 20` es una bici adulta.
  if (/\b(?:STARLITE|MISS\s*DAISY|CRITTER|HOT\s*ROD|CAPRI|LASER)\b/i.test(text)) return true;
  if (/\bXR?\.\d{2}\b/i.test(text)) return true;

  return false;
}

/** Las ruedas de la línea juvenil de Jamis. */
const KIDS_WHEELS = new Set([12, 14, 16, 20, 24, 26]);

const asWheel = (value: string | undefined): number | null => {
  const n = Number(value);
  return KIDS_WHEELS.has(n) ? n : null;
};

/** La rueda que nombra un texto de modelo o de AS400, o `null`. */
function wheelInText(text: string): number | null {
  // LASER 1.6 / 2.0, CAPRI 2.4: el nombre ES la rueda con un punto en medio.
  const dotted = text.match(/\b([12])\.([046])\b/);
  if (dotted) return asWheel(`${dotted[1]}${dotted[2]}`);
  // XR.20, XR24, X.24 DISC, X20.
  const xr = text.match(/\bXR?\.?(\d{2})\b/i);
  if (xr) return asWheel(xr[1]);
  // TAXI 24, TAXI 10X20 (cuadro × rueda).
  const taxi = text.match(/\bTAXI\s*(?:\d{2}X)?(\d{2})\b/i);
  if (taxi) return asWheel(taxi[1]);
  // JUV CRITTER 12.
  const critter = text.match(/\bCRITTER\s+(\d{2})\b/i);
  if (critter) return asWheel(critter[1]);
  return null;
}

/**
 * La rueda de una bici de niño, en pulgadas, o `null` si no se sabe.
 *
 * Es el respaldo con el que se ordena una tarima de niño cuando alguna caja no
 * está medida (Rafael, 29 sep 2026: «ordenar por rueda como fallback»): sin
 * medir, la caja lleva el default de adulto (55 × 8.5 × 30.5) y por volumen
 * salía la más grande — una LASER 1.6 abajo de una CAPRI 2.4.
 *
 * Primero el modelo, luego la talla en par (`8"×16"`, `26"×13"`: la rueda es la
 * mayor de las dos) y al final la descripción del AS400. **Una talla sola no
 * cuenta**: en `JUV XR.26 S/O` el `12"` es el cuadro, no la rueda.
 */
export function kidsWheelInches(
  meta?: { model?: string | null; size?: string | null; as400_description?: string | null } | null
): number | null {
  if (!meta) return null;
  const fromModel = wheelInText(meta.model ?? '');
  if (fromModel != null) return fromModel;
  const pair = (meta.size ?? '').match(/^\s*(\d{1,2})"?\s*[×xX*]\s*(\d{1,2})"?\s*$/);
  if (pair) {
    const wheel = asWheel(String(Math.max(Number(pair[1]), Number(pair[2]))));
    if (wheel != null) return wheel;
  }
  return wheelInText(meta.as400_description ?? '');
}
