import React from 'react';
import { supabase } from '../../../../../lib/supabase';

export interface PartWithWeight {
  sku: string;
  qty: number;
  weight: number | null;
}

interface PartsWeightEditorProps {
  partsWithWeights: PartWithWeight[];
  onWeightChange: (sku: string, weight: number) => void;
}

export const PartsWeightEditor: React.FC<PartsWeightEditorProps> = ({
  partsWithWeights,
  onWeightChange,
}) => {
  if (partsWithWeights.length === 0) return null;

  return (
    <div className="w-full max-w-md bg-surface rounded-2xl border border-subtle overflow-hidden">
      <div className="px-4 py-3 border-b border-subtle">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">
          Parts Weight
        </h3>
      </div>
      <div className="divide-y divide-subtle">
        {partsWithWeights.map((part) => (
          <div key={part.sku} className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono font-bold text-xs text-content truncate">{part.sku}</span>
              <span className="text-[10px] text-muted font-bold shrink-0">×{part.qty}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                value={part.weight || ''}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (isNaN(val) || val < 0) return;
                  onWeightChange(part.sku, val);
                  // UPDATE, never upsert — an unregistered part must not be
                  // minted into the catalog by typing a weight (see ShipScreen).
                  void supabase
                    .from('sku_metadata')
                    .update({ weight_lbs: val })
                    .eq('sku', part.sku);
                }}
                step="0.1"
                min="0"
                className="w-16 text-right bg-main border border-subtle rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-content focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[10px] text-muted font-bold">lbs</span>
              <span className="text-[10px] text-muted/40 font-bold">
                ={((part.weight || 0) * part.qty).toFixed(1)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
