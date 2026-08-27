import { describe, expect, it } from 'vitest';
import {
  FEDEX_RECIPIENT_BADGE,
  FEDEX_RECIPIENT_HINT,
  resolveFedexRecipient,
  type FedexRecipientAddress,
} from '../fedexRecipient';

const address = (over: Partial<FedexRecipientAddress> = {}): FedexRecipientAddress => ({
  id: 'addr-1',
  label: 'TUCKER CYCLES',
  street: '3544 ST JOHNS AVE',
  city: 'JACKSONVILLE',
  state: 'FL',
  zip_code: '32205',
  fedex_recipient_id: '1049500',
  contact_name: null,
  residential: false,
  fedex_synced_at: null,
  ...over,
});

const dealer = { as400_account: '10495', ship_to_varies: false };
const channel = { as400_account: '20045', ship_to_varies: true };

describe('resolveFedexRecipient', () => {
  it('is "unsynced" when Pickd has an id it has not yet seen in FedEx', () => {
    const s = resolveFedexRecipient(dealer, address());
    expect(s.kind).toBe('unsynced');
    expect(s.id).toBe('1049500');
  });

  it('is "in_fedex" once the row was synced', () => {
    const s = resolveFedexRecipient(dealer, address({ fedex_synced_at: '2026-08-26T00:00:00Z' }));
    expect(s.kind).toBe('in_fedex');
    expect(s.id).toBe('1049500');
  });

  it('a channel account is always one-off, even if an address carries an id', () => {
    // DEALER WARRANTY 2009 is saved in FSM as a private house in Beaufort: the
    // last consumer overwrote the channel record. The flag exists to stop that.
    const s = resolveFedexRecipient(channel, address());
    expect(s.kind).toBe('one_off');
    expect(s.id).toBeNull();
  });

  it('is "no_id" without an address or without an id on it', () => {
    expect(resolveFedexRecipient(dealer, null).kind).toBe('no_id');
    expect(resolveFedexRecipient(dealer, address({ fedex_recipient_id: null })).kind).toBe('no_id');
    expect(resolveFedexRecipient(dealer, address({ fedex_recipient_id: '   ' })).kind).toBe(
      'no_id'
    );
  });

  it('is "no_id" for a manual order whose customer has no account', () => {
    const manual = { as400_account: null, ship_to_varies: false };
    expect(resolveFedexRecipient(manual, address({ fedex_recipient_id: null })).kind).toBe('no_id');
    expect(resolveFedexRecipient(null, null).kind).toBe('no_id');
  });

  it('keeps legacy hand-typed FSM codes as they are', () => {
    const s = resolveFedexRecipient(dealer, address({ fedex_recipient_id: 'SB 202' }));
    expect(s.id).toBe('SB 202');
  });

  it('every state has a badge and a hint', () => {
    for (const kind of ['in_fedex', 'unsynced', 'one_off', 'no_id'] as const) {
      expect(FEDEX_RECIPIENT_BADGE[kind]).toBeTruthy();
      expect(FEDEX_RECIPIENT_HINT[kind]).toBeTruthy();
    }
    // The one-off hint must say "untick": saving is the mistake that pollutes FSM.
    expect(FEDEX_RECIPIENT_HINT.one_off).toMatch(/untick/);
    expect(FEDEX_RECIPIENT_HINT.unsynced).toMatch(/Save in\/Update/);
  });
});
