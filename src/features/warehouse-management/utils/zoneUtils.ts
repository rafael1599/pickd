/**
 * Zone Utilities - Shared styling and parsing functions for zone management
 */

export type Zone = 'HOT' | 'WARM' | 'COLD' | 'UNASSIGNED';

// Zone order for route calculation (COLD first = picked first, HOT last = picked last)
export const ZONE_ORDER: Record<string, number> = { COLD: 1, WARM: 2, HOT: 3, UNASSIGNED: 4 };

// Zone cycle order for tap-to-change functionality
export const ZONE_CYCLE: Zone[] = ['COLD', 'WARM', 'HOT'];

/**
 * Get the next zone in the cycle
 */
export const getNextZone = (currentZone: string): Zone => {
  const currentIndex = ZONE_CYCLE.indexOf(currentZone as Zone);
  if (currentIndex === -1) return 'COLD';
  return ZONE_CYCLE[(currentIndex + 1) % ZONE_CYCLE.length];
};

/**
 * Parse a location key (e.g., "LUDLOW-A1") into warehouse and location parts
 */
export const parseLocationKey = (key: string | null) => {
  if (!key) return { warehouse: '', location: '' };
  const parts = key.split('-');
  const warehouse = parts[0];
  const location = parts.slice(1).join('-');
  return { warehouse, location };
};

/**
 * Get Tailwind CSS classes for a zone
 */
export const getZoneStyle = (zone: string | null) => {
  switch (zone) {
    case 'HOT':
      return 'bg-red-500/20 border-red-500 text-red-400';
    case 'WARM':
      return 'bg-orange-500/20 border-orange-500 text-orange-400';
    case 'COLD':
      return 'bg-blue-500/20 border-blue-500 text-blue-400';
    default:
      return 'bg-neutral-800 border-neutral-600 text-neutral-400';
  }
};

/**
 * Get emoji representation of a zone
 */
export const getZoneEmoji = (zone: string | null) => {
  switch (zone) {
    case 'HOT':
      return '🔥';
    case 'WARM':
      return '☀️';
    case 'COLD':
      return '❄️';
    default:
      return '❔';
  }
};

/**
 * Get warehouse-specific button color classes
 */
export const getWarehouseButtonStyle = (warehouse: string | null, isActive: boolean) => {
  if (!isActive) return 'text-neutral-400 hover:text-white';

  switch (warehouse?.toUpperCase()) {
    case 'LUDLOW':
      return 'bg-green-500 text-black';
    case 'ATS':
      return 'bg-blue-500 text-black';
    default:
      return 'bg-white text-black';
  }
};

/**
 * Sort locations by zone order, then alphabetically
 */
export const sortByZoneThenAlpha = (
  locations: string[],
  getZone: (wh: string, loc: string) => string
) => {
  return [...locations].sort((a, b) => {
    const parsedA = parseLocationKey(a);
    const parsedB = parseLocationKey(b);
    const zoneA = getZone(parsedA.warehouse, parsedA.location);
    const zoneB = getZone(parsedB.warehouse, parsedB.location);

    if (ZONE_ORDER[zoneA] !== ZONE_ORDER[zoneB]) {
      return (ZONE_ORDER[zoneA] || 4) - (ZONE_ORDER[zoneB] || 4);
    }
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
};

/**
 * Calculate the zone based on index and total count (1/3 division)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const calculateZoneFromIndex = (_index?: number, _total?: number): Zone => {
  // Temporarily disabled: Route all to UNASSIGNED until full logic is complete
  return 'UNASSIGNED';
};

/**
 * Recalculate zones for a list of locations based on their current order
 */
export const recalculateZonesFromOrder = (locations: string[]) => {
  const total = locations.length;
  return locations.map((locKey, index) => {
    const { warehouse, location } = parseLocationKey(locKey);
    return {
      warehouse,
      location,
      zone: calculateZoneFromIndex(index, total),
    };
  });
};

/**
 * Extract unique warehouses from a list of location keys
 */
export const extractWarehouses = (locations: string[]) => {
  const warehouses = new Set<string>();
  locations.forEach((loc) => {
    const { warehouse } = parseLocationKey(loc);
    if (warehouse) warehouses.add(warehouse);
  });
  return Array.from(warehouses).sort();
};

/**
 * Filter locations by warehouse, search term, and zone
 */
export const filterLocations = (
  locations: string[],
  {
    warehouse,
    searchTerm,
    zone,
    getZone,
  }: {
    warehouse?: string;
    searchTerm?: string;
    zone?: string;
    getZone: (wh: string, loc: string) => string;
  }
) => {
  let result = locations;

  if (warehouse && warehouse !== 'ALL') {
    result = result.filter((loc) => parseLocationKey(loc).warehouse === warehouse);
  }

  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    result = result.filter((loc) => loc.toLowerCase().includes(lower));
  }

  if (zone && zone !== 'ALL') {
    result = result.filter((loc) => {
      const { warehouse: wh, location } = parseLocationKey(loc);
      return getZone(wh, location) === zone;
    });
  }

  return result;
};
