import { describe, expect, it } from 'vitest';
import {
  DAYLIGHT_CONTACT_PHONE,
  buildDaylightPickupSmsBody,
  buildDaylightPickupSmsUrl,
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
