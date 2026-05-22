import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import type { SlotLayout } from './types';

/**
 * Load + save the per-user, per-row slot layout from
 * `warehouse_slot_layouts`. RLS scopes the query to auth.uid; we
 * still pass the user id explicitly so the query key invalidates
 * cleanly across sign-outs.
 *
 * The Save uses upsert keyed on (user_id, warehouse, row_name) so
 * the operator can update the layout in place without ever
 * accidentally creating a duplicate.
 */

const EMPTY_LAYOUT: SlotLayout = { groups: [] };

export function useSlotLayout(warehouse: string, rowName: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!user?.id && !!rowName;
  const queryKey = ['slot-layout', user?.id, warehouse, rowName] as const;

  const layoutQuery = useQuery({
    queryKey,
    enabled,
    queryFn: async (): Promise<SlotLayout> => {
      const { data, error } = await supabase
        .from('warehouse_slot_layouts')
        .select('layout')
        .eq('user_id', user!.id)
        .eq('warehouse', warehouse)
        .eq('row_name', rowName!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return EMPTY_LAYOUT;
      const parsed = data.layout as unknown as SlotLayout;
      // Defensive shape narrowing — a hand-edited row could have
      // missing fields; we don't want the UI to crash mid-render.
      if (!parsed || !Array.isArray(parsed.groups)) return EMPTY_LAYOUT;
      return parsed;
    },
  });

  const save = useMutation({
    mutationKey: ['save-slot-layout', warehouse, rowName],
    mutationFn: async (layout: SlotLayout) => {
      if (!user?.id || !rowName) throw new Error('Missing user or row');
      // The generated Insert type wants `layout: Json` — cast through
      // unknown because SlotLayout is a narrower TS shape and supabase's
      // Json type uses recursive aliases that don't structurally match.
      const { error } = await supabase.from('warehouse_slot_layouts').upsert(
        {
          user_id: user.id,
          warehouse,
          row_name: rowName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          layout: layout as any,
        },
        { onConflict: 'user_id,warehouse,row_name' }
      );
      if (error) throw error;
      return layout;
    },
    onSuccess: (layout) => {
      queryClient.setQueryData(queryKey, layout);
      toast.success('Layout saved');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save layout');
    },
  });

  return {
    layout: layoutQuery.data ?? EMPTY_LAYOUT,
    isLoading: layoutQuery.isLoading,
    error: layoutQuery.error,
    save: (layout: SlotLayout) => save.mutate(layout),
    isSaving: save.isPending,
  };
}
