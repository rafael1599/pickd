import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Printer from 'lucide-react/dist/esm/icons/printer';
import { publicSupabase } from '../../lib/publicSupabase';
import { useCombinedOrderFilter } from '../../hooks/useCombinedOrderFilter';
import {
  CombinedOrderNumbers,
  ActiveFilterPill,
} from '../../components/orders/CombinedOrderNumbers';
import { PalletPhotosBlock } from '../../components/orders/PalletPhotosBlock';
import { mergeSiblingPalletPhotos } from '../../utils/mergeSiblingPalletPhotos';
import { transportLogoSrc } from '../../components/orders/transportLogos';
import { printOrderDetail } from './lib/printOrderDetail';
import type { OrderItem, OrderRow } from './hooks/useOrdersOfDay';

export interface PublicOrderRow {
  id: string;
  order_number: string | null;
  status: string;
  items: OrderItem[] | null;
  notes: string | null;
  source_order_date: string | null;
  pallets_qty: number | null;
  total_units: number | null;
  load_number: string | null;
  created_at: string;
  updated_at: string;
  transport_company: string | null;
  total_weight_lbs: number | null;
  pallet_photos: string[] | null;
  is_shipped: boolean | null;
  combine_meta: unknown;
  group_id: string | null;
  customer: {
    id: string;
    name: string;
    street: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
    phone: string | null;
  } | null;
  picker: string | null;
  checker: string | null;
}

export interface MergedOrder {
  orderNumber: string;
  combinedNumbers: string[];
  status: string;
  items: (OrderItem & { source_order?: string })[];
  notes: string | null;
  sourceOrderDate: string | null;
  palletsQty: number;
  totalUnits: number;
  totalWeightLbs: number;
  loadNumber: string | null;
  createdAt: string;
  updatedAt: string;
  transportCompany: string | null;
  palletPhotos: string[];
  isShipped: boolean;
  customer: PublicOrderRow['customer'];
  picker: string | null;
  checker: string | null;
  unitsByOrder: Record<string, number>;
}

export function mergePublicOrderRows(rows: PublicOrderRow[]): MergedOrder | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const anchor = sorted[0];

  const combinedNumbers = sorted
    .map((r) => r.order_number)
    .filter((n): n is string => !!n)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  const items = sorted.flatMap((r) =>
    (r.items ?? []).map((item) => ({ ...item, source_order: r.order_number ?? 'unknown' }))
  );

  const unitsByOrder: Record<string, number> = {};
  for (const item of items) {
    if (!item.source_order) continue;
    unitsByOrder[item.source_order] =
      (unitsByOrder[item.source_order] ?? 0) + (item.pickingQty || 0);
  }

  return {
    orderNumber: combinedNumbers.join(' / ') || anchor.order_number || anchor.id.slice(-6),
    combinedNumbers,
    status: anchor.status,
    items,
    notes:
      sorted
        .map((r) => r.notes)
        .filter(Boolean)
        .join('\n\n') || null,
    sourceOrderDate: anchor.source_order_date,
    palletsQty: sorted.reduce((sum, r) => sum + (r.pallets_qty ?? 0), 0),
    totalUnits:
      items.length > 0
        ? items.reduce((sum, i) => sum + (i.pickingQty || 0), 0)
        : sorted.reduce((sum, r) => sum + (r.total_units ?? 0), 0),
    totalWeightLbs: sorted.reduce((sum, r) => sum + (r.total_weight_lbs ?? 0), 0),
    loadNumber: anchor.load_number,
    createdAt: sorted.reduce(
      (min, r) => (r.created_at < min ? r.created_at : min),
      anchor.created_at
    ),
    updatedAt: sorted.reduce(
      (max, r) => (r.updated_at > max ? r.updated_at : max),
      anchor.updated_at
    ),
    transportCompany: anchor.transport_company,
    palletPhotos: mergeSiblingPalletPhotos(
      sorted.map((r) => ({ id: r.id, pallet_photos: r.pallet_photos }))
    ).photos,
    isShipped: sorted.every((r) => !!r.is_shipped),
    customer: sorted.find((r) => r.customer)?.customer ?? null,
    picker: anchor.picker,
    checker: anchor.checker,
    unitsByOrder,
  };
}

function formatDate(source: string | null | undefined): string {
  if (!source) return '—';
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-bold text-gray-900 text-right">{value}</span>
    </div>
  );
}

/**
 * Public, no-login order detail — what the printed packing-slip QR
 * (printOrderDetail.ts) links to. Reads via the get_public_order RPC (RLS
 * on picking_lists/customers is authenticated-only, so this can't be a
 * direct table select) and reuses the same click-to-filter components as
 * the authenticated screens so a combined order behaves identically here.
 */
export const PublicOrderView = () => {
  const { orderNumber: routeOrderNumber } = useParams<{ orderNumber: string }>();
  const [rows, setRows] = useState<PublicOrderRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!routeOrderNumber) {
      setError(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error: rpcError } = await publicSupabase.rpc(
          'get_public_order' as never,
          {
            p_order_number: routeOrderNumber,
          } as never
        );
        if (cancelled) return;
        if (rpcError || !Array.isArray(data) || data.length === 0) {
          setError(true);
        } else {
          setRows(data as unknown as PublicOrderRow[]);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeOrderNumber]);

  const merged = useMemo(() => (rows ? mergePublicOrderRows(rows) : null), [rows]);
  const { combinedNumbers, activeOrderFilter, toggleOrderFilter, clearOrderFilter } =
    useCombinedOrderFilter(merged?.orderNumber ?? null);

  const filteredItems = useMemo(() => {
    if (!merged) return [];
    if (!activeOrderFilter) return merged.items;
    return merged.items.filter((item) => item.source_order === activeOrderFilter);
  }, [merged, activeOrderFilter]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-gray-400 w-8 h-8" />
      </div>
    );
  }

  if (error || !merged) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8 text-center font-sans">
        <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4 text-gray-500 font-bold text-2xl">
          ?
        </div>
        <h1 className="text-xl font-black text-gray-900 mb-2">Order Not Found</h1>
        <p className="text-sm text-gray-500 max-w-xs mb-6">
          {routeOrderNumber
            ? `Order #${routeOrderNumber} — this order may have been cancelled or the link is invalid.`
            : 'This link is invalid.'}
        </p>
        <a
          href="/ship"
          className="inline-flex items-center px-4 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-wider hover:bg-gray-800 transition-all shadow-sm active:scale-95"
        >
          Go to Ship Dashboard
        </a>
      </div>
    );
  }

  const cityLine = [merged.customer?.city, merged.customer?.state, merged.customer?.zip_code]
    .filter(Boolean)
    .join(', ');
  const logoPath = transportLogoSrc(merged.transportCompany);

  const handlePrint = () => {
    const printRow: OrderRow = {
      id: rows?.[0]?.id ?? merged.orderNumber,
      order_number: merged.orderNumber,
      customer_id: merged.customer?.id ?? null,
      status: merged.status,
      items: filteredItems,
      notes: merged.notes,
      source_order_date: merged.sourceOrderDate,
      shipping_type: null,
      pallets_qty: merged.palletsQty,
      total_units: merged.totalUnits,
      load_number: merged.loadNumber,
      created_at: merged.createdAt,
      updated_at: merged.updatedAt,
      user_id: null,
      checked_by: null,
      transport_company: merged.transportCompany,
      total_weight_lbs: merged.totalWeightLbs,
      pallet_photos: merged.palletPhotos,
      is_waiting_inventory: null,
      is_shipped: merged.isShipped,
      customer: merged.customer,
      order_group: null,
      user: { full_name: merged.picker },
      checker: { full_name: merged.checker },
    };
    const bikes = 0;
    const parts = 0;
    void printOrderDetail(printRow, { bikes, parts });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Header */}
          <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                PickD Order
              </p>
              {combinedNumbers.length > 1 ? (
                <CombinedOrderNumbers
                  numbers={combinedNumbers}
                  activeOrderFilter={activeOrderFilter}
                  onToggle={toggleOrderFilter}
                  unitsByOrder={merged.unitsByOrder}
                  variant="header"
                />
              ) : (
                <h1 className="text-2xl font-black text-gray-900">#{merged.orderNumber}</h1>
              )}
            </div>
            {logoPath && (
              <img
                src={logoPath}
                alt={merged.transportCompany ?? ''}
                className="h-8 object-contain"
              />
            )}
          </div>

          {/* Status + meta */}
          <div className="p-5 border-b border-gray-100 grid grid-cols-2 gap-x-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                Ship To
              </p>
              <p className="text-sm font-bold text-gray-900">{merged.customer?.name || '—'}</p>
              {merged.customer?.street && (
                <p className="text-sm text-gray-600">{merged.customer.street}</p>
              )}
              {cityLine && <p className="text-sm text-gray-600">{cityLine}</p>}
              {merged.customer?.phone && (
                <p className="text-sm text-gray-600">{merged.customer.phone}</p>
              )}
            </div>
            <div>
              <InfoRow label="Status" value={merged.isShipped ? 'Shipped' : merged.status} />
              <InfoRow
                label="Order date"
                value={formatDate(merged.sourceOrderDate || merged.createdAt)}
              />
              <InfoRow label="Updated" value={formatDate(merged.updatedAt)} />
              <InfoRow label="Load #" value={merged.loadNumber} />
              <InfoRow label="Carrier" value={merged.transportCompany} />
              <InfoRow label="Picked by" value={merged.picker} />
              <InfoRow label="Checked by" value={merged.checker} />
            </div>
          </div>

          {/* Summary chips */}
          <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-2">
            {merged.palletsQty > 0 && (
              <span className="text-xs font-black uppercase tracking-wide bg-gray-100 text-gray-700 rounded-full px-3 py-1">
                {merged.palletsQty} pallets
              </span>
            )}
            {merged.totalUnits > 0 && (
              <span className="text-xs font-black uppercase tracking-wide bg-gray-100 text-gray-700 rounded-full px-3 py-1">
                {merged.totalUnits} units
              </span>
            )}
            {merged.totalWeightLbs > 0 && (
              <span className="text-xs font-black uppercase tracking-wide bg-gray-100 text-gray-700 rounded-full px-3 py-1">
                {merged.totalWeightLbs} lbs
              </span>
            )}
          </div>

          {merged.notes && (
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                Order Notes
              </p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{merged.notes}</p>
            </div>
          )}

          {/* Items */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Items ({filteredItems.length}){activeOrderFilter && ` — #${activeOrderFilter} only`}
              </p>
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-[11px] font-black uppercase tracking-wider active:scale-95 transition-transform"
              >
                <Printer size={13} />
                Print
              </button>
            </div>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-left text-xs border-collapse min-w-[420px]">
                <thead>
                  <tr className="border-b-2 border-gray-900 text-[10px] font-black uppercase tracking-wider text-gray-500">
                    <th className="py-2 pr-2 text-right w-12">Qty</th>
                    <th className="py-2 px-2">SKU</th>
                    <th className="py-2 px-2">Description</th>
                    <th className="py-2 px-2">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-gray-400 font-medium">
                        No items listed
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item, idx) => (
                      <tr key={`${item.sku}-${idx}`}>
                        <td className="py-2 pr-2 text-right font-mono font-bold">
                          {item.pickingQty ?? 0}
                        </td>
                        <td className="py-2 px-2 font-mono font-black">
                          {item.sku || item.raw_sku || '—'}
                        </td>
                        <td className="py-2 px-2 text-gray-700">
                          {item.description || item.item_name || '—'}
                        </td>
                        <td className="py-2 px-2 font-mono text-gray-500">
                          {item.location || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Photos */}
          {merged.palletPhotos.length > 0 && (
            <div className="px-5 pb-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                Pallet Photos
              </p>
              <PalletPhotosBlock photos={merged.palletPhotos} orderNumber={merged.orderNumber} />
            </div>
          )}
        </div>

        <div className="text-center mt-6 pb-8">
          <p className="text-xs text-gray-300 font-bold uppercase tracking-widest">
            PickD · #{merged.orderNumber}
          </p>
        </div>
      </div>

      <ActiveFilterPill
        activeOrderFilter={activeOrderFilter}
        combinedNumbers={combinedNumbers}
        onClear={clearOrderFilter}
      />
    </div>
  );
};
