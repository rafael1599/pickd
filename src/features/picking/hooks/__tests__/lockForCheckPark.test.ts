import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePickingActions } from '../usePickingActions';
import { verificationProgress } from '../../utils/verificationProgress';
import type { User } from '@supabase/supabase-js';

// --- Supabase mock -----------------------------------------------------------
type UpdateCall = {
  payload: Record<string, unknown>;
  eqFilters: Record<string, unknown>;
  neqFilters: Record<string, unknown>;
  inFilters: Record<string, unknown>;
};

const updateCalls: UpdateCall[] = [];

let orderRecords: Record<
  string,
  {
    status: string;
    group_id: string | null;
    user_id: string;
    profiles?: { full_name: string } | null;
  }
> = {};

const mockMaybeSingle = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === 'picking_lists') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn((field: string, val: unknown) => {
          if (field === 'id') {
            const rec = orderRecords[String(val)];
            return {
              maybeSingle: () => Promise.resolve({ data: rec ?? null, error: null }),
            };
          }
          return { maybeSingle: mockMaybeSingle };
        }),
      })),
      update: vi.fn((payload: Record<string, unknown>) => {
        const currentCall: UpdateCall = {
          payload,
          eqFilters: {},
          neqFilters: {},
          inFilters: {},
        };
        updateCalls.push(currentCall);

        const chain: Record<string, unknown> = {};
        chain.eq = vi.fn((field: string, val: unknown) => {
          currentCall.eqFilters[field] = val;
          return chain;
        });
        chain.neq = vi.fn((field: string, val: unknown) => {
          currentCall.neqFilters[field] = val;
          return chain;
        });
        chain.in = vi.fn((field: string, val: unknown) => {
          currentCall.inFilters[field] = val;
          return chain;
        });
        chain.then = (resolve: (val: { error: null }) => void) => resolve({ error: null });
        return chain;
      }),
    };
  }
  return {
    select: vi.fn(),
    update: vi.fn(),
  };
});

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

const TEST_USER = { id: 'user-checker-1' } as User;

function makeProps() {
  return {
    user: TEST_USER,
    activeListId: 'order-a',
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
    ownerId: null,
    setCorrectionNotes: vi.fn(),
    setSessionMode: vi.fn(),
    setIsSaving: vi.fn(),
    resetSession: vi.fn(),
    loadNumber: null,
    setLoadNumber: vi.fn(),
    isInWorkflowRef: { current: false },
  };
}

describe('bug-034: lockForCheck releases previous orders identically to parkOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
    orderRecords = {
      'order-a': {
        status: 'double_checking',
        group_id: null,
        user_id: TEST_USER.id,
        profiles: { full_name: 'Checker 1' },
      },
      'order-b': {
        status: 'ready_to_double_check',
        group_id: null,
        user_id: 'other-user',
        profiles: { full_name: 'Warehouse Team' },
      },
    };
  });

  it('opening order B parks order A: keeps double_checking, clears checked_by, leaves verified_item_keys intact', async () => {
    const { result } = renderHook(() => usePickingActions(makeProps()));

    // User is currently working on order-a, then opens order-b
    await act(async () => {
      await result.current.lockForCheck('order-b');
    });

    // Verify the query that released previous double-checking locks
    const releaseCall = updateCalls.find(
      (c) =>
        c.eqFilters['checked_by'] === TEST_USER.id && c.eqFilters['status'] === 'double_checking'
    );

    expect(releaseCall).toBeDefined();
    // Must update checked_by to null and updated_at (identical to parkOrder)
    expect(releaseCall?.payload).toHaveProperty('checked_by', null);
    expect(releaseCall?.payload).toHaveProperty('updated_at');
    // CRITICAL (bug-034): Must NOT change status to ready_to_double_check
    expect(releaseCall?.payload).not.toHaveProperty('status');
    // CRITICAL: Must NOT wipe verified_item_keys
    expect(releaseCall?.payload).not.toHaveProperty('verified_item_keys');

    // Filter must target the other orders held by the user
    expect(releaseCall?.neqFilters['id']).toBe('order-b');

    // Simulate order-a state in DB after the park
    const parkedOrderA = {
      status: 'double_checking',
      checked_by: null,
      items: [
        { sku: '03-4805RD', qty: 1, location: 'ROW 1', sku_metadata: { is_bike: true } },
        { sku: '03-4808BK', qty: 1, location: 'ROW 2', sku_metadata: { is_bike: true } },
      ],
      verified_item_keys: ['1-03-4805RD-ROW 1'],
    };

    // Verification progress must calculate the real % (50%), NOT 0%
    const progress = verificationProgress(parkedOrderA);
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBe(50);

    // If order-a had been set to 'ready_to_double_check', it would falsely report 0%
    const ifDemotedToReady = { ...parkedOrderA, status: 'ready_to_double_check' };
    expect(verificationProgress(ifDemotedToReady)).toBe(0);

    // Re-opening order-a later resumes it: lockForCheck accepts double_checking
    updateCalls.length = 0;
    await act(async () => {
      await result.current.lockForCheck('order-a');
    });

    const reLockCall = updateCalls.find(
      (c) => c.payload.checked_by === TEST_USER.id && c.eqFilters['id'] === 'order-a'
    );
    expect(reLockCall).toBeDefined();
    expect(reLockCall?.payload.status).toBe('double_checking');
  });
});
