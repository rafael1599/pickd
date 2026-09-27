import { describe, it, expect } from 'vitest';
import {
  calculateShipmentPalletsAndWeight,
  calculateCombineRecalculation,
  calculateSplitRecalculation,
} from '../utils/recalculateShipments';
import type { BikeSets } from '../../pallets/planPallets';

describe('recalculateShipments utility', () => {
  const bikeSets: BikeSets = {
    bikes: new Set(['BIKE-ADULT-1', 'BIKE-ADULT-2']),
    smallBikes: new Set(['BIKE-KID-1']),
  };

  const metaBySku = {
    'BIKE-ADULT-1': { is_bike: true, weight_lbs: 30 },
    'BIKE-ADULT-2': { is_bike: true, weight_lbs: 35 },
    'PART-PEDAL': { is_bike: false, weight_lbs: 2 },
  };

  it('calculates pallets and weight for a single shipment with bikes and parts', () => {
    const items = [
      { sku: 'BIKE-ADULT-1', pickingQty: 2 },
      { sku: 'PART-PEDAL', pickingQty: 4 },
    ];

    const result = calculateShipmentPalletsAndWeight(items, bikeSets, metaBySku);
    expect(result.pallets).toBeGreaterThanOrEqual(1);
    expect(result.weight).toBeGreaterThan(0);
    expect(result.dims).toEqual([]);
  });

  it('calculates zero pallets for FedEx shipments', () => {
    const items = [{ sku: 'BIKE-ADULT-1', pickingQty: 2 }];

    const result = calculateShipmentPalletsAndWeight(items, bikeSets, metaBySku, true);
    expect(result.pallets).toBe(0);
    // FedEx does not add pallet deck weight
    expect(result.weight).toBe(60); // 2 * 30 lbs
  });

  it('recalculates combined items correctly', () => {
    const targetItems = [{ sku: 'BIKE-ADULT-1', pickingQty: 10 }];
    const sourceItems = [[{ sku: 'BIKE-ADULT-2', pickingQty: 10 }]];

    const combined = calculateCombineRecalculation(targetItems, sourceItems, bikeSets, metaBySku);

    // 20 adult bikes require multiple pallets
    expect(combined.pallets).toBeGreaterThanOrEqual(2);
    // 10 * 30 + 10 * 35 + pallets * DECK_WEIGHT_LBS
    expect(combined.weight).toBeGreaterThan(650);
    expect(combined.dims).toEqual([]);
  });

  it('recalculates split items separating source and target', () => {
    const remainingItems = [{ sku: 'BIKE-ADULT-1', pickingQty: 5 }];
    const exitingItems = [{ sku: 'BIKE-ADULT-2', pickingQty: 2 }];

    const { source, target } = calculateSplitRecalculation(
      remainingItems,
      exitingItems,
      bikeSets,
      metaBySku
    );

    expect(source.pallets).toBeGreaterThanOrEqual(1);
    expect(target.pallets).toBeGreaterThanOrEqual(1);
    expect(source.weight).toBeGreaterThan(target.weight);
    expect(source.dims).toEqual([]);
    expect(target.dims).toEqual([]);
  });
});
