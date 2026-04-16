import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase.ts';
import { useAuth } from '../../../context/AuthContext.tsx';
import type { FedExReturn, FedExReturnItem, ReturnStatus } from '../types.ts';

const QUERY_KEY = ['fedex-returns'] as const;

// ── Query ──────────────────────────────────────────────────────────

export function useFedExReturns(status?: ReturnStatus) {
  return useQuery<FedExReturn[]>({
    queryKey: status ? [...QUERY_KEY, status] : QUERY_KEY,
    queryFn: async () => {
      let query = supabase
        .from('fedex_returns')
        .select('*, items:fedex_return_items(*)')
        .order('received_at', { ascending: false });
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw error;
      return data as FedExReturn[];
    },
    staleTime: 2 * 60_000,
  });
}

export function useFedExReturn(id: string) {
  return useQuery<FedExReturn>({
    queryKey: [...QUERY_KEY, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fedex_returns')
        .select('*, items:fedex_return_items(*)')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as FedExReturn;
    },
    enabled: !!id,
  });
}

// ── Add Return ─────────────────────────────────────────────────────

interface AddReturnInput {
  tracking_number: string;
  label_photo_url?: string;
  notes?: string;
}

export function useAddFedExReturn() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async (input: AddReturnInput) => {
      const { data, error } = await supabase
        .from('fedex_returns')
        .insert({
          tracking_number: input.tracking_number,
          label_photo_url: input.label_photo_url || null,
          notes: input.notes || null,
          received_by: user?.id ?? null,
          received_by_name: profile?.full_name ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<FedExReturn[]>(QUERY_KEY);
      const optimistic: FedExReturn = {
        id: crypto.randomUUID(),
        tracking_number: input.tracking_number,
        status: 'received',
        label_photo_url: input.label_photo_url || null,
        notes: input.notes || null,
        received_by: user?.id ?? null,
        received_by_name: profile?.full_name ?? null,
        processed_by: null,
        processed_by_name: null,
        received_at: new Date().toISOString(),
        processed_at: null,
        resolved_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        items: [],
      };
      queryClient.setQueryData<FedExReturn[]>(QUERY_KEY, (old) => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

// ── Update Return ──────────────────────────────────────────────────

interface UpdateReturnInput {
  id: string;
  status?: ReturnStatus;
  notes?: string | null;
  label_photo_url?: string;
}

export function useUpdateFedExReturn() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async (input: UpdateReturnInput) => {
      const { id, ...fields } = input;
      const patch: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };

      if (fields.status === 'processing') {
        patch.processed_by = user?.id ?? null;
        patch.processed_by_name = profile?.full_name ?? null;
        patch.processed_at = new Date().toISOString();
      } else if (fields.status === 'resolved') {
        patch.resolved_at = new Date().toISOString();
      }

      const { error } = await supabase.from('fedex_returns').update(patch).eq('id', id);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<FedExReturn[]>(QUERY_KEY);
      queryClient.setQueryData<FedExReturn[]>(QUERY_KEY, (old) =>
        (old ?? []).map((r) => {
          if (r.id !== input.id) return r;
          const patched = { ...r, ...input, updated_at: new Date().toISOString() };
          if (input.status === 'processing') {
            patched.processed_by = user?.id ?? null;
            patched.processed_by_name = profile?.full_name ?? null;
            patched.processed_at = new Date().toISOString();
          } else if (input.status === 'resolved') {
            patched.resolved_at = new Date().toISOString();
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

// ── Delete Return ──────────────────────────────────────────────────

export function useDeleteFedExReturn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fedex_returns').delete().eq('id', id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<FedExReturn[]>(QUERY_KEY);
      queryClient.setQueryData<FedExReturn[]>(QUERY_KEY, (old) =>
        (old ?? []).filter((r) => r.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

// ── Add Item to Return ─────────────────────────────────────────────

interface AddItemInput {
  return_id: string;
  sku: string;
  item_name?: string;
  quantity?: number;
  condition?: FedExReturnItem['condition'];
}

export function useAddReturnItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddItemInput) => {
      const { data, error } = await supabase
        .from('fedex_return_items')
        .insert({
          return_id: input.return_id,
          sku: input.sku,
          item_name: input.item_name || null,
          quantity: input.quantity ?? 1,
          condition: input.condition ?? 'good',
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

// ── Remove Item from Return ────────────────────────────────────────

export function useRemoveReturnItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from('fedex_return_items').delete().eq('id', itemId);
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

// ── Resolve Return ─────────────────────────────────────────────────
// Moves all items to inventory and marks return as resolved

interface ResolveInput {
  returnId: string;
  items: Array<{
    id: string;
    sku: string;
    quantity: number;
    target_location: string;
  }>;
}

export function useResolveReturn() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async (input: ResolveInput) => {
      // Move each item to inventory
      for (const item of input.items) {
        const { error: moveError } = await supabase.rpc('move_inventory_stock', {
          p_sku: item.sku,
          p_from_warehouse: 'LUDLOW',
          p_from_location: 'FDX',
          p_to_warehouse: 'LUDLOW',
          p_to_location: item.target_location,
          p_qty: item.quantity,
          p_performed_by: profile?.full_name ?? 'Unknown',
          p_user_id: user?.id ?? undefined,
        });

        if (moveError) throw moveError;

        // Mark item as moved
        await supabase
          .from('fedex_return_items')
          .update({
            moved_to_location: item.target_location,
            moved_to_warehouse: 'LUDLOW',
            moved_at: new Date().toISOString(),
          })
          .eq('id', item.id);
      }

      // Mark return as resolved
      const { error } = await supabase
        .from('fedex_returns')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.returnId);
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

// ── Realtime ───────────────────────────────────────────────────────

export function useFedExReturnsRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('realtime:fedex_returns')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fedex_returns' }, () => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fedex_return_items' }, () => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [queryClient]);
}
