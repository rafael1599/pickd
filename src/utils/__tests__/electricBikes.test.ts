import { describe, it, expect } from 'vitest';
import type { ElectricBikeCandidate } from '../electricBikes';
import {
  ELECTRIC_BIKE_SKUS,
  collectElectricBikeLines,
  hasElectricModelToken,
  isElectricBikeItem,
  isElectricBikeSku,
  totalElectricUnits,
} from '../electricBikes';

/**
 * Every case here is a row that exists in prod. The near-misses are the point:
 * the Earth Cruiser and the E2 diagnostic tool are what a looser rule would
 * have slapped a battery label on.
 */
describe('electric bike detection', () => {
  it('knows the four families in the catalog', () => {
    expect(ELECTRIC_BIKE_SKUS.size).toBe(18);
    for (const sku of ['03-4869MN', '03-3607GY', '03-4606BL', '03-4613BK', 'Y21A003411']) {
      expect(isElectricBikeSku(sku)).toBe(true);
    }
  });

  it('matches the model token however the name is written', () => {
    expect(hasElectricModelToken('HUDSON E1 STEP-OVER 18 VANILLA MINT')).toBe(true);
    expect(hasElectricModelToken('DEFCON E2 19 2026 BLACK COAL')).toBe(true);
    expect(hasElectricModelToken('Hudson E2 Step-Thru 27.5"*14" Deep Blue')).toBe(true);
    expect(hasElectricModelToken('HUDSON E-1 19 MIDNIGHT BLUE')).toBe(true);
  });

  it('does not read the Earth Cruiser as electric', () => {
    // 06-4470TL and Y25B001636 are the same bike, "EC3" and "EARTH CRUISER 3",
    // same colorway. The digit has to be its own token or this bike ships with
    // a lithium mark it does not have.
    expect(hasElectricModelToken('EC3 18 TEAL FO REAL')).toBe(false);
    expect(hasElectricModelToken('EC1 21 RADIANT')).toBe(false);
    expect(hasElectricModelToken('EARTH CRUISER 3')).toBe(false);
    expect(isElectricBikeItem({ sku: '06-4473TL', item_name: 'EC3 21 Teal' })).toBe(false);
  });

  it('does not read an E-something part as the bike itself', () => {
    // 31-216 has no generation digit at all.
    expect(hasElectricModelToken('CABLE BOX DIACOMP E BRAKE')).toBe(false);
    // 99-3604 does, and has shipped on seven real orders. is_bike is what
    // separates the tool from the bike it services.
    expect(hasElectricModelToken('TOOL HYENA DIAGNOSTIC (E2)')).toBe(true);
    expect(
      isElectricBikeItem({
        sku: '99-3604',
        item_name: 'TOOL HYENA DIAGNOSTIC (E2)',
        isBike: false,
      })
    ).toBe(false);
  });

  it('warns on a known SKU even when the item carries no name', () => {
    // 1.035 of 5.814 order items have no item_name, twelve of them these bikes.
    expect(isElectricBikeItem({ sku: '03-4608BL', item_name: null })).toBe(true);
    expect(isElectricBikeItem({ sku: '03-4611BK' })).toBe(true);
  });

  it('warns on a known SKU even when its metadata says part', () => {
    // The SKU set is checked before is_bike, so a mis-flagged row still warns.
    expect(isElectricBikeItem({ sku: '03-4610BK', isBike: false })).toBe(true);
  });

  it('warns on a new SKU the list has never seen', () => {
    // The list rots the day a colorway is registered; the pattern is what keeps
    // the alert alive until someone updates it.
    expect(isElectricBikeItem({ sku: '03-9999BK', item_name: 'HUDSON E3 21 2027 GLOSS' })).toBe(
      true
    );
  });

  it('keeps warning while is_bike is still unresolved', () => {
    // undefined is "the lookup hasn't come back", not "it's a part".
    expect(
      isElectricBikeItem({ sku: '03-9999BK', item_name: 'DEFCON E1 15 2027', isBike: undefined })
    ).toBe(true);
  });

  it('follows a mangled or de-dashed SKU back to the bike', () => {
    // The watcher emits both forms off the PDF.
    expect(isElectricBikeSku('034869MN')).toBe(true);
    expect(isElectricBikeSku('03-4869MNH')).toBe(true);
    expect(isElectricBikeSku('')).toBe(false);
    expect(isElectricBikeSku(null)).toBe(false);
  });
});

describe('collectElectricBikeLines', () => {
  type ElectricLine = ElectricBikeCandidate & { pickingQty?: number };
  const qty = (item: ElectricLine) => item.pickingQty ?? 0;

  it('lists one entry per SKU with units summed', () => {
    const lines = collectElectricBikeLines(
      [
        { sku: '03-4869MN', item_name: 'Hudson E1 Step-Over 18 Vanilla Mint', pickingQty: 4 },
        { sku: '03-4034BK', item_name: 'HUDSON 17 GLOSS BLACK', pickingQty: 12 },
        // A combined order lists the same bike once per source order.
        { sku: '03-4869MN', item_name: 'Hudson E1 Step-Over 18 Vanilla Mint', pickingQty: 1 },
        { sku: '03-4606BL', item_name: 'DEFCON E1 15 2026 GALACTIC', pickingQty: 2 },
      ],
      qty
    );

    expect(lines).toEqual([
      { sku: '03-4869MN', name: 'Hudson E1 Step-Over 18 Vanilla Mint', units: 5 },
      { sku: '03-4606BL', name: 'DEFCON E1 15 2026 GALACTIC', units: 2 },
    ]);
    expect(totalElectricUnits(lines)).toBe(7);
  });

  it('takes the name from whichever line has one', () => {
    const lines = collectElectricBikeLines(
      [
        { sku: '03-4608BL', item_name: null, pickingQty: 1 },
        { sku: '03-4608BL', item_name: 'DEFCON E1 19 2026 GALACTIC', pickingQty: 1 },
      ],
      qty
    );
    expect(lines).toEqual([{ sku: '03-4608BL', name: 'DEFCON E1 19 2026 GALACTIC', units: 2 }]);
  });

  it('is empty for an order with no electric bikes', () => {
    expect(
      collectElectricBikeLines(
        [{ sku: '03-4034BK', item_name: 'HUDSON 17 GLOSS BLACK', pickingQty: 142 }],
        qty
      )
    ).toEqual([]);
    expect(collectElectricBikeLines<ElectricLine>(null, qty)).toEqual([]);
    expect(collectElectricBikeLines<ElectricLine>([], qty)).toEqual([]);
  });
});
