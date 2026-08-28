/**
 * The e-bike as Audit Source wants it: its own carton, outside the pallet.
 *
 * Audit Source — where a regular load is quoted, the carrier chosen and the
 * tracking number made — asks for a battery bike to be declared as a separate
 * carton even when it physically rides inside the pallet (Rafael, 2026-08-27,
 * idea-167). The station needs, per electric SKU on the order: what it is,
 * how many, what one weighs, and the carton size. This module turns the
 * electric lines the Ship screen already finds (utils/electricBikes.ts) plus
 * the catalog row into that, and into the text the copy button hands over.
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
  units: number;
  /** One bike's weight, or null when nothing is on file. */
  weightLbs: number | null;
  /** Only a measured carton (dimensions_verified) — a default is not a size. */
  dims: CartonDims | null;
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
      units: line.units,
      weightLbs: meta?.weight_lbs ?? null,
      dims,
    };
  });
}

/** `55×30×8` — the way the floor sheets write a carton (L × H × W). */
export function formatCartonDims(dims: CartonDims): string {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
  return `${n(dims.length)}×${n(dims.height)}×${n(dims.width)}`;
}

/** What the station reads on screen, one part per field so a missing one can glow amber. */
export function electricCartonParts(c: ElectricCarton): {
  what: string;
  weight: string | null;
  dims: string | null;
} {
  return {
    what: `${c.units} × ${c.name ?? c.sku}`,
    weight: c.weightLbs == null ? null : `${c.weightLbs} lb`,
    dims: c.dims ? `${formatCartonDims(c.dims)} in` : null,
  };
}

/** What the copy button hands to Audit Source — everything it could ask, in one line. */
export function electricCartonClipboard(c: ElectricCarton): string {
  const weight = c.weightLbs == null ? 'weight ?' : `${c.weightLbs} lb each`;
  const dims = c.dims ? `${formatCartonDims(c.dims)} in` : 'size ?';
  return `E-BIKE (lithium battery) — separate carton: ${c.name ?? c.sku} ${c.sku} × ${c.units}, ${weight}, ${dims}`;
}

export function totalElectricCartonUnits(cartons: readonly ElectricCarton[]): number {
  return cartons.reduce((sum, c) => sum + c.units, 0);
}
