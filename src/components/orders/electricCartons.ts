/**
 * The e-bike as Audit Source (or FedEx) wants it: its own carton, outside the
 * pallet — shown in Ship the way the four big numbers are shown.
 *
 * Audit Source — where a regular load is quoted, the carrier chosen and the
 * tracking number made — asks for a battery bike to be declared as a separate
 * carton even when it physically rides inside the pallet (Rafael, 2026-08-27,
 * idea-167). The station wants figures, not a sentence: "1 carton, 1 Hudson
 * E1, 78.6 lbs" — and on a FedEx order the carton size too, same shape. This
 * module turns the electric lines Ship already finds (utils/electricBikes.ts)
 * plus the catalog row into those figures and into the copy-button text.
 *
 * Pallets and total weight are NOT touched: the carton is declared in
 * addition to the pallet, the load's totals stay the load's totals (PRD Q2).
 */
import type { ElectricBikeLine } from '../../utils/electricBikes';

export interface ElectricCartonMeta {
  weight_lbs?: number | null;
  length_in?: number | null;
  width_in?: number | null;
  height_in?: number | null;
  dimensions_verified?: boolean | null;
  /** sku_metadata.model — "HUDSON E2 S/T" when split, the whole name when not. */
  model?: string | null;
}

export interface CartonDims {
  /** Longest side. */
  length: number;
  /** Middle side — Pickd keeps it in height_in (see CLAUDE.md, FedEx export). */
  height: number;
  /** Thinnest side — width_in. */
  width: number;
}

export interface ElectricCarton {
  sku: string;
  name: string | null;
  /** "HUDSON E2" — what the station calls the bike, nothing more. */
  model: string;
  units: number;
  /** One bike's weight, or null when nothing is on file. */
  weightLbs: number | null;
  /** Only a measured carton (dimensions_verified) — a default is not a size. */
  dims: CartonDims | null;
}

/**
 * "HUDSON E2" out of "HUDSON E2 S/T 14 2026 THUNDER" or "Hudson E1 Step-Over
 * 18 Vanilla": the model up to its generation token, which is how JAMIS names
 * the electric line and how the floor says it. Falls back to the catalog model,
 * then the first two words of the name, then the SKU.
 */
export function shortElectricModel(
  name: string | null | undefined,
  model: string | null | undefined,
  sku: string
): string {
  for (const source of [model, name]) {
    const text = (source ?? '').trim();
    if (!text) continue;
    const m = /^(.*?\bE-?\d)(?![A-Z0-9])/i.exec(text);
    if (m) return m[1].toUpperCase();
  }
  const fallback = (model ?? name ?? '').trim();
  if (fallback) return fallback.split(/\s+/).slice(0, 2).join(' ').toUpperCase();
  return sku;
}

export function buildElectricCartons(
  lines: readonly ElectricBikeLine[],
  metaFor: (sku: string) => ElectricCartonMeta | undefined
): ElectricCarton[] {
  return lines.map((line) => {
    const meta = metaFor(line.sku);
    const l = meta?.length_in ?? 0;
    const h = meta?.height_in ?? 0;
    const w = meta?.width_in ?? 0;
    const dims =
      meta?.dimensions_verified && l > 0 && h > 0 && w > 0
        ? { length: l, height: h, width: w }
        : null;
    return {
      sku: line.sku,
      name: line.name,
      model: shortElectricModel(line.name, meta?.model, line.sku),
      units: line.units,
      weightLbs: meta?.weight_lbs ?? null,
      dims,
    };
  });
}

/** 80 → "80", 78.6 → "78.6", 54.23 → "54.2". */
export function formatLbs(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : String(Math.round(weight * 10) / 10);
}

/**
 * "57×37×10" — whole inches, rounded UP, the same carton FedEx already holds
 * from the Dimensions export (buildFedexDimensions ceils too): a carton is
 * never declared smaller than it is. L × H × W, the way the floor writes it.
 */
export function formatCartonDims(dims: CartonDims): string {
  return `${Math.ceil(dims.length)}×${Math.ceil(dims.height)}×${Math.ceil(dims.width)}`;
}

/** "1 carton, 1 HUDSON E2, 80 lbs" — plus ", 57×37×10 in" when the carrier wants the size. */
export function electricCartonClipboard(c: ElectricCarton, withDims: boolean): string {
  const cartons = `${c.units} ${c.units === 1 ? 'carton' : 'cartons'}`;
  const what = `${c.units} ${c.model}`;
  const weight =
    c.weightLbs == null ? 'weight ?' : `${formatLbs(c.weightLbs)} lbs${c.units > 1 ? ' each' : ''}`;
  const parts = [cartons, what, weight];
  if (withDims) parts.push(c.dims ? `${formatCartonDims(c.dims)} in` : 'size ?');
  return parts.join(', ');
}

export function totalElectricCartonUnits(cartons: readonly ElectricCarton[]): number {
  return cartons.reduce((sum, c) => sum + c.units, 0);
}
