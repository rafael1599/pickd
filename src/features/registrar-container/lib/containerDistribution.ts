// Towers / Lines breakdown — Rafael's warehouse rule.
//
// A LINE holds up to 5 units. A group of 18 or more units is counted as a
// full TOWER (a tower is ~30). So: take whole towers of 30; if the remainder
// is >= 18 it rounds up to one more tower, otherwise it's expressed as lines
// of 5 (rounded up).
//
// NOTE: this differs from the global src/utils/distributionCalculator.ts
// (which is floor-based 30/5). This rule is specific to how containers are
// counted/consolidated on the floor. Validated against:
//   59 -> 2T   28 -> 1T   41 -> 1T 3L   3 -> 1L   168 -> 6T   109 -> 4T

export interface TowersLines {
  towers: number;
  lines: number;
}

export function containerDistribution(qty: number): TowersLines {
  if (!Number.isFinite(qty) || qty <= 0) return { towers: 0, lines: 0 };
  let towers = Math.floor(qty / 30);
  let rem = qty % 30;
  if (rem >= 18) {
    towers += 1;
    rem = 0;
  }
  const lines = rem > 0 ? Math.ceil(rem / 5) : 0;
  return { towers, lines };
}

/** "2T", "1T 3L", "3L", or "—" for zero. */
export function formatTowersLines(qty: number): string {
  const { towers, lines } = containerDistribution(qty);
  const parts: string[] = [];
  if (towers) parts.push(`${towers}T`);
  if (lines) parts.push(`${lines}L`);
  return parts.length ? parts.join(' ') : '—';
}
