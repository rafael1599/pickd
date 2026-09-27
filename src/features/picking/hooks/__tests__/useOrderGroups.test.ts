import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrderGroups } from '../useOrderGroups';

// --- Supabase mock -----------------------------------------------------------
// picking_lists.load_number has a blanket UNIQUE constraint — createGroup/
// addToGroup must clear it on every non-anchor member so the very next save
// on the anchor doesn't collide with a sibling's stale pre-combine value.
let groupMembers: { id: string; created_at: string; load_number: string | null }[] = [];
const updatePayloads: Array<{ table: string; payload: Record<string, unknown>; target: unknown }> =
  [];

const mockFrom = vi.fn((table: string) => {
  if (table === 'order_groups') {
    return {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: 'group-1' }, error: null }),
        })),
      })),
      delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    };
  }
  if (table === 'picking_lists') {
    return {
      update: vi.fn((payload: Record<string, unknown>) => ({
        in: vi.fn((_col: string, ids: string[]) => {
          updatePayloads.push({ table, payload, target: ids });
          return Promise.resolve({ error: null });
        }),
        eq: vi.fn((_col: string, id: string) => {
          updatePayloads.push({ table, payload, target: id });
          return Promise.resolve({ error: null });
        }),
      })),
      select: vi.fn(() => ({
        eq: vi.fn().mockImplementation(() => Promise.resolve({ data: groupMembers, error: null })),
      })),
    };
  }
  return {};
});

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe('useOrderGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePayloads.length = 0;
    groupMembers = [];
  });

  it('createGroup creates an order group and assigns group_id to all member orderIds', async () => {
    const { result } = renderHook(() => useOrderGroups());
    let groupId: string | null = null;
    await act(async () => {
      groupId = await result.current.createGroup('general', ['order-a', 'order-b']);
    });

    expect(groupId).toBe('group-1');
    const updateCall = updatePayloads.find((c) => c.payload.group_id === 'group-1');
    expect(updateCall).toBeDefined();
    expect(updateCall?.target).toEqual(['order-a', 'order-b']);
  });

  it('createGroup returns null when fewer than 2 orderIds are provided', async () => {
    const { result } = renderHook(() => useOrderGroups());
    let groupId: string | null = null;
    await act(async () => {
      groupId = await result.current.createGroup('general', ['order-a']);
    });

    expect(groupId).toBeNull();
    expect(updatePayloads).toHaveLength(0);
  });

  it('addToGroup assigns group_id to the target order', async () => {
    const { result } = renderHook(() => useOrderGroups());
    let success = false;
    await act(async () => {
      success = await result.current.addToGroup('group-1', 'order-b');
    });

    expect(success).toBe(true);
    const updateCall = updatePayloads.find((c) => c.payload.group_id === 'group-1');
    expect(updateCall).toBeDefined();
    expect(updateCall?.target).toBe('order-b');
  });
});
