import { useCallback, useMemo } from 'react';
import { useMutation, useQueries, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { withSupabaseRetry } from '../../../lib/supabaseRetry';
import { deriveSystemNoteKind } from '../../../utils/systemNotes';

export interface PickingNote {
  id: string;
  list_id: string;
  user_id: string;
  message: string;
  created_at: string;
  /** Set by the DB trigger: which system note this is, NULL when a person wrote it. */
  kind?: string | null;
  /** Whatever that kind carried — parked location, waiting reason, pallet count. */
  metadata?: NoteMetadata | null;
  user_display_name?: string;
  order_number?: string;
  /**
   * Tentative notes (added optimistically in `onMutate` before the
   * server confirms the INSERT) carry this flag.
   */
  pending?: boolean;
}

/** What we ever put in `metadata` — jsonb accepts more, we don't need more. */
export type NoteMetadata = Record<string, string | number | boolean | null>;

const PENDING_ID_PREFIX = 'pending-';

/** One cache entry per list. A combined order asks for several and merges them. */
export const pickingNotesKey = (listId: string) => ['picking-notes', listId] as const;

/**
 * `select('*')` on purpose: it keeps working against a database that has not run
 * migration 20260820190000 yet, where `kind`/`metadata` do not exist. Naming them
 * explicitly would make PostgREST 400 the whole query.
 */
async function fetchNotesForList(listId: string): Promise<PickingNote[]> {
  const { data, error } = await withSupabaseRetry(
    () =>
      supabase
        .from('picking_list_notes')
        .select('*, profiles (email, full_name), picking_lists (order_number)')
        .eq('list_id', listId)
        .order('created_at', { ascending: true }),
    { label: 'usePickingNotes.fetch' }
  );
  if (error) throw error;

  return (data ?? []).map((note) => {
    const profile = note.profiles as { full_name?: string; email?: string } | null;
    return {
      ...note,
      order_number:
        (note.picking_lists as { order_number?: string } | null)?.order_number || undefined,
      user_display_name: profile?.full_name || profile?.email || 'Unknown User',
    } as PickingNote;
  });
}

/**
 * Invalidate one list's notes. Exported so the single app-wide realtime
 * subscription can reach the cache without importing the hook.
 */
export function invalidatePickingNotes(queryClient: QueryClient, listId: string) {
  return queryClient.invalidateQueries({ queryKey: pickingNotesKey(listId) });
}

/**
 * Notes for one order, or for every member of a combined one.
 *
 * Backed by TanStack Query with a cache entry per list id, so the several places
 * that show the same order's notes at once — the Ship detail card, the one-line
 * preview inside it, the board card — share a single fetch instead of each firing
 * their own. Live updates come from ONE app-wide subscription mounted in
 * LayoutMain (`usePickingNotesRealtime`), not one channel per mounted component:
 * this hook renders per card, so that used to mean a channel per card, each of
 * them receiving every note insert in the system and discarding the ones that
 * weren't theirs.
 */
export const usePickingNotes = (listIdInput: string | string[] | null) => {
  const queryClient = useQueryClient();

  const listIds = useMemo(() => {
    if (!listIdInput) return [];
    const ids = Array.isArray(listIdInput) ? listIdInput.filter(Boolean) : [listIdInput];
    // Sorted so two components asking for the same combined order produce the
    // same query set regardless of the order they list the members in.
    return [...new Set(ids)].sort();
  }, [listIdInput]);

  const { notes, isLoading, isFetched } = useQueries({
    queries: listIds.map((listId) => ({
      queryKey: pickingNotesKey(listId),
      queryFn: () => fetchNotesForList(listId),
      staleTime: 30_000,
    })),
    combine: (results) => ({
      notes: results
        .flatMap((r) => r.data ?? [])
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      isLoading: results.some((r) => r.isLoading),
      // True once every list has come back at least once. Callers that must not
      // act on "no notes" before the answer is in (the Daylight reminder) key
      // off this rather than off `!isLoading`, which is also false in the frame
      // before the fetch starts.
      isFetched: results.length > 0 && results.every((r) => r.isFetched),
    }),
  });

  const primaryId = listIds[0] ?? null;

  const addNoteMutation = useMutation({
    mutationKey: ['add-picking-note', primaryId],
    mutationFn: async (vars: { userId: string; message: string }) => {
      if (!primaryId) throw new Error('No list selected');
      // Only `message` goes over the wire. The DB trigger derives kind/metadata
      // from it, so an insert never names a column that a not-yet-migrated
      // database lacks — which is what lets this deploy in either order.
      const { error } = await supabase.from('picking_list_notes').insert({
        list_id: primaryId,
        user_id: vars.userId,
        message: vars.message.trim(),
      });
      if (error) throw error;
    },
    onMutate: async (vars) => {
      if (!primaryId) return undefined;
      const key = pickingNotesKey(primaryId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PickingNote[]>(key);

      const tempId = `${PENDING_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const tentative: PickingNote = {
        id: tempId,
        list_id: primaryId,
        user_id: vars.userId,
        message: vars.message.trim(),
        created_at: new Date().toISOString(),
        // Classified locally with the TS mirror of the DB trigger, so a system
        // note never spends a round trip looking like a human one — long enough
        // to flash in the card's one-line preview.
        kind: deriveSystemNoteKind(vars.message),
        metadata: null,
        user_display_name: 'You',
        pending: true,
      };
      queryClient.setQueryData<PickingNote[]>(key, [...(previous ?? []), tentative]);
      return { key, previous };
    },
    onError: (err, _vars, context) => {
      console.error('Failed to add note:', err);
      if (context?.key) queryClient.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      // Pull the real row (id, author, and the kind/metadata the trigger filled).
      if (primaryId) void invalidatePickingNotes(queryClient, primaryId);
    },
  });

  const { mutateAsync } = addNoteMutation;

  /** Add a note to the primary list. */
  const addNote = useCallback(
    async (userId: string, message: string) => {
      if (!message.trim()) return;
      await mutateAsync({ userId, message });
    },
    [mutateAsync]
  );

  const fetchNotes = useCallback(() => {
    return Promise.all(listIds.map((id) => invalidatePickingNotes(queryClient, id)));
  }, [listIds, queryClient]);

  return { notes, isLoading, isFetched, fetchNotes, addNote };
};
