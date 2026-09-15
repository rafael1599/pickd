/**
 * Models the AS400 writes as an abbreviation, and the name Jamis prints on the
 * box. The catalogue keeps both, full name first — `EARTH CRUISER 3 EC3` — so
 * a search finds the row by either (`search_inventory_with_metadata` matches
 * `model` by substring) and the printed label reads the full model (Rafael,
 * 15 Sep 2026: "las abreviaturas quiero que se mantengan a la derecha del
 * modelo completo, ejemplo earth cruiser 3 EC3").
 *
 * BCCB is the Boss Cruiser CB (coaster brake): the name on the Jamis box and at
 * jamisbikes.com. Imported without extensions so node can load it from scripts.
 */
export const MODEL_ABBREVIATIONS: Readonly<Record<string, string>> = {
  EC1: 'EARTH CRUISER 1',
  EC2: 'EARTH CRUISER 2',
  EC3: 'EARTH CRUISER 3',
  BC7: 'BOSS CRUISER 7',
  BCCB: 'BOSS CRUISER CB',
};

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

/**
 * Put the full model in front of its abbreviation, or the abbreviation right
 * after the full model — whichever is missing. Idempotent, and anything that
 * does not start with a known model comes back untouched.
 *
 *   "EC3 21 2026 GLOSS BLACK"   → "EARTH CRUISER 3 EC3 21 2026 GLOSS BLACK"
 *   "EC2 S/T"                   → "EARTH CRUISER 2 EC2 S/T"
 *   "Earth Cruiser 1 Step-Thru" → "Earth Cruiser 1 EC1 Step-Thru"
 *   "EARTH CRUISER 3 EC3"       → unchanged
 */
export function expandModelAbbreviation(text: string | null | undefined): string {
  const raw = (text ?? '').trim();
  const tokens = words(raw);
  if (tokens.length === 0) return raw;

  for (const [abbr, full] of Object.entries(MODEL_ABBREVIATIONS)) {
    const fullTokens = words(full);
    const startsWithFull =
      tokens.length >= fullTokens.length && fullTokens.every((w, i) => same(w, tokens[i]));

    if (startsWithFull) {
      const next = tokens[fullTokens.length];
      if (next && same(next, abbr)) return tokens.join(' ');
      return [...tokens.slice(0, fullTokens.length), abbr, ...tokens.slice(fullTokens.length)].join(
        ' '
      );
    }
    if (same(tokens[0], abbr)) return [full, ...tokens].join(' ');
  }
  return raw;
}
