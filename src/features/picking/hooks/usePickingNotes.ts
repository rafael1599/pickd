import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { withSupabaseRetry } from '../../../lib/supabaseRetry';

export interface PickingNote {
  id: string;
  list_id: string;
  user_id: string;
  message: string;
  created_at: string;
  user_display_name?: string;
  /**
   * Tentative notes (added optimistically in `onMutate` before the
   * server confirms the INSERT) carry this flag. The realtime INSERT
   * handler swaps them out for the canonical server row when it
   * arrives; the toast on error removes them. Consumers can use this
   * to render a "sending…" affordance.
   */
  pending?: boolean;
}

const PENDING_ID_PREFIX = 'pending-';

export const usePickingNotes = (listId: string | null) => {
  const [notes, setNotes] = useState<PickingNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Keep the latest notes around for the realtime handler so it can
  // dedupe pending entries without re-subscribing on every state
  // change. The ref pattern mirrors usePickingSync.
  const notesRef = useRef<PickingNote[]>(notes);
  notesRef.current = notes;

  const fetchNotes = useCallback(async () => {
    if (!listId) {
      setNotes([]);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await withSupabaseRetry(
        () =>
          supabase
            .from('picking_list_notes')
            .select(
              `
                    *,
                    profiles (email, full_name)
                `
            )
            .eq('list_id', listId)
            .order('created_at', { ascending: true }),
        { label: 'usePickingNotes.fetch' }
      );

      if (error) throw error;

      const formattedNotes = (data || []).map((note) => ({
        ...note,
        user_display_name:
          (note.profiles as { full_name?: string; email?: string } | null)?.full_name ||
          (note.profiles as { full_name?: string; email?: string } | null)?.email ||
          'Unknown User',
      }));

      setNotes(formattedNotes);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [listId]);

  // Initial fetch
  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Real-time subscription. When an INSERT arrives, dedupe against
  // any pending entry the local user already added optimistically
  // (matching user_id + message) so the note doesn't flicker in/out.
  useEffect(() => {
    if (!listId) return;

    const channel = supabase
      .channel(`picking_notes_${listId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'picking_list_notes',
          filter: `list_id=eq.${listId}`,
        },
        async (payload) => {
          const newNote = payload.new as PickingNote;

          // Fetch profile for the new note to get the name
          const { data: profile } = await withSupabaseRetry(
            () =>
              supabase
                .from('profiles')
                .select('email, full_name')
                .eq('id', newNote.user_id)
                .single(),
            { label: 'usePickingNotes.realtimeProfile', maxAttempts: 2 }
          );

          const resolved: PickingNote = {
            ...newNote,
            user_display_name: profile?.full_name || profile?.email || 'Unknown User',
          };

          setNotes((prev) => {
            // Replace a matching pending entry in place if one
            // exists — preserves list order and avoids flicker.
            const pendingIdx = prev.findIndex(
              (n) => n.pending && n.user_id === resolved.user_id && n.message === resolved.message
            );
            if (pendingIdx !== -1) {
              const copy = prev.slice();
              copy[pendingIdx] = resolved;
              return copy;
            }
            // Otherwise append. Note: if for some reason the realtime
            // event fires twice, the duplicate id check below would
            // prevent stacking — but the standard flow has exactly one
            // INSERT echo per real row.
            if (prev.some((n) => n.id === resolved.id)) return prev;
            return [...prev, resolved];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [listId]);

  /**
   * Add a note with optimistic insert.
   *
   * - `onMutate` inserts a tentative entry tagged `pending: true` so
   *   the UI renders it instantly. The id starts with `PENDING_ID_PREFIX`
   *   so consumers can style/identify it.
   * - The realtime INSERT handler (above) replaces the pending entry
   *   in place when the server echoes back.
   * - `onError` removes the pending entry and surfaces the error.
   *
   * Inherits the project's mutation retry+backoff defaults from
   * query-client.ts.
   */
  const addNoteMutation = useMutation({
    mutationKey: ['add-picking-note', listId],
    mutationFn: async (vars: { userId: string; message: string }) => {
      if (!listId) throw new Error('No list selected');
      const { error } = await supabase.from('picking_list_notes').insert({
        list_id: listId,
        user_id: vars.userId,
        message: vars.message.trim(),
      });
      if (error) throw error;
    },
    onMutate: (vars): { tempId: string } | undefined => {
      if (!listId) return undefined;
      const tempId = `${PENDING_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const tentative: PickingNote = {
        id: tempId,
        list_id: listId,
        user_id: vars.userId,
        message: vars.message.trim(),
        created_at: new Date().toISOString(),
        user_display_name: 'You',
        pending: true,
      };
      setNotes((prev) => [...prev, tentative]);
      return { tempId };
    },
    onError: (err, _vars, context) => {
      console.error('Failed to add note:', err);
      if (context?.tempId) {
        setNotes((prev) => prev.filter((n) => n.id !== context.tempId));
      }
    },
  });

  const addNote = async (userId: string, message: string) => {
    if (!listId || !message.trim()) return;
    // mutateAsync so callers awaiting on this still get the
    // post-resolution behavior; failures throw, matching the
    // pre-refactor signature.
    await addNoteMutation.mutateAsync({ userId, message });
  };

  return {
    notes,
    isLoading,
    fetchNotes,
    addNote,
  };
};
