import React, { useState } from 'react';
import { BIKE_SKU_DEFAULTS } from '../../../../../utils/skuDefaults';

/**
 * The bikes of the order the catalog does not know — an unregistered
 * scratch-and-dent — with their box: length × width × height and weight
 * (Rafael, 24 sep 2026, orders 881701–881714). Only those: a registered SKU
 * already brings its box from sku_metadata and is edited in its own detail.
 *
 * Every row starts filled with the bike defaults (55 × 8.5 × 30.5, 45 lb) — the
 * same numbers the pallet estimate already assumes — so nobody types unless the
 * tape says otherwise. The edit lives on this screen only: UPDATE-ing a row that
 * does not exist is a no-op, and minting one here would "register" the SKU for
 * every open order (sku_not_found is derived from that table).
 */
export interface BikeBox {
  sku: string;
  qty: number;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  weight_lbs: number | null;
}

export type BikeBoxField = 'length_in' | 'width_in' | 'height_in' | 'weight_lbs';

interface BikeBoxesEditorProps {
  boxes: BikeBox[];
  onChange: (sku: string, field: BikeBoxField, value: number) => void;
}

const FIELDS: { field: BikeBoxField; label: string }[] = [
  { field: 'length_in', label: 'L' },
  { field: 'width_in', label: 'W' },
  { field: 'height_in', label: 'H' },
  { field: 'weight_lbs', label: 'lb' },
];

const shown = (box: BikeBox, field: BikeBoxField): number => {
  const v = box[field];
  return typeof v === 'number' && v > 0 ? v : BIKE_SKU_DEFAULTS[field];
};

const NumberCell: React.FC<{
  box: BikeBox;
  field: BikeBoxField;
  label: string;
  onCommit: (value: number) => void;
}> = ({ box, field, label, onCommit }) => {
  const value = shown(box, field);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    setDraft(null);
    if (!Number.isFinite(n) || n <= 0 || n === value) return;
    onCommit(n);
  };
  return (
    <label className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] text-muted font-bold">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        step="0.5"
        min="0"
        className="w-14 text-right bg-main border border-subtle rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-content focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  );
};

export const BikeBoxesEditor: React.FC<BikeBoxesEditorProps> = ({ boxes, onChange }) => {
  if (boxes.length === 0) return null;

  return (
    <div className="w-full max-w-md bg-surface rounded-2xl border border-subtle overflow-hidden">
      <div className="px-4 py-3 border-b border-subtle">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">Bike Boxes</h3>
      </div>
      <div className="divide-y divide-subtle">
        {boxes.map((box) => (
          <div key={box.sku} className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono font-bold text-xs text-content truncate">{box.sku}</span>
                <span className="text-[10px] text-muted font-bold shrink-0">×{box.qty}</span>
              </div>
              <span className="text-[9px] font-bold text-amber-500">
                not in catalog · this screen only
              </span>
            </div>
            <div className="flex items-end gap-1.5 shrink-0">
              {FIELDS.map(({ field, label }) => (
                <NumberCell
                  key={field}
                  box={box}
                  field={field}
                  label={label}
                  onCommit={(v) => onChange(box.sku, field, v)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
