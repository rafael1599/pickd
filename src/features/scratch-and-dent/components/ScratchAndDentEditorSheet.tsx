import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import Check from 'lucide-react/dist/esm/icons/check';
import X from 'lucide-react/dist/esm/icons/x';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { scratchAndDentApi } from '../api/scratchAndDentApi';
import {
  useScratchAndDentBySku,
  useScratchAndDentFilterOptions,
  SD_CATALOG_KEY,
} from '../hooks/useScratchAndDentCatalog';
import {
  BikeConditionEnum,
  BikeUnitCategoryEnum,
  type BikeCondition,
  type BikeUnitCategory,
} from '../../../schemas/products.schema';
import { SD_BINS_KEY } from '../../inventory/hooks/useInventoryRealtime';

interface Props {
  mode: 'create' | 'edit';
  sku: string | null;
  onClose: () => void;
}

interface FormState {
  sku: string;
  productName: string;
  category: BikeUnitCategory;
  size: string;
  color: string;
  msrp: string;
  standardPrice: string;
  sdPrice: string;
  serialNumber: string;
  condition: BikeCondition | '';
  conditionDescription: string;
  pdfLink: string;
  productCategory: string; // mountain, gravel, cruiser, etc.
}

const EMPTY: FormState = {
  sku: '',
  productName: '',
  category: 'sd',
  size: '',
  color: '',
  msrp: '',
  standardPrice: '',
  sdPrice: '',
  serialNumber: '',
  condition: '',
  conditionDescription: '',
  pdfLink: '',
  productCategory: '',
};

const PRODUCT_CATEGORY_OPTIONS = [
  '',
  'mountain',
  'gravel',
  'road',
  'cruiser',
  'urban',
  'kids',
  'hybrid',
  'other',
];

/**
 * Bottom sheet for creating/editing a S/D unit.
 * Resolves products + variants by name (upsert) so the user can type
 * "Hardline C1 / 17" / Gloss Black" without picking from a list.
 */
export function ScratchAndDentEditorSheet({ mode, sku, onClose }: Props) {
  const queryClient = useQueryClient();
  const { data: existing } = useScratchAndDentBySku(mode === 'edit' ? sku : null);
  const { data: options } = useScratchAndDentFilterOptions();

  const [form, setForm] = useState<FormState>(EMPTY);

  // Hydrate the form once when `existing` loads (async via useScratchAndDentBySku)
  // or when `sku` is provided in create mode. The setState-in-effect rule
  // (https://react.dev/reference/rules/components-and-hooks-must-be-pure)
  // documents this exact case as a permitted exception: deriving local form
  // state from data that arrives after mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode === 'edit' && existing) {
      setForm({
        sku: existing.sku,
        productName: existing.bike_variants?.products?.product_name ?? '',
        category: existing.category,
        size: existing.bike_variants?.size ?? '',
        color: existing.bike_variants?.color ?? '',
        msrp: existing.bike_variants?.msrp != null ? String(existing.bike_variants.msrp) : '',
        standardPrice:
          existing.bike_variants?.standard_price != null
            ? String(existing.bike_variants.standard_price)
            : '',
        sdPrice: existing.sd_price != null ? String(existing.sd_price) : '',
        serialNumber: existing.serial_number ?? '',
        condition: (existing.condition as BikeCondition | null) ?? '',
        conditionDescription: existing.condition_description ?? '',
        pdfLink: existing.pdf_link ?? '',
        productCategory: existing.bike_variants?.products?.category ?? '',
      });
    } else if (mode === 'create' && sku) {
      setForm((f) => ({ ...f, sku }));
    } else if (mode === 'create' && !sku) {
      // Auto-suggest the next sequential S/D SKU
      scratchAndDentApi.fetchNextSku().then((next) => {
        setForm((f) => (f.sku ? f : { ...f, sku: next }));
      });
    }
  }, [mode, existing, sku]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useScrollLock(true, onClose);

  const productOptions = useMemo(() => options?.products ?? [], [options]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.sku.trim()) throw new Error('SKU is required');
      if (!form.productName.trim()) throw new Error('Model is required');

      const payload = {
        sku: form.sku,
        model: form.productName.trim(),
        size: form.size || null,
        color: form.color || null,
        category: form.category,
        productCategory: form.productCategory || null,
        serial_number: form.serialNumber || null,
        condition: form.condition || null,
        condition_description: form.conditionDescription || null,
        msrp: form.msrp ? Number(form.msrp) : null,
        standard_price: form.standardPrice ? Number(form.standardPrice) : null,
        sd_price: form.sdPrice ? Number(form.sdPrice) : null,
        pdf_link: form.pdfLink || null,
      };

      if (mode === 'edit' && existing) {
        await scratchAndDentApi.updateUnit(existing.sku, payload);
      } else {
        await scratchAndDentApi.createUnit(payload);
      }
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? 'S/D updated' : 'S/D registered');
      queryClient.invalidateQueries({ queryKey: SD_CATALOG_KEY });
      queryClient.invalidateQueries({ queryKey: SD_BINS_KEY });
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Save failed');
    },
  });

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-main/60" onClick={onClose} />

      <div className="relative bg-surface border-t border-subtle rounded-t-3xl max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom duration-300 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-subtle shrink-0">
          <div>
            <h3 className="text-sm font-black uppercase tracking-tight text-content">
              {mode === 'edit' ? 'Edit S/D unit' : 'Register S/D unit'}
            </h3>
            {form.sku && <p className="text-[10px] font-mono text-muted mt-0.5">{form.sku}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted hover:text-content active:scale-95 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-3 flex-1">
          <FieldRow label="SKU">
            <input
              type="text"
              value={form.sku}
              onChange={(e) => update('sku', e.target.value.trim())}
              disabled={mode === 'edit'}
              placeholder="01-0407"
              className="input font-mono"
            />
          </FieldRow>

          <FieldRow label="Category">
            <div className="flex gap-1.5">
              {BikeUnitCategoryEnum.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => update('category', opt)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase ${
                    form.category === opt
                      ? 'bg-accent text-white'
                      : 'bg-surface text-muted border border-subtle'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </FieldRow>

          <FieldRow label="Model">
            <input
              type="text"
              value={form.productName}
              onChange={(e) => update('productName', e.target.value)}
              list="sd-product-names"
              placeholder="Hardline C1"
              className="input"
            />
            <datalist id="sd-product-names">
              {productOptions.map((p) => (
                <option key={p.id} value={p.product_name} />
              ))}
            </datalist>
          </FieldRow>

          <FieldRow label="Product category">
            <select
              value={form.productCategory}
              onChange={(e) => update('productCategory', e.target.value)}
              className="input"
            >
              {PRODUCT_CATEGORY_OPTIONS.map((c) => (
                <option key={c || 'none'} value={c}>
                  {c || '—'}
                </option>
              ))}
            </select>
          </FieldRow>

          <div className="grid grid-cols-2 gap-2">
            <FieldRow label="Size">
              <input
                type="text"
                value={form.size}
                onChange={(e) => update('size', e.target.value)}
                placeholder='17"'
                className="input"
              />
            </FieldRow>
            <FieldRow label="Color">
              <input
                type="text"
                value={form.color}
                onChange={(e) => update('color', e.target.value)}
                placeholder="Gloss Black"
                className="input"
              />
            </FieldRow>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <FieldRow label="S/D price">
              <input
                type="number"
                value={form.sdPrice}
                onChange={(e) => update('sdPrice', e.target.value)}
                step="0.01"
                className="input"
              />
            </FieldRow>
            <FieldRow label="Standard">
              <input
                type="number"
                value={form.standardPrice}
                onChange={(e) => update('standardPrice', e.target.value)}
                step="0.01"
                className="input"
              />
            </FieldRow>
            <FieldRow label="MSRP">
              <input
                type="number"
                value={form.msrp}
                onChange={(e) => update('msrp', e.target.value)}
                step="0.01"
                className="input"
              />
            </FieldRow>
          </div>

          <FieldRow label="Serial number">
            <input
              type="text"
              value={form.serialNumber}
              onChange={(e) => update('serialNumber', e.target.value)}
              className="input font-mono"
            />
          </FieldRow>

          <FieldRow label="Condition">
            <select
              value={form.condition}
              onChange={(e) => update('condition', e.target.value as BikeCondition | '')}
              className="input"
            >
              <option value="">—</option>
              {BikeConditionEnum.options.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </FieldRow>

          <FieldRow label="Notes">
            <textarea
              value={form.conditionDescription}
              onChange={(e) => update('conditionDescription', e.target.value)}
              rows={3}
              className="input resize-none"
            />
          </FieldRow>

          <FieldRow label="PDF link">
            <input
              type="text"
              value={form.pdfLink}
              onChange={(e) => update('pdfLink', e.target.value)}
              placeholder="https://www.dropbox.com/..."
              className="input"
            />
          </FieldRow>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-subtle shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[11px] font-bold text-muted hover:text-content"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold bg-accent text-white active:scale-95 disabled:opacity-50 transition-all"
          >
            <Check size={14} strokeWidth={3} />
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      <style>{`
        .input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          background-color: var(--bg-main, rgba(0,0,0,0.2));
          border: 1px solid rgba(255,255,255,0.08);
          font-size: 12px;
          color: var(--color-content, #fff);
          outline: none;
        }
        .input:focus { border-color: var(--accent, #f59e0b); }
        .input:disabled { opacity: 0.5; }
      `}</style>
    </label>
  );
}
