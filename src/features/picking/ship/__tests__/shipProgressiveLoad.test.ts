import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { mockSupabase } from '../../../../test/mocks/supabase';
import { pickAutoSelectCandidate } from '../utils/autoSelect';
import { orderBlockers } from '../utils/shipNotes';
import {
  ensurePickingNotes,
  groupNotesByList,
  pickingNotesKey,
  type PickingNote,
} from '../../hooks/usePickingNotes';

const retry = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock('../../../../lib/supabaseRetry', () => ({
  withSupabaseRetry: vi.fn(async (build: () => unknown) => {
    build();
    return { data: retry.rows, error: null };
  }),
}));

const note = (
  list_id: string,
  message: string,
  created_at = '2026-09-27T10:00:00Z'
): PickingNote => ({
  id: `${list_id}-${message}`,
  list_id,
  user_id: 'u1',
  message,
  created_at,
  kind: null,
});

describe('pickAutoSelectCandidate — the order Ship opens by itself', () => {
  const o = (id: string, status: string) => ({ id, status });

  it('opens the newest completed order in To Ship, not the newest row', () => {
    const toShip = [o('a', 'double_checking'), o('b', 'completed'), o('c', 'completed')];
    expect(pickAutoSelectCandidate(toShip, [])?.id).toBe('b');
  });

  it('falls back to the newest To Ship, then to the newest shipped', () => {
    expect(pickAutoSelectCandidate([o('a', 'active')], [o('s', 'completed')])?.id).toBe('a');
    expect(pickAutoSelectCandidate([], [o('s', 'completed')])?.id).toBe('s');
  });

  it('opens nothing when both columns are empty', () => {
    expect(pickAutoSelectCandidate([], [])).toBeNull();
  });
});

describe('groupNotesByList — seeding the cards', () => {
  it('keeps a list with no notes as an empty answer, not a missing one', () => {
    const byList = groupNotesByList(['a', 'b'], [note('a', 'hi')]);
    expect(byList.get('a')?.map((n) => n.message)).toEqual(['hi']);
    expect(byList.get('b')).toEqual([]);
  });

  it('orders each list oldest first and drops notes of lists not asked for', () => {
    const byList = groupNotesByList(
      ['a'],
      [note('a', 'second', '2026-09-27T11:00:00Z'), note('a', 'first'), note('z', 'other')]
    );
    expect(byList.get('a')?.map((n) => n.message)).toEqual(['first', 'second']);
    expect(byList.has('z')).toBe(false);
  });
});

describe('ensurePickingNotes — one query for every card', () => {
  beforeEach(() => {
    mockSupabase.in.mockClear();
    retry.rows = [];
  });

  it('asks once for the lists without cache and seeds every one, empty ones included', async () => {
    const qc = new QueryClient();
    qc.setQueryData(pickingNotesKey('cached'), [note('cached', 'kept')]);
    retry.rows = [{ ...note('a', 'HOLD FOR ADDS'), profiles: null, picking_lists: null }];

    const notes = await ensurePickingNotes(qc, ['a', 'b', 'cached']);

    expect(mockSupabase.in).toHaveBeenCalledTimes(1);
    expect(mockSupabase.in).toHaveBeenCalledWith('list_id', ['a', 'b']);
    expect(qc.getQueryData<PickingNote[]>(pickingNotesKey('a'))?.map((n) => n.message)).toEqual([
      'HOLD FOR ADDS',
    ]);
    expect(qc.getQueryData(pickingNotesKey('b'))).toEqual([]);
    expect(notes.map((n) => n.message).sort()).toEqual(['HOLD FOR ADDS', 'kept']);
  });

  it('does not ask again when every list is already cached', async () => {
    const qc = new QueryClient();
    qc.setQueryData(pickingNotesKey('a'), []);
    await ensurePickingNotes(qc, ['a']);
    expect(mockSupabase.in).not.toHaveBeenCalled();
  });
});

describe('orderBlockers — the ship confirm reads every member', () => {
  const combined = {
    order_number: '881001 / 881002',
    notes: null,
    transport_company: null,
    member_notes: [
      { orderNumber: '881001', notes: null },
      { orderNumber: '881002', notes: null },
    ],
  };

  it('stops on a hold a person typed on the second member, not only the anchor', () => {
    const blockers = orderBlockers(combined, [note('member-2', 'HOLD FOR ADDS')]);
    expect(blockers.length).toBeGreaterThan(0);
  });

  it('has nothing to say when no member has a note', () => {
    expect(orderBlockers(combined, [])).toEqual([]);
  });
});
