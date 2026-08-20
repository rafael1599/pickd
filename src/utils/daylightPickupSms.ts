/**
 * Daylight pick-up SMS — the text the operator owes Luis whenever an order
 * ships with DAYLIGHT.
 *
 * Daylight schedules the truck off a phone call, not off the paperwork:
 * somebody has to tell Luis how many pallets to come get. `ShipOrderCard`
 * keeps a red reminder next to the carrier picker until the operator says
 * they sent it; these helpers build what that reminder's Send button opens.
 *
 * Unlike `buildShipOutSmsUrl`, which deliberately carries NO recipient so the
 * operator picks the destination thread themselves, here the recipient is a
 * fixed, known number — so it goes straight into the URL.
 */
import type { SmsPlatform } from './shipOutSms';

/** Daylight's dispatcher, the one who schedules the pick-up. */
export const DAYLIGHT_CONTACT_NAME = 'Luis';
/** E.164, for the `sms:` URL. */
export const DAYLIGHT_CONTACT_PHONE = '+12019180874';
/** Same digits, for humans. */
export const DAYLIGHT_CONTACT_PHONE_DISPLAY = '+1 (201) 918-0874';

/** `"4 pallets to pick up from Jamis Bikes"` — singular when it's one. */
export function buildDaylightPickupSmsBody(pallets: number): string {
  return `${pallets} ${pallets === 1 ? 'pallet' : 'pallets'} to pick up from Jamis Bikes`;
}

/**
 * `sms:` URL addressed to Luis with the body prefilled. iOS wants the body
 * joined with `&` after the recipient; every other platform uses `?`.
 */
export function buildDaylightPickupSmsUrl(body: string, platform: SmsPlatform): string {
  const separator = platform === 'ios' ? '&' : '?';
  return `sms:${DAYLIGHT_CONTACT_PHONE}${separator}body=${encodeURIComponent(body)}`;
}
