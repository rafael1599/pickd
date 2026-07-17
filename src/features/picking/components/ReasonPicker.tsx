import React, { useState, useEffect } from 'react';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';

export type ReasonActionType =
  | 'remove'
  | 'swap'
  | 'adjust_qty'
  | 'add'
  | 'reopen'
  | 'restore'
  | 'waiting';

const REASON_PRESETS: Record<ReasonActionType, string[]> = {
  remove: ['Out of stock', 'Customer cancelled', 'Damaged/defective', 'Wrong item on order'],
  swap: [
    'Out of stock — replacing',
    'Wrong size/color',
    'Customer requested',
    'Damaged — swapping',
  ],
  adjust_qty: ['Partial stock only', 'Customer changed qty', 'Damaged units', 'Count correction'],
  add: ['Replacement for removed item', 'Customer add-on', 'Missing from original order'],
  reopen: [
    // Add-On flow lives on open orders via the COMBINE button — no longer a
    // reopen reason. See DoubleCheckView + AddOnTargetPickerModal.
    'Item out of stock',
    'Wrong item shipped',
    'Customer change request',
    'Correction needed',
  ],
  restore: [
    'Cancelled by mistake',
    'Customer changed mind',
    'Cancelled wrong order',
    'Need to continue picking',
  ],
  waiting: [
    'Bike not yet received',
    'Waiting for james',
    'Waiting for add ons',
    'Awaiting customer confirmation',
  ],
};

interface ReasonPickerProps {
  actionType: ReasonActionType;
  preselect?: string;
  selectedReason: string;
  onReasonChange: (reason: string) => void;
}

export const ReasonPicker: React.FC<ReasonPickerProps> = ({
  actionType,
  preselect,
  selectedReason,
  onReasonChange,
}) => {
  const [showOther, setShowOther] = useState(false);
  const [additionalDetails, setAdditionalDetails] = useState('');
  const presets = REASON_PRESETS[actionType];

  useEffect(() => {
    if (preselect && !selectedReason) {
      onReasonChange(preselect);
    }
  }, [preselect, selectedReason, onReasonChange]);

  const handleChipClick = (reason: string) => {
    // Extract base preset (before " — " separator if present)
    const basePreset = selectedReason?.split(' — ')[0];
    if (basePreset === reason) {
      // Deselecting
      onReasonChange('');
      setAdditionalDetails('');
    } else {
      // Selecting new preset
      onReasonChange(reason);
      setAdditionalDetails('');
      setShowOther(false);
    }
  };

  const handleDetailsChange = (details: string) => {
    setAdditionalDetails(details);
    // Combine preset + details
    const basePreset = selectedReason?.split(' — ')[0] || presets[0];
    if (details.trim()) {
      onReasonChange(`${basePreset} — ${details.trim()}`);
    } else {
      onReasonChange(basePreset);
    }
  };

  const handleOtherToggle = () => {
    setShowOther(true);
    onReasonChange('');
  };

  const isWaiting = actionType === 'waiting';
  const basePreset = selectedReason?.split(' — ')[0];
  const isPresetSelected = presets.includes(basePreset || selectedReason);

  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-2">
        <MessageSquare size={10} className="text-muted/60" />
        <span className="text-[9px] font-black text-muted/60 uppercase tracking-widest">
          {isWaiting ? 'Why is this order waiting for inventory?' : 'Why?'}
        </span>
      </div>
      {isWaiting && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300 leading-relaxed">
          This order will be moved to the <strong>Waiting for Inventory</strong> list at the bottom
          of the Live Board. It stays out of the active queue until you bring it back.
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {presets.map((reason) => {
          const isSelected = basePreset === reason;
          return (
            <button
              key={reason}
              type="button"
              onClick={() => handleChipClick(reason)}
              className={`min-h-10 px-2.5 rounded-xl text-[10px] font-bold leading-tight border transition-all active:scale-[0.97] text-left ${
                isSelected
                  ? 'bg-accent/20 text-accent border-accent/40'
                  : 'bg-surface text-muted border-subtle hover:bg-surface/80'
              }`}
            >
              {reason}
            </button>
          );
        })}
        {!showOther && !isPresetSelected && (
          <button
            type="button"
            onClick={handleOtherToggle}
            className="min-h-10 px-2.5 rounded-xl text-[10px] font-bold leading-tight border bg-surface text-muted/50 border-subtle hover:bg-surface/80 transition-all active:scale-[0.97] text-left"
          >
            Other...
          </button>
        )}
      </div>

      {isPresetSelected && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={additionalDetails}
            onChange={(e) => handleDetailsChange(e.target.value)}
            placeholder="Add details or context (optional)..."
            className="w-full px-3 py-2.5 bg-surface border border-subtle rounded-xl text-content text-xs placeholder-muted/50 focus:outline-none focus:border-accent/40"
          />
          <div className="text-[9px] text-muted/60">
            Saved as: <span className="text-accent font-semibold">{selectedReason}</span>
          </div>
        </div>
      )}

      {showOther && !isPresetSelected && (
        <input
          type="text"
          value={selectedReason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Type reason..."
          autoFocus
          className="w-full mt-2 px-3 py-2.5 bg-surface border border-subtle rounded-xl text-content text-xs placeholder-muted/50 focus:outline-none focus:border-accent/40"
        />
      )}
    </div>
  );
};
