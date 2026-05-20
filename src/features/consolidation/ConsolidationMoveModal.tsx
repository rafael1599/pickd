import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import X from 'lucide-react/dist/esm/icons/x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Type from 'lucide-react/dist/esm/icons/type';
import Hash from 'lucide-react/dist/esm/icons/hash';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useInventoryMutations } from '../inventory/hooks/useInventoryMutations';
import type { InventoryItemWithMetadata } from '../../schemas/inventory.schema';

interface Candidate {
  inventory_id: number;
  sku: string;
  item_name: string | null;
  warehouse: string;
  source_row: string;
  sublocation: string[] | null;
  qty: number;
}

interface TargetRow {
  location: string;
  max_capacity: number | null;
  used: number;
  free: number;
}

interface Props {
  candidate: Candidate;
  /** Allowed destination rows. Caller decides slow vs active. */
  targetRows: string[];
  /** Short label shown in the modal header ('consolidation zone' / 'active zone'). */
  modeLabel: string;
  /** Optional pre-selection (smart suggestion from clear-row mode). */
  suggestedRow?: string | null;
  onClose: () => void;
  onMoved: (inventoryId: number) => void | Promise<void>;
}

export const ConsolidationMoveModal: React.FC<Props> = ({
  candidate,
  targetRows,
  modeLabel,
  suggestedRow,
  onClose,
  onMoved,
}) => {
  const { moveItem } = useInventoryMutations();
  // Pre-select the smart-suggested row if it's in the allowed list.
  const initialTarget = suggestedRow && targetRows.includes(suggestedRow) ? suggestedRow : '';
  const [targetRow, setTargetRow] = useState<string>(initialTarget);
  const [sublocation, setSublocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const sublocInputRef = useRef<HTMLInputElement>(null);
  // Keyboard mode (numeric vs alpha) for the sublocation input, persisted
  // per-screen like SearchInput does. Default 'text' — sublocations are
  // almost always letters.
  const [kbMode, setKbMode] = useState<'text' | 'numeric'>(() => {
    if (typeof window === 'undefined') return 'text';
    const saved = window.localStorage.getItem('kb_pref_consolidation_subloc');
    return (saved as 'text' | 'numeric') || 'text';
  });
  const toggleKb = () => {
    const next = kbMode === 'text' ? 'numeric' : 'text';
    setKbMode(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('kb_pref_consolidation_subloc', next);
    }
    sublocInputRef.current?.focus();
  };

  // Fetch target row occupancy so we can show free capacity in the picker.
  const targetRowsKey = targetRows.join(',');
  const { data: targets = [] } = useQuery({
    queryKey: ['consolidation-targets', candidate.warehouse, targetRowsKey],
    queryFn: async (): Promise<TargetRow[]> => {
      const { data: locs, error: lErr } = await supabase
        .from('locations')
        .select('id, location, max_capacity')
        .eq('warehouse', candidate.warehouse)
        .in('location', targetRows)
        .eq('is_active', true);
      if (lErr) throw lErr;

      const { data: inv, error: iErr } = await supabase
        .from('inventory')
        .select('location, quantity, is_active')
        .eq('warehouse', candidate.warehouse)
        .in('location', targetRows)
        .eq('is_active', true)
        .gt('quantity', 0);
      if (iErr) throw iErr;

      const usedByLoc = new Map<string, number>();
      for (const r of inv || []) {
        usedByLoc.set(r.location || '', (usedByLoc.get(r.location || '') || 0) + (r.quantity || 0));
      }

      return (locs || [])
        .map((l) => {
          const used = usedByLoc.get(l.location) || 0;
          return {
            location: l.location,
            max_capacity: l.max_capacity,
            used,
            free: (l.max_capacity || 0) - used,
          };
        })
        .sort((a, b) => {
          const an = Number(a.location.match(/^ROW\s+(\d+)/)?.[1] || 9999);
          const bn = Number(b.location.match(/^ROW\s+(\d+)/)?.[1] || 9999);
          return an - bn;
        });
    },
  });

  const fitWarning = useMemo(() => {
    const t = targets.find((r) => r.location === targetRow);
    if (!t) return null;
    if (t.free < candidate.qty)
      return `Only ${t.free}u free in ${targetRow} — moving ${candidate.qty}u will overflow capacity.`;
    return null;
  }, [targetRow, targets, candidate.qty]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const submit = async () => {
    if (!targetRow || submitting) return;
    setSubmitting(true);
    try {
      // Defensive check: confirm the inventory row is still at the source we
      // think before calling the RPC. The consolidation list can go stale if
      // another user moved the same row, or if a fast double-click on the
      // screen targets an in-flight candidate.
      const { data: fresh, error: freshErr } = await supabase
        .from('inventory')
        .select('id, sku, warehouse, location, quantity, is_active')
        .eq('id', candidate.inventory_id)
        .maybeSingle();
      if (freshErr) throw freshErr;
      if (!fresh || !fresh.is_active || (fresh.quantity ?? 0) <= 0) {
        toast.error('Item no longer available — refreshing list.');
        onMoved(candidate.inventory_id);
        return;
      }
      if (
        fresh.sku !== candidate.sku ||
        fresh.warehouse !== candidate.warehouse ||
        (fresh.location || '').toUpperCase() !== candidate.source_row.toUpperCase()
      ) {
        toast.error(`Item moved by someone else (now at ${fresh.location}). Refreshing list.`);
        onMoved(candidate.inventory_id);
        return;
      }

      const sublocs = sublocation.trim()
        ? sublocation
            .toUpperCase()
            .split(/[+,\s]+/)
            .filter(Boolean)
        : null;

      // Build a minimal InventoryItemWithMetadata-shaped sourceItem from the
      // (verified-fresh) row. The mutation only reads
      // sku/warehouse/location/quantity from it; rest is cast for typing.
      const sourceItem = {
        id: fresh.id,
        sku: fresh.sku,
        warehouse: fresh.warehouse,
        location: fresh.location,
        quantity: fresh.quantity,
        sublocation: candidate.sublocation,
      } as unknown as InventoryItemWithMetadata;

      await moveItem.mutateAsync({
        sourceItem,
        targetWarehouse: candidate.warehouse,
        targetLocation: targetRow,
        qty: fresh.quantity ?? candidate.qty,
        targetSublocation: sublocs,
        moveNote: 'Consolidation',
      });
      toast.success(`Moved ${candidate.sku} → ${targetRow}`);
      onMoved(candidate.inventory_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Move failed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // z-[110] sits above BottomNavigation (z-[100]) — bottom-sheet modals on
    // mobile dock at items-end, so without this the panel's action buttons
    // get hidden under the floating nav bar. See ui-rules skill §1.
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-end sm:items-center justify-center">
      <div className="bg-card border border-subtle rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="px-4 py-3 border-b border-subtle flex items-center justify-between sticky top-0 bg-card">
          <div className="min-w-0">
            <div className="text-[10px] text-muted font-bold uppercase tracking-widest">
              Move to {modeLabel}
            </div>
            <div className="font-mono text-sm font-bold text-content truncate">
              {candidate.sku}{' '}
              <span className="text-muted font-sans font-normal text-xs">
                · {candidate.qty}u from {candidate.source_row}
                {candidate.sublocation?.length ? `:${candidate.sublocation.join('+')}` : ''}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 -mr-1 rounded-lg text-muted hover:text-content"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-[10px] text-muted font-bold uppercase tracking-widest mb-2 block">
              Target row{' '}
              {suggestedRow && <span className="text-accent">· suggested {suggestedRow}</span>}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {targets.map((t) => {
                const fits = t.free >= candidate.qty;
                const selected = targetRow === t.location;
                const isSuggested = suggestedRow === t.location;
                return (
                  <button
                    key={t.location}
                    onClick={() => setTargetRow(t.location)}
                    className={`relative p-3 rounded-2xl border text-left transition-colors active:scale-[0.97] ${
                      selected
                        ? 'bg-accent text-white border-accent shadow-md shadow-accent/20'
                        : isSuggested
                          ? 'bg-accent/5 border-accent/60 text-content ring-1 ring-accent/40'
                          : fits
                            ? 'bg-surface border-subtle text-content hover:border-accent/50'
                            : 'bg-surface border-subtle text-muted opacity-60'
                    }`}
                  >
                    {isSuggested && !selected && (
                      <span className="absolute top-1 right-1 text-[8px] px-1 py-0.5 rounded bg-accent/20 text-accent font-black uppercase tracking-tighter">
                        ★
                      </span>
                    )}
                    <div className="text-base md:text-lg font-black tracking-tight leading-none">
                      {t.location}
                    </div>
                    <div className="text-[10px] uppercase font-bold opacity-80 mt-1 tracking-wider">
                      {t.free}u free
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted font-bold uppercase tracking-widest mb-2 block">
              Sublocation (optional)
            </label>
            <div className="flex items-center bg-surface border border-subtle rounded-xl pr-2 focus-within:ring-1 focus-within:ring-accent">
              <input
                ref={sublocInputRef}
                type="text"
                value={sublocation}
                onChange={(e) => setSublocation(e.target.value)}
                placeholder="e.g. A, B+C"
                inputMode={kbMode}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck="false"
                className="flex-1 bg-transparent border-none outline-none px-3 py-2 text-sm text-content placeholder:text-muted/50 font-bold uppercase"
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleKb}
                className={`p-1.5 rounded-lg active:scale-90 transition-all ${
                  kbMode === 'numeric' ? 'text-accent' : 'text-muted'
                }`}
                title={
                  kbMode === 'numeric' ? 'Switch to alpha keyboard' : 'Switch to numeric keyboard'
                }
                aria-label="Toggle keyboard mode"
              >
                {kbMode === 'numeric' ? <Hash size={16} /> : <Type size={16} />}
              </button>
            </div>
          </div>

          {fitWarning && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-[11px] text-amber-500 font-medium">
              {fitWarning}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-xl border border-subtle text-content text-xs font-bold uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!targetRow || submitting}
              className="flex-1 px-4 py-3 rounded-xl bg-accent text-white text-xs font-bold uppercase tracking-wider disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Confirm move
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
