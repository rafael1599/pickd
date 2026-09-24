import {
  BIKES_PER_STRAPPED_PALLET,
  calculateStrappedPallets,
  compareLocations,
} from './strappedPalletDistribution';

/**
 * Una fila de `get_container_report`: lo que trae el container y lo que Ludlow
 * tiene de ese SKU. Si el container ya llegó, Ludlow es el último daily
 * snapshot tomado antes de la llegada (el stock de hoy ya incluye sus propias
 * bicis); si todavía viene, es el stock de ahora.
 */
export interface ContainerReportSourceRow {
  sku: string;
  arrived: number;
  is_bike: boolean;
  ludlow_qty: number;
  ludlow_locations: unknown;
  ludlow_source: string;
  snapshot_date: string | null;
  snapshot_taken_at: string | null;
  first_registered_at: string | null;
  arrived_at: string | null;
}

export interface ContainerReportRow {
  sku: string;
  arrived: number;
  isBike: boolean;
  ludlowQty: number;
  /** "ROW 23 C (16), ROW 37 (1)", o "—". La letra sólo si el snapshot la guardó. */
  locLabel: string;
  /** Primera ubicación, para ordenar por LOC */
  firstLocation: string | null;
  /** Strapped pallets para lo que llegó (@12). Las partes no van en pallet. */
  dist: number;
  /** Lo que llegó + lo que Ludlow ya tenía. */
  total: number;
}

export interface ContainerReport {
  rows: ContainerReportRow[];
  /** 'live' si el container todavía viene: Ludlow es el stock de ahora. */
  ludlowSource: 'snapshot' | 'live';
  arrivedAt: string | null;
  snapshotDate: string | null;
  snapshotTakenAt: string | null;
  firstRegisteredAt: string | null;
}

interface LocQty {
  location: string;
  sublocations: string[];
  qty: number;
}

function readLocations(raw: unknown): LocQty[] {
  if (!Array.isArray(raw)) return [];
  const out: LocQty[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { location, sublocation, qty } = item as {
      location?: unknown;
      sublocation?: unknown;
      qty?: unknown;
    };
    const n = Number(qty);
    if (typeof location !== 'string' || !location.trim() || !Number.isFinite(n) || n <= 0) continue;
    const sublocations = Array.isArray(sublocation)
      ? sublocation
          .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          .map((x) => x.trim().toUpperCase())
          .sort()
      : [];
    out.push({ location: location.trim().toUpperCase(), sublocations, qty: n });
  }
  return out.sort((a, b) => compareLocations(a.location, b.location));
}

export function toContainerReport(source: ContainerReportSourceRow[]): ContainerReport {
  const rows = source.map((r): ContainerReportRow => {
    const arrived = Math.max(0, Number(r.arrived) || 0);
    const ludlowQty = Math.max(0, Number(r.ludlow_qty) || 0);
    const locs = readLocations(r.ludlow_locations);
    return {
      sku: r.sku,
      arrived,
      isBike: r.is_bike,
      ludlowQty,
      locLabel:
        locs.length > 0
          ? locs
              .map((l) =>
                l.sublocations.length > 0
                  ? `${l.location} ${l.sublocations.join(',')} (${l.qty})`
                  : `${l.location} (${l.qty})`
              )
              .join(', ')
          : '—',
      firstLocation: locs[0]?.location ?? null,
      dist: r.is_bike ? calculateStrappedPallets(arrived, BIKES_PER_STRAPPED_PALLET) : 0,
      total: arrived + ludlowQty,
    };
  });

  const first = source[0];
  return {
    rows,
    ludlowSource: first?.ludlow_source === 'live' ? 'live' : 'snapshot',
    arrivedAt: first?.arrived_at ?? null,
    snapshotDate: first?.snapshot_date ?? null,
    snapshotTakenAt: first?.snapshot_taken_at ?? null,
    firstRegisteredAt: first?.first_registered_at ?? null,
  };
}

export function summarizeContainerReport(rows: ContainerReportRow[]) {
  return {
    skus: rows.length,
    pallets: rows.reduce((acc, r) => acc + r.dist, 0),
  };
}
