import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase.ts';
import { useAuth } from '../../../context/AuthContext.tsx';

// ── Types ──────────────────────────────────────────────────────────

export interface ShoppingItem {
  id: string;
  item_name: string;
  quantity: string | null;
  note: string | null;
  urgent: boolean;
  status: 'pending' | 'done';
  requested_by: string | null;
  requested_by_name: string | null;
  done_by: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

const QUERY_KEY = ['shopping-list'] as const;

// ── Query ──────────────────────────────────────────────────────────

export function useShoppingList() {
  return useQuery<ShoppingItem[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shopping_list')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ShoppingItem[];
    },
    staleTime: 2 * 60_000,
  });
}

// ── Add ────────────────────────────────────────────────────────────

interface AddInput {
  item_name: string;
  quantity?: string;
  note?: string;
  urgent?: boolean;
}

export function useAddShoppingItem() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async (input: AddInput) => {
      const { data, error } = await supabase
        .from('shopping_list')
        .insert({
          item_name: input.item_name,
          quantity: input.quantity || null,
          note: input.note || null,
          urgent: input.urgent ?? false,
          requested_by: user?.id ?? null,
          requested_by_name: profile?.full_name ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<ShoppingItem[]>(QUERY_KEY);
      const optimistic: ShoppingItem = {
        id: crypto.randomUUID(),
        item_name: input.item_name,
        quantity: input.quantity || null,
        note: input.note || null,
        urgent: input.urgent ?? false,
        status: 'pending',
        requested_by: user?.id ?? null,
        requested_by_name: profile?.full_name ?? null,
        done_by: null,
        done_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<ShoppingItem[]>(QUERY_KEY, (old) => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

// ── Update (toggle done, edit fields) ──────────────────────────────

interface UpdateInput {
  id: string;
  status?: 'pending' | 'done';
  item_name?: string;
  quantity?: string | null;
  note?: string | null;
  urgent?: boolean;
}

export function useUpdateShoppingItem() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: UpdateInput) => {
      const { id, ...fields } = input;
      const patch: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };

      // When marking done, record who and when
      if (fields.status === 'done') {
        patch.done_by = user?.id ?? null;
        patch.done_at = new Date().toISOString();
      } else if (fields.status === 'pending') {
        patch.done_by = null;
        patch.done_at = null;
      }

      const { error } = await supabase.from('shopping_list').update(patch).eq('id', id);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<ShoppingItem[]>(QUERY_KEY);
      queryClient.setQueryData<ShoppingItem[]>(QUERY_KEY, (old) =>
        (old ?? []).map((item) => {
          if (item.id !== input.id) return item;
          const patched = { ...item, ...input, updated_at: new Date().toISOString() };
          if (input.status === 'done') {
            patched.done_by = user?.id ?? null;
            patched.done_at = new Date().toISOString();
          } else if (input.status === 'pending') {
            patched.done_by = null;
            patched.done_at = null;
          }
          return patched;
        })
      );
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

// ── Delete ─────────────────────────────────────────────────────────

export function useDeleteShoppingItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('shopping_list').delete().eq('id', id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<ShoppingItem[]>(QUERY_KEY);
      queryClient.setQueryData<ShoppingItem[]>(QUERY_KEY, (old) =>
        (old ?? []).filter((item) => item.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

// ── Realtime ───────────────────────────────────────────────────────

export function useShoppingListRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('realtime:shopping_list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_list' }, () => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [queryClient]);
}
