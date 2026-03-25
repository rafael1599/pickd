/** Parsed result from a US address string */
export interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

// ── State lookup (full name → abbreviation) ─────────────────────────────────

const STATE_MAP: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
  'DISTRICT OF COLUMBIA': 'DC',
};

const VALID_STATE_ABBREVS = new Set(Object.values(STATE_MAP));

// ── Street suffixes (canonical + common abbreviations) ──────────────────────

const SUFFIX_CANONICAL: Record<string, string> = {
  STREET: 'ST',
  ST: 'ST',
  AVENUE: 'AVE',
  AVE: 'AVE',
  BOULEVARD: 'BLVD',
  BLVD: 'BLVD',
  DRIVE: 'DR',
  DR: 'DR',
  LANE: 'LN',
  LN: 'LN',
  ROAD: 'RD',
  RD: 'RD',
  COURT: 'CT',
  CT: 'CT',
  PLACE: 'PL',
  PL: 'PL',
  WAY: 'WAY',
  CIRCLE: 'CIR',
  CIR: 'CIR',
  TERRACE: 'TER',
  TER: 'TER',
  PARKWAY: 'PKWY',
  PKWY: 'PKWY',
  HIGHWAY: 'HWY',
  HWY: 'HWY',
  SQUARE: 'SQ',
  SQ: 'SQ',
  LOOP: 'LOOP',
  TRAIL: 'TRL',
  TRL: 'TRL',
  POINT: 'PT',
  PT: 'PT',
  RUN: 'RUN',
  PASS: 'PASS',
  CROSSING: 'XING',
  XING: 'XING',
  ALLEY: 'ALY',
  ALY: 'ALY',
  PIKE: 'PIKE',
  COMMONS: 'CMNS',
  CMNS: 'CMNS',
  EXPRESSWAY: 'EXPY',
  EXPY: 'EXPY',
  FREEWAY: 'FWY',
  FWY: 'FWY',
  TURNPIKE: 'TPKE',
  TPKE: 'TPKE',
  COVE: 'CV',
  CV: 'CV',
  BEND: 'BND',
  BND: 'BND',
  GLEN: 'GLN',
  GLN: 'GLN',
  RIDGE: 'RDG',
  RDG: 'RDG',
  GROVE: 'GRV',
  GRV: 'GRV',
  VISTA: 'VIS',
  VIS: 'VIS',
  WALK: 'WALK',
  PATH: 'PATH',
  ROW: 'ROW',
  BROADWAY: 'BROADWAY',
};

const ALL_SUFFIXES = Object.keys(SUFFIX_CANONICAL);

// ── Post-directionals ───────────────────────────────────────────────────────

const DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

// ── Unit/apartment designators ──────────────────────────────────────────────

const UNIT_RX = /^(APT|SUITE|STE|UNIT|BLDG|FL|FLOOR|RM|ROOM|DEPT|LOT|TRLR|SPC|#)\s*\.?\s*\S+/i;

// ── Country patterns to strip ───────────────────────────────────────────────

const COUNTRY_RX = /\s+(?:USA?|UNITED\s+STATES(?:\s+OF\s+AMERICA)?)\s*$/i;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize input: newlines → spaces, collapse whitespace, trim, strip country */
function normalize(raw: string): string {
  let s = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  s = s.replace(COUNTRY_RX, '');
  return s.trim();
}

/** Levenshtein distance (for fuzzy suffix matching) */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Try to match a full state name at the end of a "city state" string.
 * Returns [cityPart, stateAbbrev] or null.
 */
function extractFullStateName(cityState: string): [string, string] | null {
  const upper = cityState.toUpperCase();
  // Try longest state names first (3-word, then 2-word, then 1-word)
  const entries = Object.entries(STATE_MAP).sort(
    (a, b) => b[0].split(' ').length - a[0].split(' ').length || b[0].length - a[0].length
  );
  for (const [name, abbrev] of entries) {
    const rx = new RegExp(`[,\\s]+${name}$`, 'i');
    if (rx.test(upper)) {
      const matchIdx = upper.search(rx);
      const city = cityState.substring(0, matchIdx).trim().replace(/,\s*$/, '');
      if (city) return [city, abbrev];
    }
  }
  return null;
}

/**
 * Find the LAST street suffix in a string of words, using exact + fuzzy match.
 * Returns { index: position in original string, length: matched word length, suffix: canonical } or null.
 */
function findLastSuffix(text: string): { index: number; length: number; suffix: string } | null {
  const words = text.split(/\s+/);
  let bestMatch: { index: number; length: number; suffix: string } | null = null;
  let pos = 0;

  for (const word of words) {
    const wordStart = text.indexOf(word, pos);
    const upper = word.toUpperCase().replace(/\.$/, ''); // strip trailing period (St.)

    // Exact match
    if (SUFFIX_CANONICAL[upper] !== undefined) {
      bestMatch = { index: wordStart, length: word.length, suffix: upper };
    } else if (upper.length >= 4) {
      // Fuzzy match: only for words 4+ chars, max distance 1
      for (const suf of ALL_SUFFIXES) {
        if (
          suf.length >= 4 &&
          Math.abs(suf.length - upper.length) <= 1 &&
          levenshtein(upper, suf) === 1
        ) {
          bestMatch = { index: wordStart, length: word.length, suffix: suf };
          break;
        }
      }
    }
    pos = wordStart + word.length;
  }
  return bestMatch;
}

// ── PO Box detection ────────────────────────────────────────────────────────

const PO_BOX_RX = /^(P\.?\s*O\.?\s*BOX\s+\S+)/i;

// ── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse a pasted US address into its components.
 * Returns null if the string doesn't look like a full address.
 *
 * Supported formats:
 * - "123 Main St, Miami, FL 33101"
 * - "123 Main St, Miami FL 33101"
 * - "37 OCEAN ST South Portland, ME 04106 USA"
 * - "107 EAST BROAD STREE PALMYRA, NJ 08065 USA"  (typo in suffix)
 * - "123 Main St N, Miami, FL 33101"  (post-directional)
 * - "PO Box 123, Palmyra, NJ 08065"
 * - "123 Main St, Miami, New Jersey 08065"  (full state name)
 * - Multi-line pasted addresses
 */
export function parseUSAddress(raw: string): ParsedAddress | null {
  const value = normalize(raw);
  if (!value) return null;

  // ── Extract ZIP (required) ────────────────────────────────────────────
  const zipRx = /\b(\d{5}(?:-\d{4})?)\s*$/;
  const zipMatch = value.match(zipRx);
  if (!zipMatch) return null;
  const zip = zipMatch[1];
  const beforeZip = value.substring(0, zipMatch.index).trim();

  // ── Extract state ─────────────────────────────────────────────────────
  // Try 2-letter abbreviation first
  let state: string | null = null;
  let beforeState = '';

  const stateAbbrRx = /[,\s]+([A-Z]{2})\s*$/i;
  const stateAbbrMatch = beforeZip.match(stateAbbrRx);
  if (stateAbbrMatch) {
    const candidate = stateAbbrMatch[1].toUpperCase();
    if (VALID_STATE_ABBREVS.has(candidate)) {
      state = candidate;
      beforeState = beforeZip.substring(0, stateAbbrMatch.index).trim();
    }
  }

  // Try full state name if abbreviation didn't work
  if (!state) {
    const fullStateResult = extractFullStateName(beforeZip);
    if (fullStateResult) {
      beforeState = fullStateResult[0];
      state = fullStateResult[1];
    }
  }

  if (!state) return null;

  // Clean trailing comma from beforeState
  beforeState = beforeState.replace(/,\s*$/, '').trim();
  if (!beforeState) return null;

  // ── Split street and city ─────────────────────────────────────────────

  // Strategy 1: Comma separates street from city → "123 Main St, Miami"
  const lastComma = beforeState.lastIndexOf(',');
  if (lastComma > 0) {
    const street = beforeState.substring(0, lastComma).trim();
    const city = beforeState.substring(lastComma + 1).trim();
    if (street && city) {
      return { street, city, state, zip };
    }
  }

  // Strategy 2: PO Box → everything after box number is city
  const poMatch = beforeState.match(PO_BOX_RX);
  if (poMatch) {
    const street = poMatch[1];
    const city = beforeState.substring(poMatch[0].length).trim();
    return { street, city: city || '', state, zip };
  }

  // Strategy 3: Use street suffix to split street from city
  const suffixResult = findLastSuffix(beforeState);
  if (suffixResult) {
    const afterSuffixStart = suffixResult.index + suffixResult.length;
    let afterSuffix = beforeState.substring(afterSuffixStart).trim();
    let streetEnd = afterSuffixStart;

    // Check for post-directional (N, S, E, W, NE, NW, SE, SW) right after suffix
    const dirMatch = afterSuffix.match(/^([NSEW]{1,2})\b\s*(.*)/i);
    if (dirMatch && DIRECTIONALS.has(dirMatch[1].toUpperCase())) {
      streetEnd =
        afterSuffixStart +
        beforeState.substring(afterSuffixStart).indexOf(dirMatch[1]) +
        dirMatch[1].length;
      afterSuffix = dirMatch[2].trim();
    }

    // Check for unit/apartment designator after suffix (or after directional)
    const unitMatch = afterSuffix.match(UNIT_RX);
    if (unitMatch) {
      const unitEnd = unitMatch[0].length;
      const streetPart = beforeState.substring(0, streetEnd).trim() + ' ' + unitMatch[0];
      const city = afterSuffix.substring(unitEnd).trim();
      if (city) return { street: streetPart, city, state, zip };
      // Unit but no city text after → city is empty
      return { street: streetPart, city: '', state, zip };
    }

    if (afterSuffix) {
      const street = beforeState.substring(0, streetEnd).trim();
      return { street, city: afterSuffix, state, zip };
    }

    // Suffix is the last word → can't split, put everything as street
    return { street: beforeState, city: '', state, zip };
  }

  // Strategy 4: No suffix found, no comma — can't reliably split street/city.
  // Put everything as street and leave city empty for manual entry.
  return { street: beforeState, city: '', state, zip };
}
