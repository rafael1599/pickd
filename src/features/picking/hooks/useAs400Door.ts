/**
 * The door: AS400 captures the watchdog on Bay 2 has published and Pickd can
 * bring in with one tap.
 *
 * The watchdog publishes every capture into `as400_captures` the moment it has
 * it — parsed summary, items with each one's `is_bike`, raw text — so the board
 * can draw the order (FedEx/regular, customer, pallets, bikes, parts) before
 * anyone taps anything. Rafael, 2026-09-08: "la data debe estar ya en pickd, el
 * click solo le da validez". A tap calls `request_as400_capture`, which flips
 * the row to `requested`; the watchdog polls for that and sends through the
 * pipeline it always used. Nothing travels from here to Bay 2 — it cannot.
 *
 * `v_as400_door` is the list. It hides anything that already has a
 * picking_lists row, so a stale status can never show a phantom order that is
 * already on the board (see the migration for the merged "A / B" rule).
 *
 * Mounted in BottomNavigation, which is always there, rather than in the board,
 * which unmounts when closed — so one channel feeds both the nav badge and the
 * modal.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { autoClassifyShippingType } from '../../../utils/shippingClassification';
import { calculatePalletsWithBikeAwareness } from '../../../utils/pickingLogic';

// ── Types ──────────────────────────────────────────────────────────

export interface DoorItem {
  /** Canonical spelling (`03-3684BR`) — an exact-string match against sku_metadata. */
  sku: string;
  pickingQty: number;
  description?: string | null;
  unit_price?: number | null;
  /** Embedded by the watchdog, so the classifier needs no lookup. */
  sku_metadata?: { is_bike?: boolean | null } | null;
}

/**
 * `v_as400_door` only ever returns the first four. The last three come from
 * SEARCH, which reads the table directly — the list is today's work, the search
 * is the whole ledger.
 */
export type DoorStatus =
  | 'pending'
  | 'held'
  | 'requested'
  | 'sending'
  | 'archived'
  | 'sent'
  | 'junk';

export interface DoorCapture {
  order_number: string;
  status: DoorStatus;
  /** total_mismatch | waiting_locked | no_customer | stale | error */
  hold_reason: string | null;
  source: string | null;
  captured_at: string;
  updated_at: string;
  customer: string | null;
  ship_to: string | null;
  as400_account_number: string | null;
  order_date: string | null;
  item_count: number | null;
  total_units: number | null;
  subtotal: number | null;
  total_mismatch: boolean;
  items: DoorItem[];
  requested_by: string | null;
  requested_at: string | null;
  last_error: string | null;
}

export interface WatcherHeartbeat {
  seen_at: string;
  version: string | null;
}

export const DOOR_KEY = ['as400-door'] as const;
export const HEARTBEAT_KEY = ['as400-door', 'heartbeat'] as const;

/** How long without a pulse before the door says Bay 2 is not there. */
export const HEARTBEAT_STALE_MS = 60_000;

// ── Queries ────────────────────────────────────────────────────────

export function useAs400Door() {
  return useQuery<DoorCapture[]>({
    queryKey: DOOR_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_as400_door')
        .select('*')
        .order('captured_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DoorCapture[];
    },
    staleTime: 15_000,
  });
}

export function useWatcherHeartbeat() {
  return useQuery<WatcherHeartbeat | null>({
    queryKey: HEARTBEAT_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('as400_watcher_heartbeat')
        .select('seen_at, version')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return (data as WatcherHeartbeat | null) ?? null;
    },
    // Polled, not realtime: the row moves every few seconds and broadcasting
    // it would reach every open client for nothing.
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

/** Bay 2 has been heard from recently enough that a request will be executed. */
export function isWatcherAlive(hb: WatcherHeartbeat | null | undefined, now = Date.now()): boolean {
  if (!hb?.seen_at) return false;
  return now - new Date(hb.seen_at).getTime() < HEARTBEAT_STALE_MS;
}

// ── Pure helpers the modal and the badge share ─────────────────────

/** The rows a person is waiting on: not held, not yet sent. */
export function pendingCaptures(rows: DoorCapture[] | undefined): DoorCapture[] {
  return (rows ?? []).filter((r) => r.status === 'pending');
}

export function heldCaptures(rows: DoorCapture[] | undefined): DoorCapture[] {
  return (rows ?? []).filter((r) => r.status === 'held');
}

export function inFlightCaptures(rows: DoorCapture[] | undefined): DoorCapture[] {
  return (rows ?? []).filter((r) => r.status === 'requested' || r.status === 'sending');
}

/**
 * Whether "Traer" is offered. Mirrors request_as400_capture's WHERE clause so
 * the button never promises what the function will refuse: a lost page
 * (total_mismatch) needs a re-capture on Bay 2, not a tap.
 */
export function isRequestable(row: Pick<DoorCapture, 'status' | 'hold_reason'>): boolean {
  if (row.status === 'pending') return true;
  // Found by search after the list let it go, or after somebody dismissed it.
  // Asking for it is also how a dismissal is undone.
  if (row.status === 'archived' || row.status === 'junk') return true;
  if (row.status === 'held')
    return row.hold_reason === 'stale' || row.hold_reason === 'waiting_locked';
  return false;
}

/** The set of bike SKUs, read off the flags the watchdog embedded. */
export function bikeSkusOf(items: DoorItem[] | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const it of items ?? []) {
    if (it?.sku_metadata?.is_bike === true) set.add(it.sku);
  }
  return set;
}

/** What a card says about a capture, computed the way the board computes it. */
export function summarize(row: DoorCapture) {
  const items = Array.isArray(row.items) ? row.items : [];
  const bikeSkus = bikeSkusOf(items);
  const lane = autoClassifyShippingType(
    items.map((i) => ({ sku: i.sku, pickingQty: i.pickingQty, sku_metadata: i.sku_metadata })),
    bikeSkus
  );
  const pallets = calculatePalletsWithBikeAwareness(
    items.map((i) => ({ sku: i.sku, location: null, pickingQty: i.pickingQty })),
    bikeSkus
  ).length;
  let bikes = 0;
  let parts = 0;
  for (const i of items) {
    if (bikeSkus.has(i.sku)) bikes += i.pickingQty || 0;
    else parts += i.pickingQty || 0;
  }
  return { lane, pallets, bikes, parts, units: bikes + parts };
}

/**
 * Search the whole ledger, not the list.
 *
 * `v_as400_door` hides what is archived, dismissed or already in Pickd, which
 * is right for a board that should offer today's work. But the case Rafael
 * described when the door was designed — "una orden no elegida hoy que se busca
 * para jalar mañana" — lives precisely in what the list hides, so the search
 * goes to the table.
 *
 * Substring, because the watchdog's own box searches by the last three digits
 * and the muscle memory is worth keeping.
 */
export function useAs400CaptureSearch(query: string) {
  const q = query.trim();
  return useQuery<DoorCapture[]>({
    queryKey: ['as400-door', 'search', q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('as400_captures')
        .select(
          'order_number, status, hold_reason, source, captured_at, updated_at, customer, ' +
            'ship_to, as400_account_number, order_date, item_count, total_units, subtotal, ' +
            'total_mismatch, items, requested_by, requested_at, last_error'
        )
        .ilike('order_number', `%${q}%`)
        .order('captured_at', { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as unknown as DoorCapture[];
    },
    staleTime: 10_000,
  });
}

// ── Mutations ──────────────────────────────────────────────────────

function useDoorMutation(fn: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderNumber: string) => {
      const { data, error } = await supabase.rpc(
        fn as never,
        { p_order_number: orderNumber } as never
      );
      if (error) throw error;
      return data as unknown as boolean;
    },
    onSettled: () => {
      // DOOR_KEY is the prefix of the search keys too, so one invalidation
      // refreshes the list and whatever the operator is searching.
      queryClient.invalidateQueries({ queryKey: DOOR_KEY });
    },
  });
}

/** Tap "Traer". Resolves false when the row was no longer requestable. */
export function useRequestCapture() {
  return useDoorMutation('request_as400_capture');
}

/** Take a request back (yours, or any as admin). */
export function useCancelRequest() {
  return useDoorMutation('cancel_as400_request');
}

/** Mark a capture as junk so the door stops offering it. */
export function useDismissCapture() {
  return useDoorMutation('dismiss_as400_capture');
}

// ── Realtime ───────────────────────────────────────────────────────

/**
 * One channel, invalidation only (the payload carries raw_text and is not
 * worth reading). Mount once, in BottomNavigation.
 */
export function useAs400DoorRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('realtime:as400_captures')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'as400_captures' }, () => {
        queryClient.invalidateQueries({ queryKey: DOOR_KEY });
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [queryClient]);
}
