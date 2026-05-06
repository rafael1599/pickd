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
  /** Optional RMA / Return Merchandise Authorization issued by the
   *  manufacturer. Captured at intake; persisted to fedex_returns.rma. */
  rma?: string;
  /** True when the return came back due to a mis-ship rather than an RMA.
   *  Mutually independent from rma at the data layer. */
  is_misship?: boolean;
}

export function useAddFedExReturn() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async (input: AddReturnInput) => {
      const tracking = input.tracking_number;
      const performedBy = profile?.full_name ?? 'FedEx Returns';
      const userId = user?.id;
      if (!userId) {
        throw new Error('You must be signed in to register a return.');
      }

      // 1. Create the return envelope (unique tracking_number guards dupes).
      const { data: ret, error } = await supabase
        .from('fedex_returns')
        .insert({
          tracking_number: tracking,
          label_photo_url: input.label_photo_url || null,
          notes: input.notes || null,
          rma: input.rma?.trim() || null,
          is_misship: input.is_misship ?? false,
          received_by: userId,
          received_by_name: profile?.full_name ?? null,
        })
        .select()
        .single();
      if (error) throw error;

      // 2. Create a placeholder inventory row at LUDLOW.FDX with the tracking
      //    number as a temporary SKU. Users later "rename" this SKU when they
      //    identify the bike model via Return-to-Stock. is_bike forced to true
      //    because returns are always bikes (per ops policy).
      const placeholderName = `FedEx Return ${tracking}`;
      const { error: registerErr } = await (supabase.rpc as CallableFunction)('register_new_sku', {
        p_sku: tracking,
        p_item_name: placeholderName,
        p_warehouse: 'LUDLOW',
        p_location: 'FDX',
      });
      if (registerErr) throw registerErr;

      // The trigger set_sku_metadata_is_bike defaults non-bike-pattern SKUs to
      // false. Tracking numbers are pure digits — they fall through to FALSE.
      // Force TRUE so this placeholder shows up in stock view (bikes lane).
      await supabase
        .from('sku_metadata')
        .update({ is_bike: true })
        .eq('sku', tracking)
        .is('is_bike', false);

      // 3. Bump qty to 1 (the bike physically arrived).
      const { error: adjustErr } = await supabase.rpc('adjust_inventory_quantity', {
        p_sku: tracking,
        p_warehouse: 'LUDLOW',
        p_location: 'FDX',
        p_delta: 1,
        p_performed_by: performedBy,
        p_user_id: userId,
        p_merge_note: placeholderName,
      });
      if (adjustErr) throw adjustErr;

      // 4. Link the inventory row to the return so search-by-tracking and the
      //    NOW-badge enrichment find it. condition='unknown' until the user
      //    inspects it via Return-to-Stock.
      const { error: itemErr } = await supabase.from('fedex_return_items').insert({
        return_id: ret.id,
        sku: tracking,
        item_name: placeholderName,
        quantity: 1,
        condition: 'unknown',
        target_warehouse: 'LUDLOW',
      });
      if (itemErr) throw itemErr;

      return ret;
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
        rma: input.rma?.trim() || null,
        is_misship: input.is_misship ?? false,
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      // Intake now creates an inventory row at LUDLOW.FDX → refresh stock.
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['locations', 'active'] });
    },
  });
}

// ── Update Return ──────────────────────────────────────────────────

interface UpdateReturnInput {
  id: string;
  status?: ReturnStatus;
  notes?: string | null;
  label_photo_url?: string;
  rma?: string | null;
  is_misship?: boolean;
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
  target_location?: string;
  target_warehouse?: string;
}

export function useAddReturnItem() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async (input: AddItemInput) => {
      const qty = input.quantity ?? 1;
      const sku = input.sku;
      const performedBy = profile?.full_name ?? 'FedEx Returns';
      const userId = user?.id;
      if (!userId) {
        throw new Error('You must be signed in to register a return.');
      }
      const targetLocation = input.target_location?.trim().toUpperCase() || null;
      if (!targetLocation) {
        throw new Error('Target location is required.');
      }
      const targetWarehouse = input.target_warehouse ?? 'LUDLOW';

      // idea-111 + fedex-returns bundle: prefer the atomic
      // process_fedex_return_item RPC. It renames the intake placeholder, MOVEs
      // FDX → target, and auto-resolves the return — all in one transaction
      // and one inventory_logs MOVE row with the tracking number in `note`.
      // We look for an unresolved placeholder item on this return whose sku
      // matches its parent return's tracking_number (the intake convention).
      const { data: ret, error: retErr } = await supabase
        .from('fedex_returns')
        .select('id, tracking_number')
        .eq('id', input.return_id)
        .single();
      if (retErr || !ret) throw retErr ?? new Error('Return not found');

      const { data: placeholder } = await supabase
        .from('fedex_return_items')
        .select('id, quantity')
        .eq('return_id', input.return_id)
        .eq('sku', ret.tracking_number)
        .is('moved_to_location', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (placeholder) {
        // Path A: rename + move + resolve via the new RPC (preferred).
        const { data, error } = await (supabase.rpc as CallableFunction)(
          'process_fedex_return_item',
          {
            p_item_id: placeholder.id,
            p_real_sku: sku,
            p_item_name: input.item_name || sku,
            p_target_warehouse: targetWarehouse,
            p_target_location: targetLocation,
            p_condition: input.condition ?? 'good',
            p_user_id: userId,
            p_performed_by: performedBy,
          }
        );
        if (error) throw error;
        return data;
      }

      // Path B (fallback): no placeholder found — extra item being added to a
      // return that was already cleaned up. Insert a fresh items row, bump the
      // destination directly (skip the FDX buffer entirely), and auto-resolve
      // if this completes the return.
      const { data: invertedRow, error: invErr } = await supabase
        .from('inventory')
        .select('id')
        .eq('sku', sku)
        .eq('warehouse', targetWarehouse)
        .eq('location', targetLocation)
        .maybeSingle();
      if (invErr) throw invErr;

      if (!invertedRow) {
        const { error: registerErr } = await (supabase.rpc as CallableFunction)(
          'register_new_sku',
          {
            p_sku: sku,
            p_item_name: input.item_name || sku,
            p_warehouse: targetWarehouse,
            p_location: targetLocation,
          }
        );
        if (registerErr) throw registerErr;
      }

      const { error: adjustErr } = await supabase.rpc('adjust_inventory_quantity', {
        p_sku: sku,
        p_warehouse: targetWarehouse,
        p_location: targetLocation,
        p_delta: qty,
        p_performed_by: performedBy,
        p_user_id: userId,
        p_merge_note: `FedEx Return ${ret.tracking_number}`,
      });
      if (adjustErr) throw adjustErr;

      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('fedex_return_items')
        .insert({
          return_id: input.return_id,
          sku,
          item_name: input.item_name || null,
          quantity: qty,
          condition: input.condition ?? 'good',
          target_location: targetLocation,
          target_warehouse: targetWarehouse,
          moved_to_location: targetLocation,
          moved_to_warehouse: targetWarehouse,
          moved_at: nowIso,
        })
        .select()
        .single();
      if (error) throw error;

      // Auto-resolve check for path B too.
      const { count } = await supabase
        .from('fedex_return_items')
        .select('id', { count: 'exact', head: true })
        .eq('return_id', input.return_id)
        .is('moved_to_location', null);
      if ((count ?? 0) === 0) {
        await supabase
          .from('fedex_returns')
          .update({ status: 'resolved', resolved_at: nowIso, updated_at: nowIso })
          .eq('id', input.return_id);
      }
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      // Inventory caches that surface FDX stock should refresh too.
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['locations', 'active'] });
    },
  });
}

// ── Update Return Item (target location only for now) ──────────────

interface UpdateItemInput {
  itemId: string;
  target_location?: string | null;
  target_warehouse?: string | null;
}

export function useUpdateReturnItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateItemInput) => {
      const patch: Record<string, unknown> = {};
      if (input.target_location !== undefined) {
        patch.target_location = input.target_location?.trim().toUpperCase() || null;
      }
      if (input.target_warehouse !== undefined) {
        patch.target_warehouse = input.target_warehouse;
      }
      const { error } = await supabase
        .from('fedex_return_items')
        .update(patch)
        .eq('id', input.itemId);
      if (error) throw error;
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
    target_warehouse?: string;
  }>;
}

export function useResolveReturn() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async (input: ResolveInput) => {
      // Move each item to inventory
      for (const item of input.items) {
        const toWarehouse = item.target_warehouse ?? 'LUDLOW';
        const { error: moveError } = await supabase.rpc('move_inventory_stock', {
          p_sku: item.sku,
          p_from_warehouse: 'LUDLOW',
          p_from_location: 'FDX',
          p_to_warehouse: toWarehouse,
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
            moved_to_warehouse: toWarehouse,
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
