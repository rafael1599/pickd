import { supabase } from '../lib/supabase';
import type {
  RecountRequest,
  SubmitRecountResult,
  UnitsHeldByOpenOrdersResult,
} from '../schemas/recount.schema';

/**
 * Recount service for idea-263.
 * Manages open recount requests and RPCs for blind cycle counting.
 */
export async function fetchOpenRecounts(): Promise<RecountRequest[]> {
  const { data, error } = await supabase
    .from('v_recount_requests_open')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as RecountRequest[];
}

export async function submitRecount(
  sku: string,
  warehouse: string,
  location: string,
  counted: number,
  listId?: string | null
): Promise<SubmitRecountResult> {
  const { data, error } = await supabase.rpc('submit_recount', {
    p_sku: sku,
    p_warehouse: warehouse || 'LUDLOW',
    p_location: location,
    p_counted: counted,
    p_list_id: listId ?? null,
  });

  if (error) throw error;
  return data as unknown as SubmitRecountResult;
}

export async function requestRecount(
  sku: string,
  warehouse: string,
  location: string,
  reason: string
): Promise<string> {
  const { data, error } = await supabase.rpc('request_recount', {
    p_sku: sku,
    p_warehouse: warehouse || 'LUDLOW',
    p_location: location,
    p_reason: reason,
  });

  if (error) throw error;
  return data as string;
}

export async function unitsHeldByOtherOrders(
  sku: string,
  warehouse: string,
  location: string,
  listId?: string | null
): Promise<UnitsHeldByOpenOrdersResult[]> {
  const { data, error } = await supabase.rpc('units_held_by_open_orders', {
    p_sku: sku,
    p_warehouse: warehouse || 'LUDLOW',
    p_location: location,
    p_exclude_list: listId ?? null,
  });

  if (error) throw error;
  return (data ?? []) as UnitsHeldByOpenOrdersResult[];
}

export async function declareShelfShort(
  sku: string,
  warehouse: string,
  location: string,
  listId: string,
  keep: number,
  reason?: string
): Promise<{
  sku: string;
  warehouse: string;
  location: string;
  keep: number;
  target: number;
  delta: number;
  system_before: number;
}> {
  const { data, error } = await supabase.rpc('declare_shelf_short', {
    p_sku: sku,
    p_warehouse: warehouse || 'LUDLOW',
    p_location: location,
    p_list_id: listId,
    p_keep: keep,
    p_reason: reason ?? null,
  });

  if (error) throw error;
  return data as unknown as {
    sku: string;
    warehouse: string;
    location: string;
    keep: number;
    target: number;
    delta: number;
    system_before: number;
  };
}

export async function cancelRecount(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_recount', {
    p_id: id,
  });

  if (error) throw error;
}
