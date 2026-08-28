import React from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import { orderColorFor } from '../../utils/orderColors';

export interface CombinedOrderNumbersProps {
  /** 2+ sub-order numbers — render nothing for 0/1 (callers keep their own
   *  single-order fallback, e.g. a stock-deduction chip or a plain "#123"). */
  numbers: string[];
  activeOrderFilter: string | null;
  onToggle: (orderNumber: string) => void;
  /** Optional per-order unit counts, shown under the number in the 'header' variant. */
  unitsByOrder?: Record<string, number>;
  /**
   * 'header' — flat colored mono text in a bg chip (DoubleCheckView's header).
   * 'inline' — embossed 3D digits (board/live-board cards), rendered with
   *   <span> (not <button>) so it nests safely inside a card's own
   *   onClick/<button> wrapper — click still toggles the filter via
   *   stopPropagation, it just isn't its own focusable control.
   */
  variant: 'header' | 'inline';
  /** 'header' only: strips the bg chip + unit-count row for a smaller,
   *  flat-color-only rendering (Ship feed rail, Orders list row). */
  compact?: boolean;
  /** Whole order numbers (881303 / 881301) instead of the last three digits —
   *  the Ship card header (Rafael, 2026-08-27); the click-to-filter stays. */
  full?: boolean;
  className?: string;
}

/** Clickable, per-order-colored rendering of a combined order's sub-order
 *  numbers, shared by every screen that shows a combined order — clicking a
 *  number toggles `useCombinedOrderFilter`'s activeOrderFilter. Pair with
 *  `ActiveFilterPill` for the "go back to combined" control. */
export const CombinedOrderNumbers: React.FC<CombinedOrderNumbersProps> = ({
  numbers,
  activeOrderFilter,
  onToggle,
  unitsByOrder,
  variant,
  compact = false,
  full = false,
  className = '',
}) => {
  if (numbers.length < 2) return null;
  const shown = (num: string) => (full ? num : num.slice(-3));

  if (variant === 'inline') {
    return (
      <span className={className}>
        <span className="text-content/35 mr-1 select-none">#</span>
        {numbers.map((num, i) => {
          const c = orderColorFor(num, numbers);
          const dimmed = !!activeOrderFilter && activeOrderFilter !== num;
          return (
            <React.Fragment key={num}>
              {i > 0 && <span className="text-content/35 mx-1.5 select-none">/</span>}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(num);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(num);
                }}
                style={{ textShadow: c.shadow }}
                className={`${c.face} text-[1.27em] font-black tracking-tight leading-none inline-block align-baseline relative z-10 transition-opacity cursor-pointer ${
                  dimmed ? 'opacity-40' : ''
                }`}
              >
                {shown(num)}
              </span>
            </React.Fragment>
          );
        })}
      </span>
    );
  }

  if (compact) {
    return (
      <span
        className={`font-mono font-black flex items-center flex-wrap ${className}`}
        title={`${numbers.length} orders combined: ${numbers.map((n) => `#${n}`).join(', ')}`}
      >
        <span className="text-muted/60">#</span>
        {numbers.map((num, i) => {
          const dimmed = !!activeOrderFilter && activeOrderFilter !== num;
          return (
            <React.Fragment key={num}>
              {i > 0 && <span className="text-muted/50"> / </span>}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(num);
                }}
                style={{ color: orderColorFor(num, numbers).hex }}
                className={`transition-opacity ${dimmed ? 'opacity-40' : 'hover:opacity-80'}`}
              >
                {shown(num)}
              </button>
            </React.Fragment>
          );
        })}
      </span>
    );
  }

  return (
    <span
      className={`flex items-center text-sm md:text-base font-mono font-black tracking-widest bg-accent/10 px-2 py-1 rounded-lg border border-accent/20 ${className}`}
      title={`${numbers.length} orders combined: ${numbers.map((n) => `#${n}`).join(', ')}`}
    >
      {numbers.map((num, i) => (
        <React.Fragment key={num}>
          {i > 0 && <span className="text-accent/50 mx-1.5 self-center"> / </span>}
          <button
            type="button"
            onClick={() => onToggle(num)}
            style={{ color: orderColorFor(num, numbers).hex, lineHeight: '1.1' }}
            className={`flex flex-col items-center justify-center transition-opacity ${
              activeOrderFilter && activeOrderFilter !== num ? 'opacity-30' : 'hover:opacity-80'
            }`}
          >
            <span className="leading-none">{shown(num)}</span>
            {unitsByOrder && (
              <span className="leading-none opacity-80">{unitsByOrder[num] || 0}u</span>
            )}
          </button>
        </React.Fragment>
      ))}
    </span>
  );
};

export interface ActiveFilterPillProps {
  activeOrderFilter: string | null;
  combinedNumbers: string[];
  onClear: () => void;
}

/** Floating "Showing #X Only — tap to go back" pill shown while a combined
 *  order is filtered to one sub-order. */
export const ActiveFilterPill: React.FC<ActiveFilterPillProps> = ({
  activeOrderFilter,
  combinedNumbers,
  onClear,
}) => {
  if (!activeOrderFilter) return null;
  const orderColorHex = orderColorFor(activeOrderFilter, combinedNumbers).hex;
  const text = `Showing #${activeOrderFilter} Only`;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100]">
      <button
        onClick={onClear}
        className="backdrop-blur border px-4 py-2.5 rounded-full shadow-lg text-sm font-bold flex items-center gap-2 transition-all whitespace-nowrap animate-in fade-in slide-in-from-bottom-4"
        style={{
          backgroundColor: `${orderColorHex}26`,
          borderColor: `${orderColorHex}4D`,
          color: orderColorHex,
          boxShadow: `0 10px 15px -3px ${orderColorHex}1a`,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${orderColorHex}40`)}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = `${orderColorHex}26`)}
      >
        <X size={16} />
        <span className="flex">
          {text.split('').map((char, index) => (
            <span
              key={index}
              className="animate-color-wave"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              {char === ' ' ? ' ' : char}
            </span>
          ))}
        </span>
      </button>
    </div>
  );
};
