/**
 * The photo-first Stock card (docs/prds/stock-card-photo-first.md, Rafael's
 * choice C, 6 Oct 2026): the pure half — what the compact distribution draws
 * and which picture the photo column loads.
 */
import type { DistributionItem } from '../../../schemas/inventory.schema';

export interface DistributionGroup {
  type: DistributionItem['type'];
  /** How many of them… */
  count: number;
  /** …of how many units each: drawn «count × unitsEach». */
  unitsEach: number;
}

// A DS reads base then top; then line pallets, then the old kinds.
const TYPE_RANK: Record<string, number> = {
  BASE: 0,
  TOP: 1,
  LINE_PALLET: 2,
  TOWER: 3,
  LINE: 4,
};

/**
 * One drawing per kind of box with the same units each (Rafael's sketch: four
 * towers of 30 are one tower, «4 × 30»; a line of 5 and a line of 2 stay two).
 * Nothing when one unit is left: «para las bicicletas de las cuales solo queda
 * una unidad no vale la pena usar el espacio».
 */
export function compactDistribution(
  distribution: DistributionItem[] | null | undefined,
  quantity: number
): DistributionGroup[] {
  if (!(quantity > 1) || !distribution?.length) return [];
  const byKey = new Map<string, DistributionGroup>();
  for (const d of distribution) {
    const count = Math.trunc(Number(d.count) || 0);
    const unitsEach = Math.trunc(Number(d.units_each) || 0);
    if (count <= 0 || unitsEach <= 0) continue;
    const key = `${d.type}:${unitsEach}`;
    const prev = byKey.get(key);
    byKey.set(key, { type: d.type, unitsEach, count: (prev?.count ?? 0) + count });
  }
  return [...byKey.values()].sort(
    (a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) || b.unitsEach - a.unitsEach
  );
}

/**
 * The small picture of a SKU for a card. A catalogue image has its thumb under
 * `/catalog/thumbs/` as webp, a unit's photo under `/photos/thumbs/`, keeping
 * its `?v=` (CLAUDE.md, «image_url lleva versión»). A URL that already is a
 * thumb — a FedEx label from `sku_photos`, `photos/returns/thumbs/…` — is used
 * as it is: deriving it again pointed at a file that does not exist.
 */
export function cardThumbUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.includes('/thumbs/')) return url;
  if (url.includes('/catalog/'))
    return url.replace('/catalog/', '/catalog/thumbs/').replace('.png', '.webp');
  if (url.includes('/photos/')) return url.replace('/photos/', '/photos/thumbs/');
  return url;
}
