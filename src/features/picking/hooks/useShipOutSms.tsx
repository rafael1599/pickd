import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import {
  buildShipOutSmsBody,
  buildShipOutSmsUrl,
  computeShipOutMetrics,
  detectSmsPlatform,
  type ShipOutSmsItem,
  type ShipOutSmsSkuMeta,
} from '../../../utils/shipOutSms';

/**
 * Wraps the "open Messages with the READY TO SHIP body prefilled" flow.
 *
 * Reads the operator's SMS toggle once and keeps it cached. After a
 * successful Double-Check slide, the caller invokes `triggerForList(listId)`.
 * We fetch the picking list, its customer, and the sku_metadata for the
 * items, then compute pallets / parts / weight the same way OrdersScreen
 * does and hand the user a `sms:` URL with NO recipient — they pick the
 * destination conversation themselves on the phone.
 *
 * We do not auto-navigate to the URL — Android Chrome's popup-blocker
 * silently kills `window.location.href = "sms:..."` if not in a tap
 * gesture. So we surface a toast with an action button; the user's tap
 * on that button counts as the gesture.
 */
export function useShipOutSms() {
  const { user } = useAuth();

  const { data: settings } = useQuery({
    queryKey: ['ship-sms-settings', user?.id],
    enabled: !!user?.id,
    // Keep settings around — they rarely change and we want fast
    // access right after the slide-to-complete.
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('shipping_sms_enabled')
        .eq('id', user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // The toggle alone gates the feature. The SMS URL never carries a
  // pre-filled recipient — operators pick the destination conversation
  // (typically an existing shipping group thread) on their phone.
  const isEnabled = !!settings?.shipping_sms_enabled;

  const triggerForList = useCallback(
    async (listId: string | null | undefined) => {
      if (!listId || !isEnabled || !settings) return;

      // Pull the list + joined customer in one round trip.
      const { data: list, error: listErr } = await supabase
        .from('picking_lists')
        .select(
          `id, order_number, pallets_qty, total_weight_lbs, shipping_type, items,
           customer:customers(name, street, city, state, zip_code)`
        )
        .eq('id', listId)
        .single();
      if (listErr || !list) {
        console.warn('useShipOutSms: failed to load list', listErr);
        return;
      }

      const items = (list.items as unknown as ShipOutSmsItem[] | null) ?? [];
      const skus = Array.from(new Set(items.map((i) => i.sku).filter(Boolean)));

      // Metadata for is_bike + weight. If the SKU is missing we treat it
      // as a 0-weight part — same fallback OrdersScreen uses before the
      // weight defaults kick in.
      const skuMeta: Record<string, ShipOutSmsSkuMeta> = {};
      if (skus.length > 0) {
        const { data: metaRows } = await supabase
          .from('sku_metadata')
          .select('sku, is_bike, weight_lbs')
          .in('sku', skus);
        for (const row of metaRows ?? []) {
          skuMeta[row.sku] = {
            is_bike: row.is_bike ?? false,
            weight_lbs: row.weight_lbs ?? null,
          };
        }
      }

      const customer = (list.customer as unknown as {
        name: string | null;
        street: string | null;
        city: string | null;
        state: string | null;
        zip_code: string | null;
      } | null) ?? {
        name: null,
        street: null,
        city: null,
        state: null,
        zip_code: null,
      };

      const metrics = computeShipOutMetrics(
        {
          order_number: list.order_number,
          pallets_qty: list.pallets_qty,
          total_weight_lbs: list.total_weight_lbs ?? null,
          shipping_type: list.shipping_type ?? null,
          items,
        },
        skuMeta
      );

      const body = buildShipOutSmsBody(
        customer,
        {
          order_number: list.order_number,
          pallets_qty: list.pallets_qty,
          total_weight_lbs: list.total_weight_lbs ?? null,
          items,
        },
        metrics
      );

      const platform = detectSmsPlatform(navigator.userAgent || '');
      const url = buildShipOutSmsUrl(body, platform);

      // Surface a toast with an action. Tapping the action counts as the
      // user gesture mobile browsers require to follow an `sms:` URL.
      toast(
        (t) => (
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold">📲 Send Ship-Out SMS?</span>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                window.location.href = url;
              }}
              className="px-3 py-1.5 rounded-lg bg-accent text-main font-black uppercase tracking-widest text-[10px]"
            >
              Send
            </button>
            <button
              onClick={() => toast.dismiss(t.id)}
              aria-label="Dismiss"
              className="px-2 py-1.5 text-muted text-xs"
            >
              ✕
            </button>
          </div>
        ),
        { duration: 15_000 }
      );
    },
    [isEnabled, settings]
  );

  return { isEnabled, triggerForList };
}
