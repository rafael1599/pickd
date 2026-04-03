import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePickingActions } from '../usePickingActions';
import type { User } from '@supabase/supabase-js';
import type { CartItem } from '../usePickingCart';

// --- Supabase mock -----------------------------------------------------------
const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ select: vi.fn(() => ({ single: mockSingle })) }));
const mockUpdate = vi.fn(() => ({ eq: mockEq }));
const mockInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: mockSingle })) }));
const mockIn = vi.fn();
const mockSelect = vi.fn(() => ({ in: mockIn, eq: mockEq }));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockFrom = vi.fn((_table?: string) => ({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
}));

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

// --- Helpers -----------------------------------------------------------------
const USER = { id: 'user-1', user_id: 'user-1' } as unknown as User;
const EXISTING_LIST_ID = 'list-existing-uuid';

const CART_ITEMS = [
  { sku: 'SKU-001', warehouse: 'WH1', location: 'LINE-A', pickingQty: 2, item_name: 'Widget' },
] as unknown as CartItem[];

const STOCK_ROWS = [{ sku: 'SKU-001', quantity: 10, warehouse: 'WH1', location: 'LINE-A' }];

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    user: USER,
    activeListId: null as string | null,
    cartItems: CART_ITEMS,
    orderNumber: 'ORD-878695',
    customer: null,
    sessionMode: 'picking' as const,
    setCartItems: vi.fn(),
    setActiveListId: vi.fn(),
    setOrderNumber: vi.fn(),
    setCustomer: vi.fn(),
    setListStatus: vi.fn(),
    setCheckedBy: vi.fn(),
    setOwnerId: vi.fn(),
    ownerId: null,
    setCorrectionNotes: vi.fn(),
    setSessionMode: vi.fn(),
    setIsSaving: vi.fn(),
    resetSession: vi.fn(),
    loadNumber: null,
    setLoadNumber: vi.fn(),
    isInWorkflowRef: { current: false },
    ...overrides,
  };
}

function setupStockAndListsMock() {
  // First call: inventory stock query
  // Second call: active picking lists query
  let callCount = 0;
  mockIn.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      // inventory stock
      return Promise.resolve({ data: STOCK_ROWS, error: null });
    }
    // active lists (empty = no other reservations)
    return Promise.resolve({ data: [], error: null });
  });
}

// --- Tests -------------------------------------------------------------------
describe('generatePickingPath — bug-004 fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should INSERT a new picking_list when activeListId is null (normal flow)', async () => {
    const setActiveListId = vi.fn();
    const setSessionMode = vi.fn();

    setupStockAndListsMock();
    mockSingle.mockResolvedValue({
      data: { id: 'new-uuid', user_id: USER.id },
      error: null,
    });

    const { result } = renderHook(() =>
      usePickingActions(makeProps({ activeListId: null, setActiveListId, setSessionMode }))
    );

    await act(() => result.current.generatePickingPath());

    // Should INSERT, not UPDATE
    expect(mockFrom).toHaveBeenCalledWith('picking_lists');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER.id,
        status: 'active',
        order_number: 'ORD-878695',
      })
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(setActiveListId).toHaveBeenCalledWith('new-uuid');
    expect(setSessionMode).toHaveBeenCalledWith('picking');
  });

  it('should UPDATE existing picking_list when activeListId is set (return-from-double-check flow)', async () => {
    const setActiveListId = vi.fn();
    const setSessionMode = vi.fn();

    setupStockAndListsMock();
    mockSingle.mockResolvedValue({
      data: { id: EXISTING_LIST_ID, user_id: USER.id },
      error: null,
    });

    const { result } = renderHook(() =>
      usePickingActions(
        makeProps({ activeListId: EXISTING_LIST_ID, setActiveListId, setSessionMode })
      )
    );

    await act(() => result.current.generatePickingPath());

    // Should UPDATE, not INSERT
    expect(mockFrom).toHaveBeenCalledWith('picking_lists');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        order_number: 'ORD-878695',
      })
    );
    expect(mockEq).toHaveBeenCalledWith('id', EXISTING_LIST_ID);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(setActiveListId).toHaveBeenCalledWith(EXISTING_LIST_ID);
    expect(setSessionMode).toHaveBeenCalledWith('picking');
  });

  it('should exclude own list from reservation calculation when activeListId exists', async () => {
    const OWN_LIST = {
      id: EXISTING_LIST_ID,
      items: [{ sku: 'SKU-001', warehouse: 'WH1', location: 'LINE-A', pickingQty: 5 }],
      order_number: 'ORD-878695',
    };
    const OTHER_LIST = {
      id: 'other-list-uuid',
      items: [{ sku: 'SKU-001', warehouse: 'WH1', location: 'LINE-A', pickingQty: 3 }],
      order_number: 'ORD-999',
    };

    let callCount = 0;
    mockIn.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: STOCK_ROWS, error: null }); // 10 in stock
      }
      // Return both our list and another list
      return Promise.resolve({ data: [OWN_LIST, OTHER_LIST], error: null });
    });

    mockSingle.mockResolvedValue({
      data: { id: EXISTING_LIST_ID, user_id: USER.id },
      error: null,
    });

    const { result } = renderHook(() =>
      usePickingActions(makeProps({ activeListId: EXISTING_LIST_ID }))
    );

    // Should NOT fail with stock error — our own list's 5 reserved should be excluded
    // Only OTHER_LIST's 3 should count as reserved. Stock=10, reserved=3, we need 2 → OK
    await act(() => result.current.generatePickingPath());

    // Should succeed (UPDATE called, not a stock error)
    expect(mockUpdate).toHaveBeenCalled();
  });
});
