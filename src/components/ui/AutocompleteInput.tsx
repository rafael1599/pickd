import { useState, useEffect, useRef, ReactNode } from 'react';
import { useAutoSelect } from '../../hooks/useAutoSelect';
import Search from 'lucide-react/dist/esm/icons/search';
import X from 'lucide-react/dist/esm/icons/x';
import Hash from 'lucide-react/dist/esm/icons/hash';
import Type from 'lucide-react/dist/esm/icons/type';

interface Suggestion {
  value: string;
  info?: string;
}

interface AutocompleteInputProps<T extends Suggestion = Suggestion> {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  suggestions?: T[];
  placeholder?: string;
  label?: string;
  minChars?: number;
  onSelect?: (suggestion: T) => void;
  disabled?: boolean;
  className?: string;
  renderItem?: (suggestion: T) => ReactNode;
  onBlur?: (value: string) => void;
  initialKeyboardMode?: 'text' | 'numeric';
}

/**
 * Autocomplete Input Component
 * Shows suggestions as user types with additional information
 * Mobile: Shows modal with suggestions
 * Desktop: Shows dropdown below input
 */
export default function AutocompleteInput<T extends Suggestion = Suggestion>({
  id,
  value,
  onChange,
  suggestions = [],
  placeholder = '',
  label = '',
  minChars = 2,
  onSelect,
  disabled = false,
  className = '',
  renderItem,
  onBlur,
  initialKeyboardMode = 'text',
}: AutocompleteInputProps<T>) {
  const [inputValue, setInputValue] = useState(value || '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<T[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isMobile, setIsMobile] = useState(false);

  type KeyboardMode = 'text' | 'numeric' | 'decimal' | 'tel' | 'search' | 'email' | 'url' | 'none';

  // Keyboard mode persistence logic
  const [keyboardMode, setKeyboardMode] = useState<KeyboardMode>(() => {
    if (!id) return initialKeyboardMode as KeyboardMode;
    const saved = localStorage.getItem(`kb_pref_${id}`);
    return (saved as KeyboardMode) || (initialKeyboardMode as KeyboardMode);
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const autoSelect = useAutoSelect();

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Update input value when prop changes
  useEffect(() => {
    setInputValue(value || ''); // eslint-disable-line react-hooks/set-state-in-effect
  }, [value]);

  // Filter suggestions based on input
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (inputValue.length >= minChars) {
      // Check if input is an exact match with any suggestion
      const isExactMatch = suggestions.some(
        (item) => item?.value?.toLowerCase() === inputValue.toLowerCase()
      );

      // If it's an exact match, don't show suggestions
      if (isExactMatch) {
        setFilteredSuggestions([]);
        setShowSuggestions(false);
      } else {
        // Filter suggestions
        const filtered = suggestions.filter((item) =>
          item?.value?.toLowerCase().includes(inputValue.toLowerCase())
        );
        setFilteredSuggestions(filtered);
        setShowSuggestions(filtered.length > 0);
      }
    } else {
      setFilteredSuggestions([]);
      setShowSuggestions(false);
    }
    setSelectedIndex(-1);
  }, [inputValue, suggestions, minChars]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
  };

  const handleSelect = (suggestion: T) => {
    setInputValue(suggestion.value);
    onChange(suggestion.value);
    setShowSuggestions(false);
    if (onSelect) {
      onSelect(suggestion);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredSuggestions.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSelect(filteredSuggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  const handleClear = () => {
    setInputValue('');
    onChange('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const toggleKeyboardMode = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const newMode: KeyboardMode = keyboardMode === 'text' ? 'numeric' : 'text';
    setKeyboardMode(newMode);

    if (id) {
      localStorage.setItem(`kb_pref_${id}`, newMode);
    }

    // Force mobile keyboard refresh by cycling focus
    if (inputRef.current && isMobile) {
      const currentVal = inputRef.current.value;
      inputRef.current.blur();
      // Micro-task to ensure OS registers the blur
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Maintain cursor position at the end
          inputRef.current.setSelectionRange(currentVal.length, currentVal.length);
        }
      }, 50);
    }
  };

  return (
    <div className="relative">
      {/* Label */}
      {label && (
        <label htmlFor={id} className="block text-sm font-semibold text-accent mb-2">
          {label}
        </label>
      )}

      {/* Input */}
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            autoSelect.onFocus(e);
            if (inputValue.length >= minChars && filteredSuggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          onPointerUp={autoSelect.onPointerUp}
          onBlur={(e) => {
            // Small delay to allow click on dropdown items to register first
            setTimeout(() => {
              if (onBlur) onBlur(e.target.value);
            }, 200);
          }}
          inputMode={keyboardMode}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck="false"
          placeholder={placeholder}
          disabled={disabled}
          className={`${className || 'w-full px-4 py-3 bg-main border border-subtle rounded-lg text-content placeholder-muted/50 focus:border-accent focus:outline-none transition-colors font-mono'} ${isMobile ? 'pr-20' : 'pr-10'}`}
        />

        {/* Control Actions Container */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {/* Keyboard Mode Toggle (Mobile Only) */}
          {isMobile && !disabled && (
            <button
              type="button"
              onClick={toggleKeyboardMode}
              className={`p-2 rounded-md transition-all active:scale-90 ${
                keyboardMode === 'numeric'
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'bg-surface text-muted border border-subtle'
              }`}
              title={`Switch to ${keyboardMode === 'text' ? 'Numeric' : 'Text'} keyboard`}
            >
              {keyboardMode === 'text' ? <Hash size={18} /> : <Type size={18} />}
            </button>
          )}

          {/* Clear button */}
          {inputValue && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-2 text-muted hover:text-content transition-colors"
            >
              <X size={18} />
            </button>
          )}

          {/* Search icon when empty and not mobile (or if search is preferred) */}
          {!inputValue && !isMobile && (
            <div className="p-2 text-muted pointer-events-none">
              <Search size={18} />
            </div>
          )}
        </div>
      </div>

      {/* Desktop Dropdown */}
      {showSuggestions && !isMobile && filteredSuggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-[60] w-full mt-2 bg-card border border-subtle rounded-lg shadow-xl max-h-64 overflow-y-auto"
        >
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.value}
              type="button"
              onClick={() => handleSelect(suggestion)}
              className={`w-full px-4 py-3 text-left hover:bg-surface transition-colors border-b border-subtle last:border-b-0 ${
                index === selectedIndex ? 'bg-surface' : ''
              }`}
            >
              {renderItem ? (
                renderItem(suggestion)
              ) : (
                <>
                  <div className="font-semibold text-content">{suggestion.value}</div>
                  {suggestion.info && (
                    <div className="text-sm text-muted mt-1">{suggestion.info}</div>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Mobile Modal */}
      {showSuggestions && isMobile && filteredSuggestions.length > 0 && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col">
          {/* Header */}
          <div className="bg-main border-b border-subtle p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="text-accent" size={20} />
              <h3 className="text-lg font-bold text-accent">Select {label}</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowSuggestions(false)}
              className="text-muted hover:text-content"
            >
              <X size={24} />
            </button>
          </div>

          {/* Search preview */}
          <div className="bg-card border-b border-subtle p-4">
            <div className="text-sm text-muted">Searching for:</div>
            <div className="text-lg font-semibold text-content mt-1">{inputValue}</div>
            <div className="text-sm text-accent mt-1">
              {filteredSuggestions.length} result{filteredSuggestions.length !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Suggestions List */}
          <div className="flex-1 overflow-y-auto">
            {filteredSuggestions.map((suggestion) => (
              <button
                key={suggestion.value}
                type="button"
                onClick={() => handleSelect(suggestion)}
                className="w-full px-4 py-4 text-left hover:bg-surface active:bg-surface transition-colors border-b border-subtle touch-manipulation"
              >
                {renderItem ? (
                  renderItem(suggestion)
                ) : (
                  <>
                    <div className="font-semibold text-content text-lg">{suggestion.value}</div>
                    {suggestion.info && (
                      <div className="text-sm text-muted mt-2">{suggestion.info}</div>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="bg-main border-t border-subtle p-4">
            <button
              type="button"
              onClick={() => setShowSuggestions(false)}
              className="w-full px-6 py-3 bg-surface hover:opacity-80 text-content rounded-lg font-semibold transition-colors touch-manipulation"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
