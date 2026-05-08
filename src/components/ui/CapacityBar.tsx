import React from 'react';
import { calculateCapacityRatio } from '../../utils/capacityUtils';

/**
 * CapacityBar: A pure UI component that communicates the fill state of a location.
 *
 * Props:
 * - current: number (current units in location)
 * - max: number (total capacity)
 * - showText: boolean (whether to show numerical info)
 */
interface CapacityBarProps {
  current?: number;
  max?: number;
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const CapacityBar: React.FC<CapacityBarProps> = ({
  current = 0,
  max = 550,
  showText = true,
  size = 'md',
  className = '',
}) => {
  const ratio = calculateCapacityRatio(current, max);
  const percentage = Math.min(ratio * 100, 100);

  const heightClass = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-4',
  }[size];

  return (
    <div className={`w-full ${className}`}>
      {showText && (
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-[10px] font-black text-muted tabular-nums">
            {current} / {max}
          </span>
          <span className="text-[10px] font-black text-emerald-400 tabular-nums">
            {Math.max(0, max - current)} free
          </span>
        </div>
      )}

      <div
        className={`${heightClass} w-full bg-surface rounded-full overflow-hidden border border-subtle`}
      >
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{
            width: `${percentage}%`,
            background: 'linear-gradient(to right, #3b82f6, #06b6d4, #10b981)',
            backgroundSize: `${100 / Math.max(ratio, 0.01)}% 100%`,
          }}
        />
      </div>
    </div>
  );
};
