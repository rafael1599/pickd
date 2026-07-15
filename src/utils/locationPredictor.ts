/**
 * Logic for predicting and normalizing warehouse locations based on user input.
 * Helps convert rapid short-hand inputs (like "9") into standardized formats ("Row 09").
 */

interface PredictionResult {
  matches: string[];
  exactMatch: boolean;
  bestGuess: string | null;
}

/**
 * Normalizes input and finds best matches from existing locations.
 *
 * @param input - The raw user input (e.g., "9", "row 9")
 * @param existingLocations - List of all valid location names in the current warehouse
 * @returns PredictionResult object containing matches and best guess
 */
export const predictLocation = (
  input: string,
  existingLocations: string[] = []
): PredictionResult => {
  if (!input || typeof input !== 'string') {
    return { matches: [], exactMatch: false, bestGuess: null };
  }

  const cleanInput = input.trim();
  // Check for exact match first
  const exactMatch = existingLocations.find(
    (loc) => loc.toLowerCase() === cleanInput.toLowerCase()
  );

  if (exactMatch) {
    return {
      matches: [exactMatch],
      exactMatch: true,
      bestGuess: exactMatch,
    };
  }

  const isNumeric = /^\d+$/.test(cleanInput);

  let potentialMatches: string[] = [];

  if (isNumeric) {
    // Generate common warehouse patterns for numbers
    const patterns = [
      `Row ${cleanInput}`, // "Row 9"
      `Row ${cleanInput.padStart(2, '0')}`, // "Row 09"
      `Row ${cleanInput.padStart(3, '0')}`, // "Row 009"
      `R${cleanInput}`, // "R9"
      `Aisle ${cleanInput}`, // "Aisle 9"
      `Bin ${cleanInput}`, // "Bin 9"
    ];

    // Find which generated patterns actually exist in the DB
    potentialMatches = existingLocations.filter((loc) => {
      // Check against patterns
      const isPatternMatch = patterns.some((p) => p.toLowerCase() === loc.toLowerCase());
      return isPatternMatch;
    });
  } else {
    // Standard text search
    potentialMatches = existingLocations.filter((loc) =>
      loc.toLowerCase().includes(cleanInput.toLowerCase())
    );
  }

  // Sort matches by quality
  // 1. "Row XX" is preferred (Business Rule: DEFAULT_PREFIX = "Row")
  // 2. Shorter length (usually implies simpler/more direct match)
  potentialMatches.sort((a, b) => {
    const aIsRow = a.toLowerCase().startsWith('row');
    const bIsRow = b.toLowerCase().startsWith('row');

    if (aIsRow && !bIsRow) return -1;
    if (!aIsRow && bIsRow) return 1;

    return a.length - b.length;
  });

  // Determine Best Guess for Auto-Selection
  // We only guess if we have results and the input was numeric (high confidence of "shortcode" usage)
  let bestGuess: string | null = null;
  if (isNumeric && potentialMatches.length === 1) {
    bestGuess = potentialMatches[0];
  } else if (isNumeric && potentialMatches.length > 1) {
    // If multiple matches, checking if one is significantly "standard".
    // Strict Mode: Only auto-select if it's the ONLY "Row" match.
    const rowMatches = potentialMatches.filter((m) => m.toLowerCase().startsWith('row'));
    if (rowMatches.length === 1) {
      bestGuess = rowMatches[0];
    }
  } else if (isNumeric && potentialMatches.length === 0) {
    // 🧪 FALLBACK: If numeric input doesn't match anything, assume "Row X"
    // This prevents creating "4" instead of "Row 4" for new items.
    bestGuess = `Row ${cleanInput}`;
  }

  return {
    matches: [...new Set(potentialMatches)],
    exactMatch: false,
    bestGuess,
  };
};
