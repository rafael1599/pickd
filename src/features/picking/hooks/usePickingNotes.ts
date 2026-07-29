import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
   * server confirms the INSERT) carry this flag.
   */
  pending?: boolean;
}

const PENDING_ID_PREFIX = 'pending-';

export const usePickingNotes = (listIdInput: string | string[] | null) => {
  const [notes, setNotes] = useState<PickingNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const listIds = useMemo(() => {
    if (!listIdInput) return [];
    if (Array.isArray(listIdInput)) return listIdInput.filter(Boolean);
    return [listIdInput];
  }, [listIdInput]);

  const listIdsKey = listIds.sort().join(',');

  const notesRef = useRef<PickingNote[]>(notes);
  notesRef.current = notes;

  const fetchNotes = useCallback(async () => {
    if (listIds.length === 0) {
      setNotes([]);
      return;
    }

    setIsLoading(true);
    try {
      const query = supabase.from('picking_list_notes').select(`
            *,
            profiles (email, full_name)
          `);

      const finalQuery =
        listIds.length === 1 ? query.eq('list_id', listIds[0]) : query.in('list_id', listIds);

      const { data, error } = await withSupabaseRetry(
        () => finalQuery.order('created_at', { ascending: true }),
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
  }, [listIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial fetch
  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Real-time subscription for single or combined sibling list IDs
  useEffect(() => {
    if (listIds.length === 0) return;

    const channel = supabase
      .channel(`picking_notes_${listIdsKey}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'picking_list_notes',
        },
        async (payload) => {
          const newNote = payload.new as PickingNote;
          if (!listIds.includes(newNote.list_id)) return;

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
            const pendingIdx = prev.findIndex(
              (n) => n.pending && n.user_id === resolved.user_id && n.message === resolved.message
            );
            if (pendingIdx !== -1) {
              const copy = prev.slice();
              copy[pendingIdx] = resolved;
              return copy;
            }
            if (prev.some((n) => n.id === resolved.id)) return prev;
            return [...prev, resolved];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [listIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Add a note with optimistic insert.
   * Inserts into primary list ID (listIds[0]).
   */
  const addNoteMutation = useMutation({
    mutationKey: ['add-picking-note', listIdsKey],
    mutationFn: async (vars: { userId: string; message: string }) => {
      const primaryId = listIds[0];
      if (!primaryId) throw new Error('No list selected');
      const { error } = await supabase.from('picking_list_notes').insert({
        list_id: primaryId,
        user_id: vars.userId,
        message: vars.message.trim(),
      });
      if (error) throw error;
    },
    onMutate: (vars): { tempId: string } | undefined => {
      const primaryId = listIds[0];
      if (!primaryId) return undefined;
      const tempId = `${PENDING_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const tentative: PickingNote = {
        id: tempId,
        list_id: primaryId,
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
    if (listIds.length === 0 || !message.trim()) return;
    await addNoteMutation.mutateAsync({ userId, message });
  };

  return {
    notes,
    isLoading,
    fetchNotes,
    addNote,
  };
};
