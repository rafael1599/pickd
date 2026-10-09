import { describe, expect, it, vi } from 'vitest';
import { maybePromptRecountOnCheck } from '../doubleCheckRecount';
import type { PickingItem } from '../../../../utils/pickingLogic';
import type { RecountRequest } from '../../../../schemas/recount.schema';
import { recountKey } from '../../../../hooks/useOpenRecounts';

describe('Double Check Recount Trigger (idea-263)', () => {
  const baseItem: PickingItem = {
    sku: '03-3848BK',
    location: 'A-01-02',
    warehouse: 'LUDLOW',
    pickingQty: 2,
    isPicked: true,
  };

  const mockRecountRequest: RecountRequest = {
    id: 'req-123',
    sku: '03-3848BK',
    warehouse: 'LUDLOW',
    location: 'A-01-02',
    reason: 'Routine audit',
    requested_by: 'tester',
    created_at: '2026-10-09T10:00:00Z',
    status: 'open',
    first_counted_by: null,
    first_counted_qty: null,
    closed_at: null,
    closed_by: null,
    counted_qty: null,
    expected_qty: null,
    applied_delta: null,
  };

  it('opens RecountSheet when item is checked, open request exists, and no other open orders hold units', async () => {
    const openModal = vi.fn();
    const unitsHeldChecker = vi.fn().mockResolvedValue([]);
    const promptedRecountKeys = new Set<string>();
    const checkedItems = new Set<string>();
    const openRecountsBySkuLocation = new Map<string, RecountRequest>([
      [recountKey('03-3848BK', 'A-01-02'), mockRecountRequest],
    ]);

    const result = await maybePromptRecountOnCheck({
      item: baseItem,
      palletId: 1,
      checkedItems,
      openRecountsBySkuLocation,
      promptedRecountKeys,
      activeListId: 'list-current',
      openModal,
      unitsHeldChecker,
    });

    expect(result).toBe(true);
    expect(unitsHeldChecker).toHaveBeenCalledWith('03-3848BK', 'LUDLOW', 'A-01-02', 'list-current');
    expect(openModal).toHaveBeenCalledWith({
      type: 'recount',
      sku: '03-3848BK',
      warehouse: 'LUDLOW',
      location: 'A-01-02',
      listId: 'list-current',
      reason: 'Routine audit',
    });
    expect(promptedRecountKeys.has(recountKey('03-3848BK', 'A-01-02'))).toBe(true);
  });

  it('prioritizes item.source_list_id over activeListId in combined groups', async () => {
    const openModal = vi.fn();
    const unitsHeldChecker = vi.fn().mockResolvedValue([]);
    const promptedRecountKeys = new Set<string>();
    const checkedItems = new Set<string>();
    const openRecountsBySkuLocation = new Map<string, RecountRequest>([
      [recountKey('03-3848BK', 'A-01-02'), mockRecountRequest],
    ]);

    const combinedItem: PickingItem = {
      ...baseItem,
      source_list_id: 'list-child-suborder',
    };

    const result = await maybePromptRecountOnCheck({
      item: combinedItem,
      palletId: 1,
      checkedItems,
      openRecountsBySkuLocation,
      promptedRecountKeys,
      activeListId: 'list-anchor-group',
      openModal,
      unitsHeldChecker,
    });

    expect(result).toBe(true);
    expect(unitsHeldChecker).toHaveBeenCalledWith(
      '03-3848BK',
      'LUDLOW',
      'A-01-02',
      'list-child-suborder'
    );
    expect(openModal).toHaveBeenCalledWith(
      expect.objectContaining({
        listId: 'list-child-suborder',
      })
    );
  });

  it('does NOT open RecountSheet if other open orders hold units at that location', async () => {
    const openModal = vi.fn();
    const unitsHeldChecker = vi
      .fn()
      .mockResolvedValue([{ list_id: 'other-list', order_number: '12345', units: 1 }]);
    const promptedRecountKeys = new Set<string>();
    const checkedItems = new Set<string>();
    const openRecountsBySkuLocation = new Map<string, RecountRequest>([
      [recountKey('03-3848BK', 'A-01-02'), mockRecountRequest],
    ]);

    const result = await maybePromptRecountOnCheck({
      item: baseItem,
      palletId: 1,
      checkedItems,
      openRecountsBySkuLocation,
      promptedRecountKeys,
      activeListId: 'list-current',
      openModal,
      unitsHeldChecker,
    });

    expect(result).toBe(false);
    expect(unitsHeldChecker).toHaveBeenCalledTimes(1);
    expect(openModal).not.toHaveBeenCalled();
  });

  it('does NOT open RecountSheet on unchecking an item', async () => {
    const openModal = vi.fn();
    const unitsHeldChecker = vi.fn();
    const promptedRecountKeys = new Set<string>();
    // Item is already in checkedItems -> user is unchecking it
    const checkedItems = new Set<string>(['1-03-3848BK-A-01-02']);
    const openRecountsBySkuLocation = new Map<string, RecountRequest>([
      [recountKey('03-3848BK', 'A-01-02'), mockRecountRequest],
    ]);

    const result = await maybePromptRecountOnCheck({
      item: baseItem,
      palletId: 1,
      checkedItems,
      openRecountsBySkuLocation,
      promptedRecountKeys,
      activeListId: 'list-current',
      openModal,
      unitsHeldChecker,
    });

    expect(result).toBe(false);
    expect(unitsHeldChecker).not.toHaveBeenCalled();
    expect(openModal).not.toHaveBeenCalled();
  });

  it('does NOT prompt twice for the same item during the same view mount', async () => {
    const openModal = vi.fn();
    const unitsHeldChecker = vi.fn().mockResolvedValue([]);
    const promptedRecountKeys = new Set<string>([recountKey('03-3848BK', 'A-01-02')]);
    const checkedItems = new Set<string>();
    const openRecountsBySkuLocation = new Map<string, RecountRequest>([
      [recountKey('03-3848BK', 'A-01-02'), mockRecountRequest],
    ]);

    const result = await maybePromptRecountOnCheck({
      item: baseItem,
      palletId: 1,
      checkedItems,
      openRecountsBySkuLocation,
      promptedRecountKeys,
      activeListId: 'list-current',
      openModal,
      unitsHeldChecker,
    });

    expect(result).toBe(false);
    expect(unitsHeldChecker).not.toHaveBeenCalled();
    expect(openModal).not.toHaveBeenCalled();
  });

  it('does NOT prompt if no open recount request exists for the SKU and location', async () => {
    const openModal = vi.fn();
    const unitsHeldChecker = vi.fn();
    const promptedRecountKeys = new Set<string>();
    const checkedItems = new Set<string>();
    const openRecountsBySkuLocation = new Map<string, RecountRequest>();

    const result = await maybePromptRecountOnCheck({
      item: baseItem,
      palletId: 1,
      checkedItems,
      openRecountsBySkuLocation,
      promptedRecountKeys,
      activeListId: 'list-current',
      openModal,
      unitsHeldChecker,
    });

    expect(result).toBe(false);
    expect(unitsHeldChecker).not.toHaveBeenCalled();
    expect(openModal).not.toHaveBeenCalled();
  });
});
