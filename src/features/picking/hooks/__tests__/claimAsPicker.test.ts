import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePickingActions } from '../usePickingActions';
import type { User } from '@supabase/supabase-js';

// --- Supabase mock -----------------------------------------------------------
const mockSingle = vi.fn();
const mockEq = vi.fn().mockReturnThis();
const mockSelect = vi.fn(() => ({ eq: mockEq.mockReturnValue({ single: mockSingle }) }));
const mockUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
const mockFrom = vi.fn((table: string) => {
  if (table === 'profiles') return { select: mockSelect };
  if (table === 'picking_lists') return { update: mockUpdate, select: mockSelect };
  return { select: mockSelect, update: mockUpdate };
});

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

// --- Helpers -----------------------------------------------------------------
const REAL_USER = { id: 'user-real-abc' } as User;
const SCRIPT_USER = 'user-script-xyz';

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    user: REAL_USER,
    activeListId: 'list-1',
    cartItems: [],
    orderNumber: null,
    customer: null,
    sessionMode: 'double_checking' as const,
    setCartItems: vi.fn(),
    setActiveListId: vi.fn(),
    setOrderNumber: vi.fn(),
    setCustomer: vi.fn(),
    setListStatus: vi.fn(),
    setCheckedBy: vi.fn(),
    setOwnerId: vi.fn(),
    ownerId: SCRIPT_USER,
    setCorrectionNotes: vi.fn(),
    setSessionMode: vi.fn(),
    setIsSaving: vi.fn(),
    resetSession: vi.fn(),
    loadNumber: null,
    setLoadNumber: vi.fn(),
    ...overrides,
  };
}

// --- Tests -------------------------------------------------------------------
describe('claimAsPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should claim the order when owner is "Warehouse Team"', async () => {
    const setOwnerId = vi.fn();
    mockSingle.mockResolvedValue({ data: { full_name: 'Warehouse Team' }, error: null });

    const { result } = renderHook(() =>
      usePickingActions(makeProps({ ownerId: SCRIPT_USER, setOwnerId }))
    );

    await act(() => result.current.claimAsPicker('list-1'));

    // Should have queried the profile of the script user
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockSelect).toHaveBeenCalledWith('full_name');

    // Should have updated picking_lists with the real user's id
    expect(mockFrom).toHaveBeenCalledWith('picking_lists');
    expect(mockUpdate).toHaveBeenCalledWith({ user_id: REAL_USER.id });

    // Should have updated local state
    expect(setOwnerId).toHaveBeenCalledWith(REAL_USER.id);
  });

  it('should NOT claim when owner is a real person (not Warehouse Team)', async () => {
    const setOwnerId = vi.fn();
    mockSingle.mockResolvedValue({ data: { full_name: 'Rafael Lopez' }, error: null });

    const { result } = renderHook(() =>
      usePickingActions(makeProps({ ownerId: 'other-real-user', setOwnerId }))
    );

    await act(() => result.current.claimAsPicker('list-1'));

    // Should have queried the profile
    expect(mockFrom).toHaveBeenCalledWith('profiles');

    // Should NOT have updated picking_lists
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(setOwnerId).not.toHaveBeenCalled();
  });

  it('should NOT claim when user is already the owner', async () => {
    const setOwnerId = vi.fn();

    const { result } = renderHook(() =>
      usePickingActions(makeProps({ ownerId: REAL_USER.id, setOwnerId }))
    );

    await act(() => result.current.claimAsPicker('list-1'));

    // Should not even query profiles — early return
    expect(mockFrom).not.toHaveBeenCalledWith('profiles');
    expect(setOwnerId).not.toHaveBeenCalled();
  });

  it('should NOT claim when there is no user', async () => {
    const setOwnerId = vi.fn();

    const { result } = renderHook(() => usePickingActions(makeProps({ user: null, setOwnerId })));

    await act(() => result.current.claimAsPicker('list-1'));

    expect(mockFrom).not.toHaveBeenCalled();
    expect(setOwnerId).not.toHaveBeenCalled();
  });

  it('should NOT claim when there is no listId', async () => {
    const setOwnerId = vi.fn();

    const { result } = renderHook(() =>
      usePickingActions(makeProps({ activeListId: null, setOwnerId }))
    );

    // Call without override — should use activeListId which is null
    await act(() => result.current.claimAsPicker());

    expect(mockFrom).not.toHaveBeenCalled();
    expect(setOwnerId).not.toHaveBeenCalled();
  });
});
