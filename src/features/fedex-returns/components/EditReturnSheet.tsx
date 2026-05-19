import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useUpdateFedExReturn } from '../hooks/useFedExReturns';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import type { FedExReturn } from '../types';

interface EditReturnSheetProps {
  ret: FedExReturn;
  onClose: () => void;
}

/**
 * Compact bottom-sheet style editor for the fields a picker actually wants
 * to change post-intake: RMA, Misship flag, and free-form Notes. Tracking
 * number and label photo stay immutable here — those changes belong to the
 * dedicated detail screen.
 *
 * Mounted only when opened (parent unmounts on close), so the initial state
 * snapshot is enough — no useEffect re-sync needed for prop changes.
 */
export const EditReturnSheet: React.FC<EditReturnSheetProps> = ({ ret, onClose }) => {
  const update = useUpdateFedExReturn();
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const [rma, setRma] = useState(ret.rma ?? '');
  const [isMisship, setIsMisship] = useState(ret.is_misship);
  const [notes, setNotes] = useState(ret.notes ?? '');
  const [placeholderLocation, setPlaceholderLocation] = useState<string>('');
  const [originalPlaceholderLocation, setOriginalPlaceholderLocation] = useState<string>('');
  const [placeholderQty, setPlaceholderQty] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  // FDX-prefixed locations available in LUDLOW for the dropdown. Filtered to
  // active rows in the `locations` table so deactivated bins don't surface.
  const { data: fdxLocations = [] } = useQuery<string[]>({
    queryKey: ['locations', 'fdx-bins'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('location')
        .eq('warehouse', 'LUDLOW')
        .eq('is_active', true)
        .ilike('location', 'FDX%')
        .order('location', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as { location: string }[])
        .map((r) => (r.location || '').toUpperCase())
        .filter(Boolean);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch the placeholder row for this return's tracking number — sku is the
  // tracking number until the picker renames it via Return-to-Stock. We pick
  // the only active FDX-prefixed row; if none exists (return fully resolved),
  // the dropdown is rendered disabled.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select('location, quantity')
        .eq('sku', ret.tracking_number)
        .eq('warehouse', 'LUDLOW')
        .ilike('location', 'FDX%')
        .gt('quantity', 0)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setPlaceholderLocation('');
        setOriginalPlaceholderLocation('');
        setPlaceholderQty(0);
        return;
      }
      const loc = (data.location || '').toUpperCase();
      setPlaceholderLocation(loc);
      setOriginalPlaceholderLocation(loc);
      setPlaceholderQty(Number(data.quantity) || 0);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [ret.tracking_number]);

  // Include the current location even if it's not in `locations` (e.g. legacy
  // bare 'FDX' rows) so the user always sees where the return lives today.
  const dropdownOptions = (() => {
    const set = new Set(fdxLocations);
    if (originalPlaceholderLocation) set.add(originalPlaceholderLocation);
    return Array.from(set).sort();
  })();

  const locationChanged =
    !!originalPlaceholderLocation && placeholderLocation !== originalPlaceholderLocation;

  const dirty =
    rma.trim() !== (ret.rma ?? '') ||
    isMisship !== ret.is_misship ||
    notes.trim() !== (ret.notes ?? '') ||
    locationChanged;

  const submit = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      // 1. Move the placeholder row to the new FDX bin (if changed). Done
      //    first so a move failure doesn't leave the metadata out of sync.
      if (locationChanged && placeholderQty > 0) {
        const { error: moveErr } = await supabase.rpc('move_inventory_stock', {
          p_sku: ret.tracking_number,
          p_from_warehouse: 'LUDLOW',
          p_from_location: originalPlaceholderLocation,
          p_to_warehouse: 'LUDLOW',
          p_to_location: placeholderLocation,
          p_qty: placeholderQty,
          p_performed_by: profile?.full_name ?? 'FedEx Returns',
          p_user_id: user?.id ?? undefined,
        });
        if (moveErr) throw moveErr;
      }

      // 2. Update the metadata fields (RMA, misship, notes).
      const metadataDirty =
        rma.trim() !== (ret.rma ?? '') ||
        isMisship !== ret.is_misship ||
        notes.trim() !== (ret.notes ?? '');
      if (metadataDirty) {
        await update.mutateAsync({
          id: ret.id,
          rma: rma.trim() ? rma.trim() : null,
          is_misship: isMisship,
          notes: notes.trim() ? notes.trim() : null,
        });
      }

      // Inventory cache refresh so the new FDX bin shows the row.
      if (locationChanged) {
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
      }
      toast.success('Return updated');
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    // z-[110] keeps the modal above the bottom navigation (z-[100]).
    // Padding-bottom on the wrapper guarantees the action row clears the
    // floating nav on small screens; centering the dialog vertically also
    // ensures it doesn't anchor to the bottom edge where the nav lives.
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-main/60 backdrop-blur-md p-4 pb-28"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-black text-content uppercase tracking-widest">
              Edit Return
            </h3>
            <p className="text-[10px] text-muted/70 mt-1 font-mono">{ret.tracking_number}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-content transition-colors"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={rma}
              onChange={(e) => setRma(e.target.value.toUpperCase())}
              placeholder="RMA"
              className="flex-1 bg-surface border border-subtle rounded-xl px-3 py-2 text-sm font-mono text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent uppercase tracking-wider"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setIsMisship((v) => !v)}
              className={`px-3 rounded-xl text-xs font-bold tracking-wider uppercase border transition-colors shrink-0 ${
                isMisship
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-surface text-muted border-subtle hover:border-accent/40'
              }`}
            >
              Misship
            </button>
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={3}
            className="w-full bg-surface border border-subtle rounded-xl px-3 py-2 text-sm text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          />

          {/* FDX-bin reassignment — only meaningful while the placeholder row
              still exists. Hidden once the return is fully resolved. */}
          {originalPlaceholderLocation && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted/70 pl-1">
                FDX Location
              </label>
              <select
                value={placeholderLocation}
                onChange={(e) => setPlaceholderLocation(e.target.value)}
                className="w-full bg-surface border border-subtle rounded-xl px-3 py-2 text-sm font-mono text-content focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {dropdownOptions.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-surface border border-subtle text-muted rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-surface/80 active:scale-[0.97] transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!dirty || saving}
              className="flex-[2] py-2.5 bg-accent text-white rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-40 active:scale-[0.97] transition-all flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
