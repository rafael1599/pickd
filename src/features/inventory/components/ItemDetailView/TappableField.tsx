import React, { useEffect, useRef } from 'react';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';

interface TappableFieldProps {
  label: string;
  value: string;
  isActive: boolean;
  onTap: () => void;
  onBlur: () => void;
  onChange: (value: string) => void;
  placeholder?: string;
  inputType?: 'text' | 'number';
  /** Render a custom editor instead of the default input */
  renderEditor?: () => React.ReactNode;
  /** Force editor mode (for add mode) */
  forceEdit?: boolean;
  className?: string;
}

/**
 * A field that displays as text and becomes an input on tap.
 * Auto-saves on blur / Enter. Cancels on Escape.
 */
export const TappableField: React.FC<TappableFieldProps> = ({
  label,
  value,
  isActive,
  onTap,
  onBlur,
  onChange,
  placeholder,
  inputType = 'text',
  renderEditor,
  forceEdit,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const prevValueRef = useRef(value);
  const isEditing = isActive || forceEdit;

  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      inputRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  // Store the value when entering edit mode for cancel support
  useEffect(() => {
    if (isActive) {
      prevValueRef.current = value;
    }
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onBlur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onChange(prevValueRef.current);
      onBlur();
    }
  };

  if (isEditing) {
    if (renderEditor) {
      return (
        <div className={`px-4 py-2 ${className}`}>
          <span className="text-[11px] font-bold text-accent uppercase tracking-wider block mb-1.5">
            {label}
          </span>
          {renderEditor()}
        </div>
      );
    }

    return (
      <div className={`px-4 py-2 ${className}`}>
        <span className="text-[11px] font-bold text-accent uppercase tracking-wider block mb-1.5">
          {label}
        </span>
        <input
          ref={inputRef}
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full bg-main border border-accent/30 rounded-xl px-4 py-3 text-content focus:border-accent focus:outline-none transition-colors text-sm placeholder:text-muted/40"
          inputMode={inputType === 'number' ? 'numeric' : 'text'}
        />
      </div>
    );
  }

  // Display mode
  return (
    <button
      type="button"
      onClick={onTap}
      className={`w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer ${className}`}
    >
      <span className="text-[11px] font-bold text-muted uppercase tracking-wider shrink-0 w-24">
        {label}
      </span>
      <span className="flex-1 text-sm text-content font-medium text-right truncate ml-3">
        {value || <span className="text-muted/40 italic">{placeholder || '—'}</span>}
      </span>
      <ChevronRight size={16} className="text-muted/40 ml-2 shrink-0" />
    </button>
  );
};
