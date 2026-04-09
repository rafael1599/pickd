/**
 * Parses a JAMIS bike item_name into structured parts.
 * Display helper only — NOT a source of truth for critical data.
 *
 * Known patterns:
 *   "FAULTLINE A1 V2 15 2026 GLOSS BLACK" → model=FAULTLINE A1 V2, size=15, year=2026, color=GLOSS BLACK
 *   "EC1 18 2025 KINETIC GREY"            → model=EC1, size=18, year=2025, color=KINETIC GREY
 *   "HELIX A2 16 2025 SUGAR MINT"         → model=HELIX A2, size=16, year=2025, color=SUGAR MINT
 */

export interface BikeNameParts {
  model: string;
  size: string;
  year: string;
  color: string;
  raw: string;
}

export function parseBikeName(itemName: string | null | undefined): BikeNameParts {
  const raw = (itemName ?? '').trim();
  const fallback: BikeNameParts = { model: raw, size: '', year: '', color: '', raw };

  if (!raw) return fallback;

  const tokens = raw.split(/\s+/);
  if (tokens.length < 3) return fallback;

  // Find year: 4-digit number starting with 20
  let yearIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^20\d{2}$/.test(tokens[i])) {
      yearIdx = i;
      break;
    }
  }
  if (yearIdx === -1) return fallback;

  // Size: the numeric token immediately before year
  const sizeIdx = yearIdx - 1;
  if (sizeIdx < 0 || !/^\d{1,2}$/.test(tokens[sizeIdx])) return fallback;

  const model = tokens.slice(0, sizeIdx).join(' ');
  const size = tokens[sizeIdx];
  const year = tokens[yearIdx];
  const color = tokens.slice(yearIdx + 1).join(' ');

  if (!model) return fallback;

  return { model, size, year, color, raw };
}
