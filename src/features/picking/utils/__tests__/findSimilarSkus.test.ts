import { describe, it, expect } from 'vitest';
import { findSimilarSkus } from '../findSimilarSkus';
import type { InventoryItemWithMetadata } from '../../../../schemas/inventory.schema';

function makeItem(
  overrides: Partial<InventoryItemWithMetadata> & { sku: string }
): InventoryItemWithMetadata {
  return {
    id: Math.random(),
    quantity: 10,
    warehouse: 'LUDLOW',
    location: 'ROW 1',
    item_name: null,
    is_active: true,
    created_at: new Date(),
    ...overrides,
  } as InventoryItemWithMetadata;
}

const INVENTORY: InventoryItemWithMetadata[] = [
  makeItem({
    sku: '03-4614BK',
    item_name: 'FAULTLINE A1 V2 15 2026 GLOSS BLACK',
    location: 'ROW 43',
    quantity: 4,
  }),
  makeItem({
    sku: '03-4614RD',
    item_name: 'FAULTLINE A1 V2 15 2026 GARNET',
    location: 'ROW 10',
    quantity: 7,
  }),
  makeItem({
    sku: '03-4614WH',
    item_name: 'FAULTLINE A1 V2 15 2026 WHITE',
    location: 'ROW 5',
    quantity: 3,
  }),
  makeItem({
    sku: '03-4615BK',
    item_name: 'FAULTLINE A1 V2 17 2026 GLOSS BLACK',
    location: 'ROW 43',
    quantity: 5,
  }),
  makeItem({
    sku: '03-4616BK',
    item_name: 'FAULTLINE A1 V2 19 2026 GLOSS BLACK',
    location: 'ROW 13',
    quantity: 5,
  }),
  makeItem({
    sku: '03-3764BK',
    item_name: 'HELIX A2 16 2025 GLOSS BLACK',
    location: 'ROW 9',
    quantity: 2,
  }),
  makeItem({
    sku: '03-3764MN',
    item_name: 'HELIX A2 16 2025 SUGAR MINT',
    location: 'ROW 5',
    quantity: 3,
  }),
  makeItem({
    sku: '03-3767MN',
    item_name: 'HELIX A2 18 2025 SUGAR MINT',
    location: 'ROW 5',
    quantity: 2,
  }),
  makeItem({
    sku: '06-4572GY',
    item_name: 'EC1 18 2025 KINETIC GREY',
    location: 'ROW 2',
    quantity: 42,
  }),
  makeItem({
    sku: 'PART-001',
    item_name: 'BRAKE PAD SHIMANO',
    location: 'BIN-A1',
    quantity: 50,
    warehouse: 'LUDLOW',
  }),
  makeItem({
    sku: 'PART-002',
    item_name: 'BRAKE PAD SRAM',
    location: 'BIN-A2',
    quantity: 30,
    warehouse: 'LUDLOW',
  }),
  makeItem({
    sku: '03-4614BL',
    item_name: 'FAULTLINE A1 V2 15 2026 DEEP BLUE',
    location: 'ROW 7',
    quantity: 0,
  }), // zero qty
  makeItem({
    sku: '03-9999BK',
    item_name: 'SOMETHING ELSE',
    location: 'ROW 1',
    quantity: 5,
    warehouse: 'ATS',
  }), // different warehouse
];

describe('findSimilarSkus', () => {
  it('should find prefix matches (same model, different color)', () => {
    const results = findSimilarSkus('03-4614BK', 'LUDLOW', INVENTORY);
    expect(results.length).toBeGreaterThan(0);
    // First results should be prefix matches
    const prefixResults = results.filter((r) => r.matchType === 'prefix');
    expect(prefixResults.length).toBeGreaterThan(0);
    expect(prefixResults.every((r) => r.sku.startsWith('03-4614'))).toBe(true);
    expect(results.every((r) => r.sku !== '03-4614BK')).toBe(true);
  });

  it('should find name matches (same model name, different size)', () => {
    const results = findSimilarSkus('03-3764BK', 'LUDLOW', INVENTORY);
    // Should find 03-3764MN (prefix) and possibly 03-3767MN (name: HELIX A2)
    const prefixMatches = results.filter((r) => r.matchType === 'prefix');
    expect(prefixMatches.length).toBeGreaterThan(0);
  });

  it('should prioritize prefix matches over name matches', () => {
    const results = findSimilarSkus('03-4614BK', 'LUDLOW', INVENTORY);
    // All prefix matches should come before name matches
    const firstNameIdx = results.findIndex((r) => r.matchType === 'name');
    const lastPrefixIdx = results.reduce((acc, r, i) => (r.matchType === 'prefix' ? i : acc), -1);
    if (firstNameIdx >= 0 && lastPrefixIdx >= 0) {
      expect(lastPrefixIdx).toBeLessThan(firstNameIdx);
    }
  });

  it('should return empty array when no matches exist', () => {
    const results = findSimilarSkus('06-4572GY', 'LUDLOW', INVENTORY);
    // EC1 has no prefix siblings and unique name tokens
    expect(results).toEqual([]);
  });

  it('should return empty array for empty inventory', () => {
    expect(findSimilarSkus('03-4614BK', 'LUDLOW', [])).toEqual([]);
  });

  it('should return empty array for empty targetSku', () => {
    expect(findSimilarSkus('', 'LUDLOW', INVENTORY)).toEqual([]);
  });

  it('should filter by warehouse', () => {
    const results = findSimilarSkus('03-9999BK', 'ATS', INVENTORY);
    // No other ATS items with matching prefix
    expect(results).toEqual([]);
  });

  it('should exclude items with quantity <= 0', () => {
    const results = findSimilarSkus('03-4614BK', 'LUDLOW', INVENTORY);
    // 03-4614BL has qty=0, should not appear
    expect(results.find((r) => r.sku === '03-4614BL')).toBeUndefined();
  });

  it('should respect limit parameter', () => {
    const results = findSimilarSkus('03-4614BK', 'LUDLOW', INVENTORY, 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('should return fewer results than limit when not enough matches', () => {
    const results = findSimilarSkus('03-3764BK', 'LUDLOW', INVENTORY, 10);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should handle parts SKUs with shared name tokens', () => {
    const results = findSimilarSkus('PART-001', 'LUDLOW', INVENTORY);
    // PART-001 "BRAKE PAD SHIMANO" and PART-002 "BRAKE PAD SRAM" share "brake" and "pad"
    const brakeMatch = results.find((r) => r.sku === 'PART-002');
    expect(brakeMatch).toBeDefined();
    expect(brakeMatch?.matchType).toBe('name');
  });

  it('should handle null item_name gracefully', () => {
    const inv = [
      makeItem({ sku: '03-4614BK', item_name: null }),
      makeItem({ sku: '03-4614RD', item_name: null, quantity: 5 }),
    ];
    const results = findSimilarSkus('03-4614BK', 'LUDLOW', inv);
    // Should still find prefix match even without names
    expect(results.length).toBe(1);
    expect(results[0].sku).toBe('03-4614RD');
  });

  it('should sort by quantity as tiebreaker', () => {
    const results = findSimilarSkus('03-4614BK', 'LUDLOW', INVENTORY);
    // Among prefix matches, higher qty should come first
    for (let i = 1; i < results.length; i++) {
      if (results[i].matchType === results[i - 1].matchType) {
        expect(results[i - 1].quantity).toBeGreaterThanOrEqual(results[i].quantity);
      }
    }
  });

  it('should not leak internal _score in output', () => {
    const results = findSimilarSkus('03-4614BK', 'LUDLOW', INVENTORY);
    for (const r of results) {
      expect(r).not.toHaveProperty('_score');
    }
  });

  it('should work when target SKU is not in inventory', () => {
    const results = findSimilarSkus('03-4614XX', 'LUDLOW', INVENTORY);
    // Should still find prefix matches (03-4614BK, 03-4614RD, 03-4614WH)
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.sku.startsWith('03-4614'))).toBe(true);
  });
});
