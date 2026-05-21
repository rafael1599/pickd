import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { withSupabaseRetry } from '../../../lib/supabaseRetry';

export interface PickingNote {
  id: string;
  list_id: string;
  user_id: string;
  message: string;
  created_at: string;
  user_display_name?: string;
}

export const usePickingNotes = (listId: string | null) => {
  const [notes, setNotes] = useState<PickingNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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

  // Real-time subscription
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

          setNotes((prev) => [
            ...prev,
            {
              ...newNote,
              user_display_name: profile?.full_name || profile?.email || 'Unknown User',
            },
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [listId]);

  const addNote = async (userId: string, message: string) => {
    if (!listId || !message.trim()) return;

    try {
      const { error } = await supabase.from('picking_list_notes').insert({
        list_id: listId,
        user_id: userId,
        message: message.trim(),
      });

      if (error) throw error;
    } catch (err) {
      console.error('Failed to add note:', err);
      throw err;
    }
  };

  return {
    notes,
    isLoading,
    fetchNotes,
    addNote,
  };
};
