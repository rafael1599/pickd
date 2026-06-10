import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { withSupabaseRetry } from '../../../lib/supabaseRetry';

/**
 * Batched fetch of the most-recent note per picking list.
 *
 * Why batched: the verification board renders many order cards at once and
 * each card wants to surface its latest note (in red). Calling
 * `usePickingNotes` per card would fire N realtime-subscribed queries — one
 * per visible order. Instead this hook issues a SINGLE query for all visible
 * `listIds`, ordered by `created_at` ascending, and keeps the LAST message
 * seen per `list_id` (= the latest note). The result is a plain map the cards
 * read by id, so adding a card costs nothing extra.
 *
 * The query key includes the sorted ids so it re-runs when the visible set
 * changes; the board's existing realtime invalidation on `picking_lists`
 * doesn't cover the notes table, so we also keep a short staleTime to pick up
 * new notes on refocus/refetch without a dedicated subscription per card.
 */
export const useLatestNotesByList = (listIds: string[]): Record<string, string> => {
  const ids = Array.from(new Set(listIds.filter(Boolean))).sort();

  const { data } = useQuery<Record<string, string>>({
    queryKey: ['picking_list_notes', 'latest_by_list', ids],
    enabled: ids.length > 0,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data: rows, error } = await withSupabaseRetry(
        () =>
          supabase
            .from('picking_list_notes')
            .select('list_id, message, created_at')
            .in('list_id', ids)
            .order('created_at', { ascending: true }),
        { label: 'useLatestNotesByList' }
      );
      if (error) throw error;

      const latest: Record<string, string> = {};
      for (const row of rows ?? []) {
        // Ascending order means the last write per list_id wins → latest note.
        if (row.list_id && typeof row.message === 'string') {
          latest[row.list_id] = row.message;
        }
      }
      return latest;
    },
  });

  return data ?? {};
};
