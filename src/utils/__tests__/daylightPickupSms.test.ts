import { describe, expect, it } from 'vitest';
import {
  DAYLIGHT_CONTACT_PHONE,
  buildDaylightPickupSmsBody,
  buildDaylightPickupSmsUrl,
  buildDaylightSentNote,
  daylightNotePallets,
  isDaylightSentNote,
  parseDaylightNotePallets,
  shouldRemindDaylightPickup,
} from '../daylightPickupSms';

describe('buildDaylightPickupSmsBody', () => {
  it('names the pallet count and where to pick it up', () => {
    expect(buildDaylightPickupSmsBody(4)).toBe('4 pallets to pick up from Jamis Bikes');
  });

  it('uses the singular for a single pallet', () => {
    expect(buildDaylightPickupSmsBody(1)).toBe('1 pallet to pick up from Jamis Bikes');
  });
});

describe('buildDaylightPickupSmsUrl', () => {
  it("addresses Luis' number on every platform", () => {
    const body = buildDaylightPickupSmsBody(2);
    for (const platform of ['ios', 'android', 'other'] as const) {
      expect(buildDaylightPickupSmsUrl(body, platform)).toContain(`sms:${DAYLIGHT_CONTACT_PHONE}`);
    }
  });

  it('joins the body with & on iOS and ? elsewhere', () => {
    const body = buildDaylightPickupSmsBody(2);
    expect(buildDaylightPickupSmsUrl(body, 'ios')).toBe(
      'sms:+12019180874&body=2%20pallets%20to%20pick%20up%20from%20Jamis%20Bikes'
    );
    expect(buildDaylightPickupSmsUrl(body, 'android')).toBe(
      'sms:+12019180874?body=2%20pallets%20to%20pick%20up%20from%20Jamis%20Bikes'
    );
    expect(buildDaylightPickupSmsUrl(body, 'other')).toBe(
      buildDaylightPickupSmsUrl(body, 'android')
    );
  });
});

describe('buildDaylightSentNote', () => {
  it('tags the note so the order history reads like the [Parked] one', () => {
    expect(buildDaylightSentNote(4)).toBe('[Daylight]: Texted Luis — 4 pallets to pick up');
  });

  it('uses the singular for a single pallet', () => {
    expect(buildDaylightSentNote(1)).toBe('[Daylight]: Texted Luis — 1 pallet to pick up');
  });
});

describe('isDaylightSentNote', () => {
  it('recognizes its own notes', () => {
    expect(isDaylightSentNote(buildDaylightSentNote(3))).toBe(true);
  });

  it('leaves every other note alone', () => {
    expect(isDaylightSentNote('[Parked]: DOCK 4')).toBe(false);
    expect(isDaylightSentNote('DO NOT SHIP BEFORE 8/25')).toBe(false);
    expect(isDaylightSentNote('')).toBe(false);
    expect(isDaylightSentNote(null)).toBe(false);
  });
});

describe('parseDaylightNotePallets', () => {
  it('reads back the count it wrote', () => {
    for (const pallets of [1, 4, 12]) {
      expect(parseDaylightNotePallets(buildDaylightSentNote(pallets))).toBe(pallets);
    }
  });

  it('returns null for notes that are not ours', () => {
    // Must not match: a human note that happens to mention pallets is not a
    // confirmation, and treating it as one would silence the reminder.
    expect(parseDaylightNotePallets('Customer asked for 4 pallets max')).toBeNull();
    expect(parseDaylightNotePallets('[Parked]: DOCK 4')).toBeNull();
    expect(parseDaylightNotePallets(null)).toBeNull();
  });

  it('returns null when one of our notes carries no count', () => {
    expect(parseDaylightNotePallets('[Daylight]: Texted Luis')).toBeNull();
  });
});

describe('shouldRemindDaylightPickup', () => {
  const pending = {
    transportCompany: 'DAYLIGHT',
    isShipped: false,
    notesSettled: true,
    pallets: 4,
    confirmedPallets: null,
  };

  it('nags an unconfirmed Daylight order', () => {
    expect(shouldRemindDaylightPickup(pending)).toBe(true);
  });

  it('ignores every other carrier', () => {
    for (const carrier of ['R+L', 'FEDEX', 'PICK UP', '', null]) {
      expect(shouldRemindDaylightPickup({ ...pending, transportCompany: carrier })).toBe(false);
    }
  });

  it('tolerates casing and stray whitespace on the carrier', () => {
    expect(shouldRemindDaylightPickup({ ...pending, transportCompany: ' daylight ' })).toBe(true);
  });

  it('stops once the order has shipped', () => {
    expect(shouldRemindDaylightPickup({ ...pending, isShipped: true })).toBe(false);
  });

  it('stays quiet until the notes have loaded', () => {
    // Otherwise every Daylight order flashes red for a frame before the note
    // that silences it arrives.
    expect(shouldRemindDaylightPickup({ ...pending, notesSettled: false })).toBe(false);
  });

  it('stops once someone confirmed the count the order actually has', () => {
    expect(shouldRemindDaylightPickup({ ...pending, confirmedPallets: 4 })).toBe(false);
  });

  it('nags again when the pallet count moves past what was confirmed', () => {
    // Luis was told 4; the order now ships 6. He needs the new number.
    expect(shouldRemindDaylightPickup({ ...pending, confirmedPallets: 4, pallets: 6 })).toBe(true);
  });

  it('keeps nagging an order sitting since Tuesday', () => {
    // The text is owed when the order ships, not when it was created — the
    // rule has no notion of "today" on purpose.
    expect(shouldRemindDaylightPickup(pending)).toBe(true);
  });
});

describe('daylightNotePallets', () => {
  it('prefers the structured field the DB trigger filled', () => {
    const note = {
      message: buildDaylightSentNote(4),
      kind: 'daylight_pickup_sms',
      metadata: { pallets: 6 },
    };
    // metadata wins: the message is prose, the column is the record.
    expect(daylightNotePallets(note)).toBe(6);
  });

  it('falls back to the message for rows the trigger never saw', () => {
    // Pre-migration rows, and the optimistic entry before it round-trips.
    expect(daylightNotePallets({ message: buildDaylightSentNote(4) })).toBe(4);
    expect(daylightNotePallets({ message: buildDaylightSentNote(4), kind: null })).toBe(4);
  });

  it('ignores notes of any other kind', () => {
    expect(daylightNotePallets({ message: '[Parked]: 14D' })).toBeNull();
    expect(daylightNotePallets({ message: 'Customer asked for 4 pallets max' })).toBeNull();
  });
});
