import { describe, it, expect } from 'vitest';
import {
  planSingleBlock,
  formatPlanForTerminal,
  UNIFIED_FOUR_ROW_BLOCK,
  accessibilityFor,
  type CandidateSku,
  type SkuCapacityOverrides,
} from '../singleBlockPlanner';

describe('singleBlockPlanner - Final Unified Logic', () => {
  it('identifies landlocked vs accessible positions correctly across 4 rows', () => {
    // Row 33 & 30 are accessible along their whole length
    expect(accessibilityFor('33', 3, UNIFIED_FOUR_ROW_BLOCK)).toBe('accessible');
    expect(accessibilityFor('30', 3, UNIFIED_FOUR_ROW_BLOCK)).toBe('accessible');

    // Row 32 & 31 are landlocked in positions B..I (indices 1..8)
    expect(accessibilityFor('32', 0, UNIFIED_FOUR_ROW_BLOCK)).toBe('accessible'); // A
    expect(accessibilityFor('32', 9, UNIFIED_FOUR_ROW_BLOCK)).toBe('accessible'); // J
    expect(accessibilityFor('32', 4, UNIFIED_FOUR_ROW_BLOCK)).toBe('landlocked'); // E
    expect(accessibilityFor('31', 4, UNIFIED_FOUR_ROW_BLOCK)).toBe('landlocked'); // E
  });

  it('preserves physical anchoring for candidate already standing in the block', () => {
    const candidates: CandidateSku[] = [
      {
        sku: '06-ANCHORED',
        totalQty: 60,
        daysInactive: 100,
        currentPlacements: [{ row: '32', letter: 'C', units: 60 }],
      },
    ];

    const result = planSingleBlock(candidates);
    const placed = result.placedSkus[0];

    expect(placed.anchoredCount).toBe(1);
    expect(placed.palletSlots).toContain('32-C');
  });

  it('places multi-pallet SKUs first to absorb landlocked slots', () => {
    const candidates: CandidateSku[] = [
      { sku: 'SINGLE-PALLET', totalQty: 25, daysInactive: 100 },
      { sku: 'MULTI-PALLET', totalQty: 100, daysInactive: 90 },
    ];

    const result = planSingleBlock(candidates);

    // Multi-pallet should have absorbed landlocked slots
    expect(result.stats.landlockedOccupiedCount).toBeGreaterThan(0);
    // Single pallet SKU should be in accessible slot
    const singlePlaced = result.placedSkus.find((s) => s.sku === 'SINGLE-PALLET');
    const slotObj = result.slots.find((s) => s.id === singlePlaced?.palletSlots[0]);
    expect(slotObj?.accessibility).toBe('accessible');
  });

  it('supports custom SKU capacities and produces clean terminal output', () => {
    const candidates: CandidateSku[] = [{ sku: '03-xyzbr', totalQty: 80, daysInactive: 150 }];
    const overrides: SkuCapacityOverrides = { '03-xyzbr': 35 };

    const result = planSingleBlock(candidates, overrides);
    const output = formatPlanForTerminal(result);

    expect(output).toContain('OPTIMIZED PHYSICAL MAP WITH ACCESSIBILITY');
    expect(output).toContain('03-xyzbr');
    expect(output).toContain('35u');
  });
});
