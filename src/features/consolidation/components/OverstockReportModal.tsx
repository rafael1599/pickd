import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import X from 'lucide-react/dist/esm/icons/x';
import Download from 'lucide-react/dist/esm/icons/download';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { ModalOverlay } from '../../../components/ui/ModalOverlay';
import { containerDistribution, formatTowersLines } from '../../../utils/containerDistribution';
import { generateOverstockPdf, type OverstockRow } from '../lib/overstockPdf';

interface OverstockReportModalProps {
  onClose: () => void;
}

const MONTH_OPTIONS = [3, 6, 12, 24, 0] as const; // 0 = all time

/**
 * Live "Overstock / Slow Movers" report for LUDLOW: bikes (or all SKUs) with
 * high stock but few completed orders in the chosen window. Aggregated per SKU
 * (stock summed across locations) with towers/lines and a PDF download.
 * Adjustable thresholds map straight to get_consolidation_candidates params.
 */
export function OverstockReportModal({ onClose }: OverstockReportModalProps) {
  const [maxOrders, setMaxOrders] = useState(12);
  const [months, setMonths] = useState(12);
  const [onlyBikes, setOnlyBikes] = useState(true);

  const since = useMemo(() => {
    if (months <= 0) return undefined;
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString();
  }, [months]);

  // NOTE: get_consolidation_candidates is NOT usable here — since migration
  // 20260528111035 it applies a slotting heuristic (only rows sitting "too
  // active" for their movement), so well-slotted overstock never shows up.
  // Instead: raw inventory + rename-aware order stats via the batch RPC.
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['overstock-report', maxOrders, months, onlyBikes],
    queryFn: async (): Promise<OverstockRow[]> => {
      // 1. All active LUDLOW inventory (paged past PostgREST's 1k row cap).
      type InvRow = {
        sku: string;
        quantity: number;
        location: string | null;
        item_name: string | null;
        sku_metadata: { is_bike: boolean | null } | null;
      };
      const inv: InvRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await supabase
          .from('inventory')
          .select('sku, quantity, location, item_name, sku_metadata(is_bike)')
          .eq('is_active', true)
          .gt('quantity', 0)
          .eq('warehouse', 'LUDLOW')
          .range(from, from + 999);
        if (error) throw error;
        inv.push(...((page ?? []) as unknown as InvRow[]));
        if (!page || page.length < 1000) break;
      }

      const scoped = onlyBikes ? inv.filter((r) => r.sku_metadata?.is_bike === true) : inv;

      // 2. Aggregate per SKU (stock summed across locations).
      const map = new Map<
        string,
        { itemName: string | null; totalQty: number; locations: Set<string>; spots: number }
      >();
      for (const r of scoped) {
        let e = map.get(r.sku);
        if (!e) {
          e = { itemName: r.item_name ?? null, totalQty: 0, locations: new Set(), spots: 0 };
          map.set(r.sku, e);
        }
        e.totalQty += r.quantity;
        if (r.location) e.locations.add(r.location);
        e.spots += 1;
      }
      const skus = [...map.keys()];
      if (!skus.length) return [];

      // 3. Rename-aware order stats, chunked to keep each RPC call fast.
      const stats = new Map<string, { orders: number; units: number; last: string | null }>();
      for (let i = 0; i < skus.length; i += 200) {
        const { data: st, error } = await supabase.rpc('get_sku_movement_stats_batch', {
          p_skus: skus.slice(i, i + 200),
          p_since: since,
        });
        if (error) throw error;
        for (const s of st ?? []) {
          stats.set(s.sku, {
            orders: Number(s.orders_completed) || 0,
            units: Number(s.units_shipped) || 0,
            last: s.last_shipped ?? null,
          });
        }
      }

      // 4. Threshold + towers/lines + sort by stock desc.
      const out: OverstockRow[] = [];
      for (const [sku, e] of map) {
        const s = stats.get(sku) ?? { orders: 0, units: 0, last: null };
        if (s.orders > maxOrders) continue;
        const { towers, lines } = containerDistribution(e.totalQty);
        out.push({
          sku,
          itemName: e.itemName,
          totalQty: e.totalQty,
          towers,
          lines,
          towersLines: formatTowersLines(e.totalQty),
          spots: e.spots,
          locations: [...e.locations].sort().join(', '),
          orders: s.orders,
          units: s.units,
          lastShipped: s.last ? s.last.slice(0, 10) : null,
        });
      }
      out.sort((a, b) => b.totalQty - a.totalQty);
      return out;
    },
  });

  const rows = useMemo<OverstockRow[]>(() => data ?? [], [data]);

  const totalUnits = rows.reduce((s, r) => s + r.totalQty, 0);
  const totalTowers = rows.reduce((s, r) => s + r.towers, 0);

  const handleDownload = () => {
    if (!rows.length) {
      toast.error('Nothing to export');
      return;
    }
    generateOverstockPdf(rows, {
      maxOrders,
      months,
      onlyBikes,
      generatedAt: new Date().toISOString().slice(0, 10),
    });
  };

  return (
    <ModalOverlay
      onClose={onClose}
      maxWidth="6xl"
      zIndex={200}
      cardBg="bg-surface"
      className="max-h-[88vh] flex flex-col"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-subtle flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-black text-content uppercase tracking-widest">
            Overstock / Slow Movers
          </h3>
          <p className="text-[11px] text-muted/70 mt-0.5">
            High stock, few orders — LUDLOW · T/L = towers (30) / lines (5)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            disabled={!rows.length}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider text-white bg-accent hover:bg-accent/90 disabled:opacity-40 transition-all active:scale-[0.97]"
          >
            <Download size={14} /> PDF
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-content transition-colors rounded-lg hover:bg-content/[0.05]"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="px-5 py-3 border-b border-subtle flex flex-wrap items-center gap-4 shrink-0">
        <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted">
          Max orders
          <input
            type="number"
            min={0}
            max={50}
            value={maxOrders}
            onChange={(e) => setMaxOrders(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
            className="w-16 bg-card border border-subtle rounded-lg px-2 py-1 text-content font-black text-center outline-none focus:border-accent"
          />
        </label>

        <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted">
          Window
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="bg-card border border-subtle rounded-lg px-2 py-1 text-content font-bold outline-none focus:border-accent"
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'All time' : `${m} months`}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1 bg-card border border-subtle rounded-lg p-0.5">
          {[
            { v: true, label: 'Bikes' },
            { v: false, label: 'All' },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => setOnlyBikes(opt.v)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-colors ${
                onlyBikes === opt.v ? 'bg-accent text-white' : 'text-muted hover:text-content'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-2 rounded-lg text-muted hover:text-content disabled:opacity-30"
          title="Refresh"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>

        <span className="ml-auto text-[11px] font-bold text-muted">
          {rows.length} SKUs · {totalUnits} units · {totalTowers} towers
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : isError ? (
          <div className="text-center py-20 text-red-400 text-sm font-bold">
            Failed to load report.
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 text-muted/60 text-sm italic">
            No SKUs match these filters.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface border-b border-subtle z-10">
              <tr className="text-[10px] uppercase tracking-widest text-muted/70 text-left">
                <th className="px-4 py-2 font-black">SKU</th>
                <th className="px-3 py-2 font-black text-right">Stock</th>
                <th className="px-3 py-2 font-black">T / L</th>
                <th className="px-3 py-2 font-black text-right">Spots</th>
                <th className="px-3 py-2 font-black">Locations</th>
                <th className="px-3 py-2 font-black text-right">Orders</th>
                <th className="px-3 py-2 font-black text-right">Units</th>
                <th className="px-3 py-2 font-black">Last shipped</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku} className="border-b border-subtle/50 hover:bg-content/[0.03]">
                  <td className="px-4 py-2 font-black text-content uppercase tracking-tight">
                    {r.sku}
                  </td>
                  <td className="px-3 py-2 text-right font-black text-content">{r.totalQty}</td>
                  <td className="px-3 py-2 font-bold text-sky-400">{r.towersLines}</td>
                  <td className="px-3 py-2 text-right text-muted">{r.spots}</td>
                  <td className="px-3 py-2 text-muted truncate max-w-[240px]" title={r.locations}>
                    {r.locations || '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-muted">{r.orders}</td>
                  <td className="px-3 py-2 text-right text-muted">{r.units}</td>
                  <td className="px-3 py-2 text-muted">{r.lastShipped ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ModalOverlay>
  );
}
