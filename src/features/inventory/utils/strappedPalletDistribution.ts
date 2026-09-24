export const BIKES_PER_STRAPPED_PALLET = 12;

export const CONTAINER_LOCATION_REGEX = /^\d{4}N$/i;

export function isContainerLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  return CONTAINER_LOCATION_REGEX.test(location.trim());
}

/**
 * Calculates how many strapped pallets are needed for a given bike quantity,
 * considering each strapped pallet holds 12 bikes.
 */
export function calculateStrappedPallets(
  qty: number,
  bikesPerPallet = BIKES_PER_STRAPPED_PALLET
): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.ceil(qty / bikesPerPallet);
}

/**
 * Sorts location names naturally so "ROW 2" comes before "ROW 10".
 */
export function compareLocations(a: string, b: string): number {
  const parseLoc = (loc: string) => {
    const rowMatch = loc.match(/^ROW\s+([\d.]+)(.*)$/i);
    if (rowMatch) {
      return { isRow: true, num: parseFloat(rowMatch[1]), rest: rowMatch[2].trim() };
    }
    return { isRow: false, num: 99999, rest: loc };
  };

  const pA = parseLoc(a);
  const pB = parseLoc(b);

  if (pA.isRow && pB.isRow) {
    if (pA.num !== pB.num) return pA.num - pB.num;
    return pA.rest.localeCompare(pB.rest);
  }
  if (pA.isRow) return -1;
  if (pB.isRow) return 1;
  return a.localeCompare(b);
}
