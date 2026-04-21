import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import X from 'lucide-react/dist/esm/icons/x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { scratchAndDentApi } from '../api/scratchAndDentApi';
import { useScratchAndDentFilterOptions, SD_CATALOG_KEY } from '../hooks/useScratchAndDentCatalog';
import type { BikeCondition } from '../../../schemas/products.schema';
import { SD_BINS_KEY } from '../../inventory/hooks/useInventoryRealtime';

interface Props {
  open: boolean;
  onClose: () => void;
}

const CONDITIONS: { value: BikeCondition; label: string; color: string }[] = [
  {
    value: 'new_unbuilt',
    label: 'New (box)',
    color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  },
  {
    value: 'new_built',
    label: 'New (built)',
    color: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  {
    value: 'ridden_demo',
    label: 'Demo',
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  },
  {
    value: 'returned',
    label: 'Returned',
    color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  {
    value: 'defective_frame',
    label: 'Defective',
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
  },
];

export function SDQuickIntakeModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { data: options } = useScratchAndDentFilterOptions();

  const [sku, setSku] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [model, setModel] = useState('');
  const [condition, setCondition] = useState<BikeCondition | ''>('returned');
  const [note, setNote] = useState('');

  // Reset form and auto-suggest next SKU when modal opens.
  // setState-in-effect is intentional: deriving local form state from the
  // modal open/close transition (same pattern as ScratchAndDentEditorSheet).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setSku('');
      setSerialNumber('');
      setModel('');
      setCondition('returned');
      setNote('');
      scratchAndDentApi.fetchNextSku().then(setSku);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useScrollLock(open, onClose);

  const productNames = options?.products.map((p) => p.product_name) ?? [];
  const showNote =
    condition === 'defective_frame' || condition === 'returned' || condition === 'ridden_demo';

  const register = useMutation({
    mutationFn: async () => {
      if (!sku.trim()) throw new Error('SKU is required');
      if (!serialNumber.trim()) throw new Error('Serial number is required');
      if (!model.trim()) throw new Error('Model is required');
      if (!condition) throw new Error('Condition is required');

      await scratchAndDentApi.createUnit({
        sku: sku.trim(),
        model: model.trim(),
        category: 'sd',
        serial_number: serialNumber.trim(),
        condition: condition || null,
        condition_description: note.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(`Registered ${sku} → ROW 33`);
      queryClient.invalidateQueries({ queryKey: SD_CATALOG_KEY });
      queryClient.invalidateQueries({ queryKey: SD_BINS_KEY });
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Registration failed');
    },
  });

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-main/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-surface border border-subtle rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-subtle shrink-0">
          <h3 className="text-sm font-black uppercase tracking-tight text-content">
            Register S/D Bike
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted hover:text-content active:scale-95 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div className="overflow-y-auto p-5 space-y-5 flex-1">
          {/* SKU — auto-suggested, editable */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-muted">
              S/D SKU
            </label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value.trim())}
              placeholder="01-0490"
              className="mt-1 w-full px-3 py-2.5 rounded-xl bg-main border border-subtle text-content font-mono text-lg font-bold focus:outline-none focus:border-accent/50"
            />
            <p className="text-[10px] text-muted/60 mt-1">Next available (auto-suggested)</p>
          </div>

          {/* Serial Number */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-muted">
              Serial Number
            </label>
            <input
              type="text"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              placeholder="Read from bike frame"
              autoCapitalize="characters"
              className="mt-1 w-full px-3 py-2.5 rounded-xl bg-main border border-subtle text-content font-mono text-base focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Model — autocomplete */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-muted">
              Model
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="sd-quick-models"
              placeholder="Hardline C1"
              className="mt-1 w-full px-3 py-2.5 rounded-xl bg-main border border-subtle text-content text-base focus:outline-none focus:border-accent/50"
            />
            <datalist id="sd-quick-models">
              {productNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          {/* Condition — pill selector */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-muted">
              Condition
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {CONDITIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCondition(c.value)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 ${
                    condition === c.value ? c.color : 'bg-main text-muted/60 border-subtle'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Note — only shows for non-pristine conditions */}
          {showNote && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-200">
              <label className="text-[9px] font-bold uppercase tracking-widest text-muted">
                What's wrong? (optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="scratched fork, missing reflectors..."
                className="mt-1 w-full px-3 py-2.5 rounded-xl bg-main border border-subtle text-content text-sm focus:outline-none focus:border-accent/50"
              />
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="px-5 py-4 border-t border-subtle shrink-0">
          <button
            onClick={() => register.mutate()}
            disabled={register.isPending || !sku || !serialNumber || !model || !condition}
            className="w-full py-3.5 rounded-xl text-sm font-black uppercase tracking-widest bg-accent text-main active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {register.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Registering...
              </>
            ) : (
              `Register → ROW 33`
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
