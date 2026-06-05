/**
 * Refined search for consolidation candidates.
 *
 * Behavior:
 * - Empty / whitespace query → returns the input unchanged.
 * - Query is lower-cased and split on whitespace into tokens.
 *   Every token must match SOMETHING in the candidate (AND semantics).
 *   Match fields: sku, item_name, source_row, sublocation (joined with +),
 *   and any name in the alias_chain (so a search for the OLD SKU surfaces
 *   the current row).
 * - Ranking (applied only when there is a query):
 *     1. Exact SKU match (case-insensitive) on any alias in the chain.
 *     2. SKU starts-with (any alias).
 *     3. SKU contains.
 *     4. Everything else (matched only via name / row / sublocation).
 *   Within a rank tier, original order is preserved (stable sort).
 *
 * This is a pure function so it can be unit-tested without DOM / network.
 */

export interface SearchableCandidate {
  sku: string;
  item_name?: string | null;
  source_row?: string | null;
  sublocation?: string[] | null;
  alias_chain?: string[] | null;
}

interface RankedCandidate<C extends SearchableCandidate> {
  c: C;
  rank: number;
  idx: number;
}

const RANK_EXACT_SKU = 0;
const RANK_SKU_STARTS = 1;
const RANK_SKU_CONTAINS = 2;
const RANK_OTHER_FIELD = 3;

function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase();
}

/** Dash-insensitive form: drop hyphens so "033768BL" matches "03-3768BL". */
function stripDash(s: string): string {
  return s.replace(/-/g, '');
}

function buildHaystack(c: SearchableCandidate): string {
  const parts: string[] = [c.sku];
  if (c.item_name) parts.push(c.item_name);
  if (c.source_row) parts.push(c.source_row);
  if (c.sublocation && c.sublocation.length > 0) parts.push(c.sublocation.join('+'));
  if (c.alias_chain && c.alias_chain.length > 0) {
    for (const a of c.alias_chain) {
      if (a && a !== c.sku) parts.push(a);
    }
  }
  return parts.join(' ').toLowerCase();
}

function rankFor(c: SearchableCandidate, query: string): number {
  const q = query.toLowerCase();
  const qd = stripDash(q);
  const aliases = [c.sku, ...(c.alias_chain ?? [])].filter(Boolean).map((s) => s.toLowerCase());
  const aliasesD = aliases.map(stripDash);
  if (aliases.some((a) => a === q) || aliasesD.some((a) => a === qd)) return RANK_EXACT_SKU;
  if (aliases.some((a) => a.startsWith(q)) || aliasesD.some((a) => a.startsWith(qd)))
    return RANK_SKU_STARTS;
  if (aliases.some((a) => a.includes(q)) || aliasesD.some((a) => a.includes(qd)))
    return RANK_SKU_CONTAINS;
  return RANK_OTHER_FIELD;
}

/**
 * Filter + rank candidates by a free-text query.
 * Returns a new array. Original input is never mutated.
 */
export function searchCandidates<C extends SearchableCandidate>(
  candidates: C[],
  query: string
): C[] {
  const trimmed = (query ?? '').trim();
  if (!trimmed) return candidates;

  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return candidates;

  const ranked: RankedCandidate<C>[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const haystack = buildHaystack(c);
    const haystackD = stripDash(haystack);
    // A token matches if it's a substring of the haystack, OR — ignoring
    // hyphens on both sides — of the dash-stripped haystack. So "033768BL"
    // finds "03-3768BL" even without the dash.
    const allMatch = tokens.every((t) => haystack.includes(t) || haystackD.includes(stripDash(t)));
    if (!allMatch) continue;
    // Rank by the whole query (joined) so "TAXI 26" ranks by both tokens.
    ranked.push({ c, rank: rankFor(c, normalize(trimmed)), idx: i });
  }

  ranked.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  return ranked.map((r) => r.c);
}
