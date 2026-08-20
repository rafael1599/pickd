import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { invalidatePickingNotes } from './usePickingNotes';

/**
 * The app's ONE subscription to `picking_list_notes`. Mount it once, high up
 * (LayoutMain); every `usePickingNotes` consumer gets live updates through the
 * query cache.
 *
 * It replaces a channel per mounted `usePickingNotes`. That hook renders once per
 * order card, so a busy board opened one channel per card — and since the
 * subscription carried no server-side filter, every one of them received every
 * note insert in the system and threw away the ones that weren't its own, then
 * fired two more queries (profile, order number) for the ones that were.
 *
 * Here a note lands once and invalidates exactly the list it belongs to; the
 * refetch brings the author and order number back with it in a single query.
 */
export function usePickingNotesRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('picking-list-notes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'picking_list_notes' },
        (payload) => {
          const listId = (payload.new as { list_id?: string } | null)?.list_id;
          if (listId) void invalidatePickingNotes(queryClient, listId);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
