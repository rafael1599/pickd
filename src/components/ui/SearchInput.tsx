import React, { useState, useEffect, useRef } from 'react';
import Search from 'lucide-react/dist/esm/icons/search';
import Type from 'lucide-react/dist/esm/icons/type';
import Hash from 'lucide-react/dist/esm/icons/hash';
import X from 'lucide-react/dist/esm/icons/x';
import { useViewMode } from '../../context/ViewModeContext';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * 'sticky' (default): Sticky bar with background blur
   * 'inline': Standard input without sticky wrapper
   */
  variant?: 'sticky' | 'inline';
  /** If true, starts collapsed as an icon and expands on interaction */
  isExpandable?: boolean;
  /** Controlled expanded state */
  isExpanded?: boolean;
  /** Callback for expansion state changes */
  onExpandChange?: (expanded: boolean) => void;
  /** Optional element to render on the right of the input (e.g. Filter button) */
  rightSlot?: React.ReactNode;
  /** Optional callback when the clear button is clicked */
  onClear?: () => void;
  autoFocus?: boolean;
  className?: string;
  /** ID for persistent keyboard preference */
  preferenceId?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onChange,
      placeholder = 'Search...',
      variant = 'sticky',
      isExpandable = false,
      isExpanded: controlledExpanded,
      onExpandChange,
      rightSlot,
      onClear,
      autoFocus = false,
      className = '',
      preferenceId = 'main',
    },
    ref
  ) => {
    const { isSearching, setIsSearching } = useViewMode();
    const [internalExpanded, setInternalExpanded] = useState(!isExpandable || !!value);

    const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
    const setIsExpanded = (val: boolean) => {
      setInternalExpanded(val);
      onExpandChange?.(val);
    };

    const internalRef = useRef<HTMLInputElement>(null);
    const inputRef = (ref as React.RefObject<HTMLInputElement>) || internalRef;

    const [keyboardMode, setKeyboardMode] = useState<'text' | 'numeric'>(() => {
      const saved = localStorage.getItem(`kb_pref_search_${preferenceId}`);
      return (saved as 'text' | 'numeric') || 'numeric';
    });

    // Auto-focus logic — only if input is not covered by a modal/overlay
    useEffect(() => {
      if (autoFocus && inputRef.current && isExpanded) {
        const rect = inputRef.current.getBoundingClientRect();
        const topEl = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (inputRef.current.contains(topEl)) {
          inputRef.current.focus();
        }
      }
    }, [autoFocus, inputRef, isExpanded]);

    // Handle expansion when value changes externally
    useEffect(() => {
      if (value && !isExpanded) {
        setIsExpanded(true);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- setIsExpanded is a non-stable local function; adding it would cause infinite re-renders
    }, [value, isExpanded]);

    const toggleKeyboard = (e: React.MouseEvent) => {
      e.stopPropagation();
      const newMode = keyboardMode === 'text' ? 'numeric' : 'text';
      setKeyboardMode(newMode);
      localStorage.setItem(`kb_pref_search_${preferenceId}`, newMode);
      if (inputRef.current) inputRef.current.focus();
    };

    const handleClear = (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange('');
      onClear?.();
      inputRef.current?.focus();
    };

    const handleSearchClick = () => {
      if (isExpandable && !isExpanded) {
        setIsExpanded(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    };

    const containerBase =
      variant === 'sticky'
        ? `sticky top-0 z-40 bg-main/90 backdrop-blur-2xl border-b border-subtle transition-all duration-500 ease-out ${isSearching ? 'py-2 px-3' : 'py-4 px-4'}`
        : className || 'w-full';

    const inputWrapperClass = isExpandable
      ? `flex items-center bg-surface border border-subtle transition-all duration-500 ease-in-out shadow-sm ${
          isExpanded
            ? 'flex-1 rounded-2xl px-4 h-12 border-accent/20 ring-1 ring-accent/10'
            : 'w-12 h-12 rounded-full justify-center hover:bg-white/5'
        }`
      : `relative flex-1 flex items-center bg-surface border border-subtle rounded-2xl px-4 h-12 transition-all duration-300 ${
          isSearching ? 'border-accent/40 ring-1 ring-accent/20' : ''
        }`;

    return (
      <div className={containerBase}>
        <div
          className={`${variant === 'sticky' ? 'max-w-4xl mx-auto' : 'w-full h-full'} flex items-center gap-3`}
        >
          <div className={inputWrapperClass} onClick={handleSearchClick}>
            <button
              type="button"
              className={`shrink-0 transition-colors ${
                isExpanded ? 'text-accent' : 'text-muted hover:text-accent'
              }`}
              onClick={handleSearchClick}
            >
              <Search size={isSearching ? 18 : 20} className="transition-all duration-300" />
            </button>

            {(!isExpandable || isExpanded) && (
              <>
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder={placeholder}
                  inputMode={keyboardMode}
                  onFocus={() => setIsSearching?.(variant === 'sticky')}
                  onBlur={() => {
                    if (!value && isExpandable) {
                      setTimeout(() => setIsExpanded(false), 200);
                    }
                    setTimeout(() => setIsSearching?.(false), 200);
                  }}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck="false"
                  className="flex-1 bg-transparent border-none outline-none text-content ml-3 w-full font-bold placeholder:text-muted/20"
                  style={{ fontFamily: 'var(--font-body)' }}
                />

                <div className="flex items-center gap-1 shrink-0 ml-2">
                  {value && (
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleClear}
                      className="p-1.5 text-muted hover:text-content transition-colors active:scale-75"
                      aria-label="Clear search"
                    >
                      <X size={16} />
                    </button>
                  )}

                  <div className="w-px h-4 bg-subtle mx-1 opacity-50" />

                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={toggleKeyboard}
                    className={`p-1.5 rounded-lg active:scale-90 transition-all ${
                      keyboardMode === 'numeric' ? 'text-accent' : 'text-muted'
                    }`}
                    title={keyboardMode === 'numeric' ? 'Alpha Mode' : 'Numeric Mode'}
                  >
                    {keyboardMode === 'numeric' ? <Hash size={18} /> : <Type size={18} />}
                  </button>
                </div>
              </>
            )}
          </div>

          {rightSlot && (
            <div
              className={`transition-all duration-500 ${isExpandable && isExpanded ? 'opacity-0 scale-90 w-0 overflow-hidden' : 'opacity-100 scale-100'}`}
            >
              {rightSlot}
            </div>
          )}
        </div>
      </div>
    );
  }
);

SearchInput.displayName = 'SearchInput';
