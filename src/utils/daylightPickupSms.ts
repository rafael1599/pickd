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
import { noteKind, noteMetadataNumber, type NoteLike } from './systemNotes';

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

/**
 * Tag that marks the note written when the operator confirms the text went
 * out. Same bracketed convention as the `[Parked]:` note the PICK UP flow
 * already writes, and the reason the reminder can survive a page reload,
 * a different device, and a different operator: the note IS the record.
 */
export const DAYLIGHT_NOTE_PREFIX = '[Daylight]:';

/** `"[Daylight]: Texted Luis — 4 pallets to pick up"` */
export function buildDaylightSentNote(pallets: number): string {
  const unit = pallets === 1 ? 'pallet' : 'pallets';
  return `${DAYLIGHT_NOTE_PREFIX} Texted ${DAYLIGHT_CONTACT_NAME} — ${pallets} ${unit} to pick up`;
}

export function isDaylightSentNote(message: string | null | undefined): boolean {
  return (message ?? '').trimStart().toLowerCase().startsWith(DAYLIGHT_NOTE_PREFIX.toLowerCase());
}

/**
 * The pallet count a `[Daylight]` note recorded, or null when the message
 * isn't one of ours. Reading the number back out is what re-arms the
 * reminder after somebody edits the pallet count: a note saying 4 no longer
 * covers an order that now ships 6.
 */
/**
 * Pallet count a `[Daylight]` note recorded. Reads the structured field the DB
 * trigger filled; falls back to the message for rows written before migration
 * 20260820190000, and for the optimistic entry that has not round-tripped yet.
 */
export function daylightNotePallets(note: NoteLike): number | null {
  if (noteKind(note) !== 'daylight_pickup_sms') return null;
  return noteMetadataNumber(note, 'pallets') ?? parseDaylightNotePallets(note.message);
}

export function parseDaylightNotePallets(message: string | null | undefined): number | null {
  if (!isDaylightSentNote(message)) return null;
  const match = (message ?? '').match(/(\d+)\s*pallets?\b/i);
  if (!match) return null;
  const pallets = Number.parseInt(match[1], 10);
  return Number.isFinite(pallets) ? pallets : null;
}

export interface DaylightReminderInput {
  /** Raw `transport_company`, as the Ship form holds it. */
  transportCompany: string | null | undefined;
  isShipped: boolean | null | undefined;
  /** False until this order's notes have actually come back from the server. */
  notesSettled: boolean;
  /** Pallet count the order currently carries. */
  pallets: number;
  /** Count from the newest `[Daylight]` note, or null when there is none. */
  confirmedPallets: number | null;
}

/**
 * The whole rule in one place: nag while this order ships Daylight, hasn't
 * gone out yet, and nobody has confirmed texting the count it currently has.
 *
 * Deliberately NOT scoped to orders created today. The text is owed when the
 * order ships, not when it was keyed in — an order from Tuesday that goes out
 * this afternoon needs the dispatcher told just as much. `isShipped` is what
 * ends it.
 *
 * `notesSettled` is not a nicety: without it the banner flashes red for a
 * frame on every order switch, before the note that would have silenced it
 * has loaded.
 */
export function shouldRemindDaylightPickup(input: DaylightReminderInput): boolean {
  // Same normalization as `normalizeCompany` in transportLogos, inlined to
  // keep utils from reaching into components.
  if ((input.transportCompany ?? '').trim().toUpperCase() !== 'DAYLIGHT') return false;
  if (input.isShipped) return false;
  if (!input.notesSettled) return false;
  return input.confirmedPallets !== input.pallets;
}
