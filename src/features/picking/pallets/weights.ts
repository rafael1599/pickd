/**
 * Los cuatro números de Ship que no son el reparto: cuántas bicis y partes, y
 * cuánto pesa la carga — lo que la estación teclea en Audit Source.
 *
 * Paso 2 de `docs/prds/ship-pallet-truth.md`: salieron de `ShipScreen` sin
 * cambiar un número (replay contra prod). Puras: reciben ya resueltos el peso y
 * la clase de cada línea, porque eso depende del catálogo cargado en pantalla.
 */
import { DECK_WEIGHT_LBS } from '../../../utils/palletDims';
import { BIKE_SKU_DEFAULTS, PART_SKU_DEFAULTS } from '../../../utils/skuDefaults';

/** Una línea de la carga, con lo que el catálogo dice de ella. */
export interface WeighedLine {
  pickingQty: number;
  /** Peso por unidad; null si nadie lo sabe (cuenta como 0, como antes). */
  weightLbs: number | null;
  isBike: boolean;
  /** Se declara como cartón aparte: cuenta como bici, no pesa en el pallet. */
  isElectric: boolean;
}

export interface UnitAverages {
  bikeUnits: number;
  electricUnits: number;
  partUnits: number;
  avgBikeWeight: number;
  avgPartWeight: number;
}

/** Media de peso de la bici cuando la carga no trae ninguna: la del catálogo. */
export const DEFAULT_AVG_BIKE_LBS = BIKE_SKU_DEFAULTS.weight_lbs;
/**
 * Media de peso de la parte cuando la carga no trae ninguna: la del catálogo,
 * 1 lb. Ship usaba 0,1 aquí mientras el catálogo decía 1 (Rafael, 26 sep 2026:
 * «unifica a 1 lb»). Sólo pesa cuando la estación teclea partes en una carga
 * sin líneas de parte.
 */
export const DEFAULT_AVG_PART_LBS = PART_SKU_DEFAULTS.weight_lbs;

/**
 * Lo que pesa de media una unidad de cada clase en esta carga. Lo leen el peso
 * total y la tabla de pallets, y tiene que ser el mismo número en los dos o la
 * suma de las filas deja de cuadrar con el WEIGHT.
 */
export function unitAverages(lines: readonly WeighedLine[]): UnitAverages {
  let bikeUnits = 0;
  let bikeWeightTotal = 0;
  let partUnits = 0;
  let partWeightTotal = 0;
  let electricUnits = 0;
  for (const line of lines) {
    const qty = line.pickingQty || 0;
    if (line.isElectric) {
      electricUnits += qty;
      continue;
    }
    const weight = line.weightLbs ?? 0;
    if (line.isBike) {
      bikeUnits += qty;
      bikeWeightTotal += weight * qty;
    } else {
      partUnits += qty;
      partWeightTotal += weight * qty;
    }
  }
  return {
    bikeUnits,
    electricUnits,
    partUnits,
    avgBikeWeight: bikeUnits > 0 ? bikeWeightTotal / bikeUnits : DEFAULT_AVG_BIKE_LBS,
    avgPartWeight: partUnits > 0 ? partWeightTotal / partUnits : DEFAULT_AVG_PART_LBS,
  };
}

/** Lo que la estación tecleó en los cuatro números (texto del campo; '' = nada). */
export interface TypedCounts {
  bikes: string;
  parts: string;
  weight: string;
}

/**
 * Bicis y partes que se enseñan: lo tecleado manda salvo con un filtro de
 * sub-orden (lo tecleado describe la combinada entera y no se puede partir).
 */
export function effectiveCounts(
  averages: UnitAverages,
  typed: Pick<TypedCounts, 'bikes' | 'parts'>,
  useTyped: boolean
) {
  const autoBikeCount = averages.bikeUnits + averages.electricUnits;
  const autoPartCount = averages.partUnits;
  return {
    autoBikeCount,
    autoPartCount,
    bikeCount: useTyped && typed.bikes !== '' ? parseInt(typed.bikes, 10) || 0 : autoBikeCount,
    partCount: useTyped && typed.parts !== '' ? parseInt(typed.parts, 10) || 0 : autoPartCount,
  };
}

/**
 * El peso de la carga: bicis por su media, partes por la suya y la madera de
 * cada pallet (no en FedEx). Las bicis tecleadas descuentan las eléctricas,
 * que pesan en su cartón.
 */
export function totalWeight(input: {
  averages: UnitAverages;
  hasLines: boolean;
  palletCount: number;
  isFedex: boolean;
  typed: Pick<TypedCounts, 'bikes' | 'parts'>;
  useTyped: boolean;
}): number {
  const { averages, hasLines, palletCount, isFedex, typed, useTyped } = input;
  const palletWeight = isFedex ? 0 : palletCount * DECK_WEIGHT_LBS;
  if (!hasLines) return Math.round(palletWeight);
  const bikesCount =
    useTyped && typed.bikes !== ''
      ? Math.max(0, (parseInt(typed.bikes, 10) || 0) - averages.electricUnits)
      : averages.bikeUnits;
  const partsCount =
    useTyped && typed.parts !== '' ? parseInt(typed.parts, 10) || 0 : averages.partUnits;
  return Math.round(
    bikesCount * averages.avgBikeWeight + partsCount * averages.avgPartWeight + palletWeight
  );
}

/** El peso que se declara: lo tecleado si es un número válido, si no el calculado. */
export function effectiveWeight(typedWeight: string, total: number, useTyped: boolean): number {
  if (!useTyped) return total;
  const trimmed = typedWeight.trim();
  if (trimmed === '') return total;
  const manual = parseFloat(trimmed);
  if (Number.isNaN(manual) || manual < 0) return total;
  return Math.round(manual);
}
