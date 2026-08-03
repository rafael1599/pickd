/**
 * Official ZIP Code 3-digit prefix mappings for PAV Express delivery zones.
 */
export const PAV_EXPRESS_ZONES = {
  zone1: [
    '100',
    '101',
    '102',
    '103',
    '104',
    '105',
    '106',
    '107',
    '108',
    '109',
    '112',
    '113',
    '114',
    '116',
  ],
  zone2: ['110', '115', '117', '118', '119', '120'],
  zone3: [
    '080',
    '081',
    '082',
    '083',
    '084',
    '085',
    '086',
    '087',
    '088',
    '089',
    '189',
    '190',
    '191',
    '192',
    '193',
    '194',
  ],
} as const;

export type PavExpressZone = 'zone1' | 'zone2' | 'zone3';

export const PAV_EXPRESS_ZONE_LABELS: Record<PavExpressZone, string> = {
  zone1: 'PAV Zone 1',
  zone2: 'PAV Zone 2',
  zone3: 'PAV Zone 3',
};

/**
 * Returns the PAV Express Zone for a given US ZIP code (5-digit or 9-digit format),
 * or null if the ZIP does not fall into any PAV Express zone.
 */
export function getPavExpressZone(zip: string | null | undefined): PavExpressZone | null {
  if (!zip) return null;
  const cleanZip = String(zip).trim().replace(/[^\d]/g, '');
  if (cleanZip.length < 3) return null;

  const prefix = cleanZip.slice(0, 3);

  if ((PAV_EXPRESS_ZONES.zone1 as readonly string[]).includes(prefix)) {
    return 'zone1';
  }
  if ((PAV_EXPRESS_ZONES.zone2 as readonly string[]).includes(prefix)) {
    return 'zone2';
  }
  if ((PAV_EXPRESS_ZONES.zone3 as readonly string[]).includes(prefix)) {
    return 'zone3';
  }

  return null;
}
