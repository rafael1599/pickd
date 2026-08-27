import { describe, expect, it } from 'vitest';
import { isCarrierVisible, primaryCarriersFor } from '../carrierPicker';

const ALL = ['R+L', 'FEDEX', 'RIST', 'PICK UP', 'DAYLIGHT'];
const shown = (isFedexOrder: boolean, selected: string | null = null, showAll = false) =>
  ALL.filter((c) => isCarrierVisible(c, { isFedexOrder, selected, showAll }));

describe('Ship carrier picker — what sits before "…"', () => {
  it('a regular order shows the LTL carriers and hides FedEx', () => {
    expect(shown(false)).toEqual(['R+L', 'RIST']);
    expect(primaryCarriersFor(false).has('FEDEX')).toBe(false);
  });

  it('a FedEx order shows FedEx alone', () => {
    expect(shown(true)).toEqual(['FEDEX']);
  });

  it('the selected carrier is always visible, even from under "…"', () => {
    expect(shown(false, 'FEDEX')).toEqual(['R+L', 'FEDEX', 'RIST']);
    expect(shown(true, 'PICK UP')).toEqual(['FEDEX', 'PICK UP']);
  });

  it('"…" expanded shows everything', () => {
    expect(shown(true, null, true)).toEqual(ALL);
  });
});
