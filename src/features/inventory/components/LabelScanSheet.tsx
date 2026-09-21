/**
 * Register a box the catalogue has never seen by photographing its label.
 *
 * The operator walks the warehouse, shoots the carton, and this reads what the
 * label states: SKU, model, size, colour, serial, the codes and the gross
 * weight. What it could prove comes back green; what the label offered two
 * readings of comes back amber with both choices; what the label never said
 * comes back red and travels to the add form still empty, for the operator to
 * finish.
 *
 * It never fills a red field with a plausible value. Every layout differs —
 * some cartons anchor the model with `MODEL:`, some print it in a banner, some
 * carry a serial barcode and some carry none — so the honest answer to "what
 * size is this" is often "the label does not say", and that is what it says.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Camera, Loader2, X, Check, AlertTriangle, HelpCircle } from 'lucide-react';
import { recognizeLabelClient } from '../../../lib/recognition/recognizeLabelClient';
import {
  buildSkuLabelDraft,
  skuDraftToPrefill,
  type SkuLabelDraft,
  type DraftField,
} from '../utils/labelToSkuDraft';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';

interface LabelScanSheetProps {
  warehouse?: 'LUDLOW' | 'ATS';
  /** The photo travels with the draft: the carton is shot once, not twice. */
  onAccept: (prefill: InventoryItemWithMetadata, photo: File) => void;
  onClose: () => void;
}

/** Form order, and the label each row carries. */
const ROWS: { key: keyof SkuLabelDraft; label: string }[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'isBike', label: 'Tipo' },
  { key: 'model', label: 'Modelo' },
  { key: 'size', label: 'Talla' },
  { key: 'color', label: 'Color' },
  { key: 'serial', label: 'Serial' },
  { key: 'upc', label: 'UPC' },
  { key: 'gtin', label: 'GTIN' },
  { key: 'weightLbs', label: 'Peso (lbs)' },
];

function renderValue(key: keyof SkuLabelDraft, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'isBike') return value === true ? 'Bike' : 'Part';
  if (key === 'weightLbs') return `${value as number} lbs`;
  return String(value);
}

export const LabelScanSheet: React.FC<LabelScanSheetProps> = ({
  warehouse = 'LUDLOW',
  onAccept,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkuLabelDraft | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  // Off by default: the catalogue keeps one serial per SKU, so storing this
  // box's serial is only right when the SKU is a single serialised unit.
  const [storeSerial, setStoreSerial] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const handleFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same input is reused for a retake, so it has to forget the last file.
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const result = await recognizeLabelClient(file, file.name);
      setDraft(buildSkuLabelDraft(result));
      setPhoto(file);
      setElapsedMs(Math.round(result.timingMs.total));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer la etiqueta.');
    } finally {
      setBusy(false);
    }
  }, []);

  /** Resolving an amber row settles it — the rest of the label is untouched. */
  const chooseOption = useCallback((key: keyof SkuLabelDraft, option: unknown) => {
    setDraft((current) => {
      if (!current) return current;
      const field = current[key] as DraftField<unknown>;
      const settled: DraftField<unknown> = { value: option, status: 'found', source: field.source };
      const next = { ...current, [key]: settled } as SkuLabelDraft;
      return {
        ...next,
        uncertainFields: next.uncertainFields.filter((k) => k !== key),
      };
    });
  }, []);

  const pendingCount = draft ? draft.missingFields.length + draft.uncertainFields.length : 0;

  return (
    // Above the bottom navigation's z-[150] — the same layer the add form
    // itself sits on, or the nav bar takes the taps meant for this sheet.
    <div className="fixed inset-0 z-[180] flex flex-col bg-black/70 backdrop-blur-sm">
      <div className="mt-auto flex max-h-[92vh] flex-col rounded-t-2xl border-t border-subtle bg-surface">
        <div className="flex shrink-0 items-start justify-between border-b border-subtle px-4 py-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-content">
              Registrar caja con foto
            </h2>
            <p className="mt-0.5 text-[11px] text-muted">
              {draft
                ? 'Verde: leído. Ámbar: elegí. Rojo: lo completás en el formulario.'
                : 'Fotografiá la etiqueta de fábrica de la caja.'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 -mt-1 shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-card"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          {!draft && !busy && (
            <button
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-subtle bg-card px-4 py-10 text-muted transition-colors active:scale-[0.99]"
            >
              <Camera size={28} className="text-accent" />
              <span className="text-xs font-bold uppercase tracking-wider text-content">
                Tomar foto de la etiqueta
              </span>
            </button>
          )}

          {busy && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              <span className="text-xs text-muted">Leyendo la etiqueta…</span>
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs font-bold text-red-400">
              {error}
            </p>
          )}

          {draft && !busy && (
            <div className="space-y-1.5">
              {ROWS.map(({ key, label }) => {
                const field = draft[key] as DraftField<unknown>;
                const tone =
                  field.status === 'found'
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : field.status === 'uncertain'
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : 'border-red-500/30 bg-red-500/5';

                return (
                  <div key={key} className={`rounded-xl border px-3 py-2 ${tone}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        {label}
                      </span>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-bold text-content">
                          {renderValue(key, field.value)}
                        </span>
                        {field.status === 'found' && (
                          <Check size={14} className="shrink-0 text-emerald-400" />
                        )}
                        {field.status === 'uncertain' && (
                          <HelpCircle size={14} className="shrink-0 text-amber-400" />
                        )}
                        {field.status === 'missing' && (
                          <AlertTriangle size={14} className="shrink-0 text-red-400" />
                        )}
                      </div>
                    </div>

                    {field.status === 'uncertain' && field.options && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {field.options.map((option, i) => (
                          <button
                            key={i}
                            onClick={() => chooseOption(key, option)}
                            className="rounded-full border border-amber-500/40 bg-card px-3 py-1 text-xs font-bold text-content active:scale-95"
                          >
                            {renderValue(key, option)}
                          </button>
                        ))}
                      </div>
                    )}

                    {field.status === 'missing' && (
                      <p className="mt-1 text-[11px] text-red-400/80">
                        La etiqueta no lo dice — lo completás en el formulario.
                      </p>
                    )}

                    {/* The serial belongs to this box, not to the SKU: the
                        catalogue keeps one per SKU, so saving it would make
                        the next box of the same model overwrite it. */}
                    {key === 'serial' && field.status === 'found' && (
                      <label className="mt-2 flex items-start gap-2 text-[11px] text-muted">
                        <input
                          type="checkbox"
                          checked={storeSerial}
                          onChange={(e) => setStoreSerial(e.target.checked)}
                          className="mt-0.5 shrink-0 accent-emerald-500"
                        />
                        <span>
                          Guardar el serial en el SKU.{' '}
                          {storeSerial
                            ? 'Solo para unidades únicas (S/D): la próxima caja del mismo SKU lo reemplazaría.'
                            : 'Apagado: es de esta caja, no del modelo.'}
                        </span>
                      </label>
                    )}
                  </div>
                );
              })}

              {elapsedMs !== null && (
                <p className="pt-1 text-center text-[10px] text-muted">
                  Leído en {elapsedMs} ms · {pendingCount} campo(s) por resolver
                </p>
              )}
            </div>
          )}
        </div>

        {draft && photo && !busy && (
          <div className="flex shrink-0 gap-2 border-t border-subtle px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              onClick={() => inputRef.current?.click()}
              className="h-11 rounded-full border border-subtle bg-card px-4 text-xs font-bold uppercase tracking-wider text-content active:scale-95"
            >
              Otra foto
            </button>
            <button
              onClick={() =>
                onAccept(skuDraftToPrefill(draft, warehouse, { includeSerial: storeSerial }), photo)
              }
              className="h-11 flex-1 rounded-full bg-accent px-4 text-xs font-bold uppercase tracking-wider text-black active:scale-95"
            >
              Continuar al formulario
            </button>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
};
