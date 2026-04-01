import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';

export interface SimilarSku {
  sku: string;
  item_name: string | null;
  location: string | null;
  quantity: number;
  matchType: 'prefix' | 'name';
}

/**
 * Regex to parse bike-style SKUs: "03-4614BK" → prefix="03-4614", suffix="BK"
 * Matches: 2 digits, dash, 4 digits, then 2+ alpha chars as color suffix.
 */
const BIKE_SKU_RE = /^(\d{2}-\d{4})([A-Za-z]{2,})$/;

/** Words filtered out when comparing item names (colors, sizes, noise) */
const NOISE_WORDS = new Set([
  'gloss',
  'matte',
  'satin',
  'black',
  'white',
  'red',
  'blue',
  'green',
  'grey',
  'gray',
  'charcoal',
  'sandstone',
  'drab',
  'olive',
  'dusk',
  'winter',
  'clay',
  'adobe',
  'mint',
  'teal',
  'pink',
  'yellow',
  'purple',
  'orange',
  'brown',
  'pearl',
  'garnet',
  'riptide',
  'mash',
  'storm',
  'kinetic',
  'vanilla',
  'nile',
  'orchard',
  'radiant',
  'sugar',
  'thunder',
  'deep',
  'hot',
  'sky',
  'oxblood',
  // Sizes (wheel, frame)
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '24',
  '26',
  '27',
  '27.5',
  '29',
  '48',
  '51',
  '54',
  '56',
  '58',
  '61',
  // Year tokens
  '2024',
  '2025',
  '2026',
  // Generic noise
  's/t',
  's/o',
  'step-thru',
  'v2',
]);

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\w\s./'-]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NOISE_WORDS.has(t));
}

/**
 * Find up to `limit` similar SKUs from inventory for a given target SKU.
 *
 * Matching priority:
 * 1. Prefix match (same model, different color suffix) — score 100
 * 2. Name match (2+ shared leading tokens in item_name) — score by overlap
 *
 * Filters: same warehouse, different SKU, quantity > 0.
 */
export function findSimilarSkus(
  targetSku: string,
  targetWarehouse: string,
  inventoryData: InventoryItemWithMetadata[],
  limit = 3
): SimilarSku[] {
  if (!targetSku || !inventoryData || limit <= 0) return [];

  const prefixMatch = BIKE_SKU_RE.exec(targetSku);
  const targetPrefix = prefixMatch?.[1] ?? null;

  // Find target's item_name for name-based matching
  const targetItem = inventoryData.find(
    (i) => i.sku === targetSku && i.warehouse === targetWarehouse
  );
  const targetTokens = targetItem?.item_name ? tokenize(targetItem.item_name) : [];

  // Also try to find name from any warehouse if not found in target warehouse
  const fallbackItem =
    !targetItem && inventoryData.find((i) => i.sku === targetSku)?.item_name
      ? inventoryData.find((i) => i.sku === targetSku)
      : null;
  const fallbackTokens = fallbackItem?.item_name ? tokenize(fallbackItem.item_name) : [];
  const nameTokens = targetTokens.length > 0 ? targetTokens : fallbackTokens;

  type Scored = SimilarSku & { _score: number };
  const candidates: Scored[] = [];
  const seen = new Set<string>();

  for (const item of inventoryData) {
    if (item.sku === targetSku) continue;
    if (item.warehouse !== targetWarehouse) continue;
    if (!item.quantity || item.quantity <= 0) continue;
    if (seen.has(item.sku)) continue;
    seen.add(item.sku);

    let score = 0;
    let matchType: 'prefix' | 'name' = 'name';

    // Priority 1: Prefix match (same model, different color)
    if (targetPrefix) {
      const candidateMatch = BIKE_SKU_RE.exec(item.sku);
      if (candidateMatch?.[1] === targetPrefix) {
        score = 100;
        matchType = 'prefix';
      }
    }

    // Priority 2: Name token match (if no prefix match)
    if (score === 0 && nameTokens.length >= 2 && item.item_name) {
      const itemTokens = tokenize(item.item_name);
      // Count shared leading tokens
      let shared = 0;
      for (let i = 0; i < Math.min(nameTokens.length, itemTokens.length); i++) {
        if (nameTokens[i] === itemTokens[i]) shared++;
        else break;
      }
      if (shared >= 2) {
        score = shared * 10;
        matchType = 'name';
      }
    }

    if (score > 0) {
      candidates.push({
        sku: item.sku,
        item_name: item.item_name ?? null,
        location: item.location ?? null,
        quantity: item.quantity,
        matchType,
        _score: score,
      });
    }
  }

  // Sort by score descending, then by quantity descending as tiebreaker
  candidates.sort((a, b) => b._score - a._score || b.quantity - a.quantity);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return candidates.slice(0, limit).map(({ _score, ...rest }) => rest);
}
