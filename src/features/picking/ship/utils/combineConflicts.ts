export interface AddressConflictOption {
  addressId: string;
  street: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  orderNumbers: string[];
}

export interface LoadNumberConflictOption {
  loadNumber: string;
  orderNumbers: string[];
}

export interface CombineConflictAnalysis {
  hasConflict: boolean;
  hasAddressConflict: boolean;
  hasLoadNumberConflict: boolean;
  addressOptions: AddressConflictOption[];
  loadOptions: LoadNumberConflictOption[];
  defaultAddressId: string | null;
  defaultLoadNumber: string | null;
}

export interface ConflictCheckOrder {
  order_number: string | null;
  ship_to_address_id?: string | null;
  load_number?: string | null;
  shipment?: {
    ship_to_address_id?: string | null;
    load_number?: string | null;
  } | null;
  ship_to?: {
    id: string;
    street: string;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
  } | null;
  customer?: {
    name?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
  } | null;
}

// Directional normalization mapping
const DIRECTIONALS: Record<string, string> = {
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
  N: 'N',
  S: 'S',
  E: 'E',
  W: 'W',
  NE: 'NE',
  NW: 'NW',
  SE: 'SE',
  SW: 'SW',
};

// Suffix normalization mapping (USPS standard abbreviations)
const STREET_SUFFIXES: Record<string, string> = {
  STREET: 'ST',
  ST: 'ST',
  AVENUE: 'AVE',
  AVE: 'AVE',
  AV: 'AVE',
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
  TRAIL: 'TRL',
  TRL: 'TRL',
  LOOP: 'LOOP',
  SUITE: 'STE',
  STE: 'STE',
  APARTMENT: 'APT',
  APT: 'APT',
  UNIT: 'UNIT',
  BUILDING: 'BLDG',
  BLDG: 'BLDG',
  FLOOR: 'FL',
  FL: 'FL',
};

/**
 * Normalizes a US street address by standardizing directionals and street suffixes,
 * stripping punctuation, and collapsing multiple spaces to uppercase tokens.
 */
export function normalizeStreetAddress(street: string | null | undefined): string {
  if (!street) return '';
  const clean = street
    .toUpperCase()
    .replace(/[.,#\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = clean.split(' ').filter(Boolean);
  const normalizedWords = words.map((w) => {
    if (DIRECTIONALS[w]) return DIRECTIONALS[w];
    if (STREET_SUFFIXES[w]) return STREET_SUFFIXES[w];
    return w;
  });

  return normalizedWords.join(' ');
}

/**
 * Normalizes a US ZIP code to its canonical 5-digit base.
 */
export function normalizeZipCode(zip: string | null | undefined): string {
  if (!zip) return '';
  const digits = zip.trim().replace(/[^\d]/g, '');
  if (digits.length >= 5) return digits.slice(0, 5);
  return zip.trim().toUpperCase();
}

/**
 * Pure evaluator to detect conflicts between orders being merged into a single shipment.
 * Evaluates whether orders differ in destination address or load number.
 * If multiple orders point to identical addresses (matching normalized street and zip),
 * they are treated as having no address conflict.
 */
export function detectCombineConflicts(orders: ConflictCheckOrder[]): CombineConflictAnalysis {
  // Address aggregation
  const addressMap = new Map<string, AddressConflictOption>();

  for (const order of orders) {
    const orderNum = order.order_number || 'N/A';
    const addressId = order.shipment?.ship_to_address_id ?? order.ship_to_address_id;
    if (addressId) {
      const street = order.ship_to?.street ?? order.customer?.street ?? 'Registered address';
      const city = order.ship_to?.city ?? order.customer?.city ?? null;
      const state = order.ship_to?.state ?? order.customer?.state ?? null;
      const zip = order.ship_to?.zip_code ?? order.customer?.zip_code ?? null;

      const normStreet = normalizeStreetAddress(street);
      const normZip = normalizeZipCode(zip);
      // Group by normalized street + zip when available to deduplicate identical addresses across rows
      const dedupeKey = normStreet && normZip ? `${normStreet}|${normZip}` : addressId;

      const existing = addressMap.get(dedupeKey);
      if (existing) {
        if (!existing.orderNumbers.includes(orderNum)) {
          existing.orderNumbers.push(orderNum);
        }
      } else {
        addressMap.set(dedupeKey, {
          addressId,
          street,
          city,
          state,
          zip,
          orderNumbers: [orderNum],
        });
      }
    }
  }

  const addressOptions = Array.from(addressMap.values());
  const hasAddressConflict = addressOptions.length > 1;

  // Load number aggregation
  const loadMap = new Map<string, LoadNumberConflictOption>();

  for (const order of orders) {
    const orderNum = order.order_number || 'N/A';
    const rawLoad = (order.shipment?.load_number ?? order.load_number)?.trim();
    if (rawLoad) {
      const existing = loadMap.get(rawLoad);
      if (existing) {
        if (!existing.orderNumbers.includes(orderNum)) {
          existing.orderNumbers.push(orderNum);
        }
      } else {
        loadMap.set(rawLoad, {
          loadNumber: rawLoad,
          orderNumbers: [orderNum],
        });
      }
    }
  }

  const loadOptions = Array.from(loadMap.values());
  const hasLoadNumberConflict = loadOptions.length > 1;

  return {
    hasConflict: hasAddressConflict || hasLoadNumberConflict,
    hasAddressConflict,
    hasLoadNumberConflict,
    addressOptions,
    loadOptions,
    defaultAddressId: addressOptions[0]?.addressId ?? null,
    defaultLoadNumber: loadOptions[0]?.loadNumber ?? null,
  };
}
