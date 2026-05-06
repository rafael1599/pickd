import { useState } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';

import { useUpdateFedExReturn } from '../hooks/useFedExReturns';
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
  const [rma, setRma] = useState(ret.rma ?? '');
  const [isMisship, setIsMisship] = useState(ret.is_misship);
  const [notes, setNotes] = useState(ret.notes ?? '');

  const dirty =
    rma.trim() !== (ret.rma ?? '') ||
    isMisship !== ret.is_misship ||
    notes.trim() !== (ret.notes ?? '');

  const submit = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync({
        id: ret.id,
        rma: rma.trim() ? rma.trim() : null,
        is_misship: isMisship,
        notes: notes.trim() ? notes.trim() : null,
      });
      toast.success('Return updated');
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      toast.error(message);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-main/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full sm:w-full sm:max-w-md bg-[#1a1a1a] border border-white/10 sm:rounded-2xl rounded-t-2xl p-5"
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
              disabled={!dirty || update.isPending}
              className="flex-[2] py-2.5 bg-accent text-white rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-40 active:scale-[0.97] transition-all flex items-center justify-center gap-2"
            >
              {update.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
