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

describe('useOrderGroups — load_number invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePayloads.length = 0;
    groupMembers = [];
  });

  it('createGroup clears load_number on every member except the oldest (anchor)', async () => {
    groupMembers = [
      { id: 'order-a', created_at: '2026-01-01T00:00:00Z', load_number: 'LOAD-1' },
      { id: 'order-b', created_at: '2026-01-02T00:00:00Z', load_number: 'LOAD-2' },
    ];

    const { result } = renderHook(() => useOrderGroups());
    await act(async () => {
      await result.current.createGroup('general', ['order-a', 'order-b']);
    });

    const clearCall = updatePayloads.find((c) => c.payload.load_number === null);
    expect(clearCall).toBeDefined();
    // order-a is oldest (anchor, keeps its LOAD-1) — only order-b (newer,
    // LOAD-2) should be cleared.
    expect(clearCall?.target).toEqual(['order-b']);
  });

  it('clears the newly-added member when the anchor already has a load_number', async () => {
    groupMembers = [
      { id: 'order-a', created_at: '2026-01-01T00:00:00Z', load_number: 'LOAD-1' },
      { id: 'order-b', created_at: '2026-01-02T00:00:00Z', load_number: 'LOAD-2' },
    ];

    const { result } = renderHook(() => useOrderGroups());
    await act(async () => {
      await result.current.addToGroup('group-1', 'order-b');
    });

    const clearCall = updatePayloads.find((c) => c.payload.load_number === null);
    expect(clearCall).toBeDefined();
    expect(clearCall?.target).toEqual(['order-b']);
  });

  it('does nothing when no non-anchor member has a load_number set', async () => {
    groupMembers = [
      { id: 'order-a', created_at: '2026-01-01T00:00:00Z', load_number: 'LOAD-1' },
      { id: 'order-b', created_at: '2026-01-02T00:00:00Z', load_number: null },
    ];

    const { result } = renderHook(() => useOrderGroups());
    await act(async () => {
      await result.current.addToGroup('group-1', 'order-b');
    });

    const clearCall = updatePayloads.find((c) => c.payload.load_number === null);
    expect(clearCall).toBeUndefined();
  });

  it('is a no-op when fewer than 2 members are in the group', async () => {
    groupMembers = [{ id: 'order-a', created_at: '2026-01-01T00:00:00Z', load_number: 'LOAD-1' }];

    const { result } = renderHook(() => useOrderGroups());
    await act(async () => {
      await result.current.addToGroup('group-1', 'order-a');
    });

    const clearCall = updatePayloads.find((c) => c.payload.load_number === null);
    expect(clearCall).toBeUndefined();
  });
});
