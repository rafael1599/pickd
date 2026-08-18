import React from 'react';
import { createPortal } from 'react-dom';
import Bike from 'lucide-react/dist/esm/icons/bike';
import Package from 'lucide-react/dist/esm/icons/package';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import X from 'lucide-react/dist/esm/icons/x';

export type RegisterType = 'bike' | 'part';

interface RegisterTypeSelectorProps {
  value: RegisterType | null;
  onChange: (type: RegisterType) => void;
  title?: string;
  subtitle?: string;
  className?: string;
  compact?: boolean;
  large?: boolean;
}

export const RegisterTypeSelector: React.FC<RegisterTypeSelectorProps> = ({
  value,
  onChange,
  title = 'What are you registering?',
  subtitle = 'Choose whether this is a Bike or a Part / Accessory — it sets the default weight and dimensions.',
  className = '',
  compact = false,
  large = false,
}) => {
  return (
    <div className={`space-y-3 ${className}`}>
      {title && (
        <div className="text-center sm:text-left space-y-1 mb-2">
          <label className="text-xs font-black uppercase tracking-widest text-muted block">
            {title} <span className="text-red-400">*</span>
          </label>
          {subtitle && <p className="text-[11px] font-medium text-muted/80">{subtitle}</p>}
        </div>
      )}

      <div className={`grid grid-cols-2 gap-3 ${compact ? 'max-w-md' : 'w-full'}`}>
        {/* BUTTON 1: BIKE */}
        <button
          type="button"
          onClick={() => onChange('bike')}
          className={`relative flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all duration-200 text-center active:scale-95 group ${
            large ? 'min-h-[180px]' : ''
          } ${
            value === 'bike'
              ? 'bg-blue-500/15 border-blue-500 text-blue-400 shadow-lg shadow-blue-500/10 ring-2 ring-blue-500/30'
              : 'bg-surface/60 hover:bg-surface border-subtle text-muted hover:text-content hover:border-blue-500/40'
          }`}
        >
          {value === 'bike' && (
            <div className="absolute top-2 right-2 text-blue-400">
              <CheckCircle2 size={16} />
            </div>
          )}
          <div
            className={`${large ? 'w-16 h-16' : 'w-12 h-12'} rounded-xl flex items-center justify-center mb-2 transition-colors ${
              value === 'bike'
                ? 'bg-blue-500 text-white shadow-md'
                : 'bg-muted/10 text-muted group-hover:bg-blue-500/20 group-hover:text-blue-400'
            }`}
          >
            <Bike size={large ? 36 : compact ? 22 : 28} />
          </div>
          <span
            className={`${large ? 'text-sm' : 'text-xs'} font-black uppercase tracking-wider block text-content`}
          >
            BIKE
          </span>
          <span className="text-[10px] text-muted font-medium mt-0.5 block leading-tight">
            Complete unit / Frame
          </span>
        </button>

        {/* BUTTON 2: PART / ACCESSORY */}
        <button
          type="button"
          onClick={() => onChange('part')}
          className={`relative flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all duration-200 text-center active:scale-95 group ${
            large ? 'min-h-[180px]' : ''
          } ${
            value === 'part'
              ? 'bg-amber-500/15 border-amber-500 text-amber-400 shadow-lg shadow-amber-500/10 ring-2 ring-amber-500/30'
              : 'bg-surface/60 hover:bg-surface border-subtle text-muted hover:text-content hover:border-amber-500/40'
          }`}
        >
          {value === 'part' && (
            <div className="absolute top-2 right-2 text-amber-400">
              <CheckCircle2 size={16} />
            </div>
          )}
          <div
            className={`${large ? 'w-16 h-16' : 'w-12 h-12'} rounded-xl flex items-center justify-center mb-2 transition-colors ${
              value === 'part'
                ? 'bg-amber-500 text-white shadow-md'
                : 'bg-muted/10 text-muted group-hover:bg-amber-500/20 group-hover:text-amber-400'
            }`}
          >
            <Package size={large ? 36 : compact ? 22 : 28} />
          </div>
          <span
            className={`${large ? 'text-sm' : 'text-xs'} font-black uppercase tracking-wider block text-content`}
          >
            PART / ACCESSORY
          </span>
          <span className="text-[10px] text-muted font-medium mt-0.5 block leading-tight">
            Saddles, pedals, spare parts
          </span>
        </button>
      </div>
    </div>
  );
};

/**
 * Compact colored badge showing the chosen type. Pass `onEdit` to make it
 * tappable (shows a pencil) — used in form headers after the type gate so the
 * choice stays visible and editable without taking up form space.
 * Color code (keep consistent everywhere): bike = blue, part = amber.
 */
export const TypeChip: React.FC<{
  type: RegisterType;
  onEdit?: () => void;
  className?: string;
}> = ({ type, onEdit, className = '' }) => {
  const isBike = type === 'bike';
  const tone = isBike
    ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
    : 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  const content = (
    <>
      {isBike ? <Bike size={13} /> : <Package size={13} />}
      <span>{isBike ? 'Bike' : 'Part'}</span>
      {onEdit && <Pencil size={11} className="opacity-60" />}
    </>
  );
  const base = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider border ${tone} ${className}`;
  if (onEdit) {
    return (
      <button type="button" onClick={onEdit} className={`${base} active:scale-95 transition-all`}>
        {content}
      </button>
    );
  }
  return <span className={base}>{content}</span>;
};

/**
 * One-line segmented control for quick repetitive flows (FedEx intake,
 * create-SKU-in-sheet) where a full-screen gate would slow the operator down.
 * Highlights red until a choice is made — no pre-selected default on purpose.
 */
export const RegisterTypeSegmented: React.FC<{
  value: RegisterType | null;
  onChange: (type: RegisterType) => void;
  label?: string;
  className?: string;
}> = ({ value, onChange, label = 'Type', className = '' }) => {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <span className="text-xs font-black uppercase tracking-widest text-muted">
        {label} <span className="text-red-400">*</span>
      </span>
      <div
        className={`inline-flex items-center p-0.5 rounded-lg border ${
          value === null
            ? 'border-red-400/50 bg-red-500/5 animate-pulse'
            : 'border-subtle bg-surface/60'
        }`}
      >
        <button
          type="button"
          onClick={() => onChange('bike')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
            value === 'bike' ? 'bg-blue-600 text-white shadow-sm' : 'text-muted hover:text-content'
          }`}
        >
          <Bike size={14} /> Bike
        </button>
        <button
          type="button"
          onClick={() => onChange('part')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
            value === 'part' ? 'bg-amber-500 text-white shadow-sm' : 'text-muted hover:text-content'
          }`}
        >
          <Package size={14} /> Part
        </button>
      </div>
    </div>
  );
};

/**
 * Full-screen type gate — the one place the Bike/Part question is asked BIG.
 * Shown once before a registration form; afterwards the choice lives in a
 * TypeChip. Mandatory when no `onClose` is passed (first time, nothing chosen
 * yet); reopening from the chip passes `onClose` so the user can back out.
 */
export const RegisterTypeGate: React.FC<{
  value: RegisterType | null;
  onSelect: (type: RegisterType) => void;
  onClose?: () => void;
  title?: string;
  subtitle?: string;
}> = ({
  value,
  onSelect,
  onClose,
  title = 'What are you registering?',
  subtitle = 'This choice sets the default weight and dimensions for the new SKU.',
}) => {
  return createPortal(
    <div className="fixed inset-0 z-[190] bg-[#0F1115] text-white overflow-y-auto animate-in fade-in duration-200">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <X size={20} />
        </button>
      )}
      <div className="min-h-full flex items-center justify-center p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-black text-white">{title}</h2>
            <p className="text-sm text-white/50">{subtitle}</p>
          </div>
          <RegisterTypeSelector value={value} onChange={onSelect} title="" large />
          <p className="text-center text-xs text-white/30">You can change this later.</p>
        </div>
      </div>
    </div>,
    document.body
  );
};
