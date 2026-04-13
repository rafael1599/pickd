import React from 'react';
import { useDroppable } from '@dnd-kit/core';

interface DroppableZoneProps {
  id: string;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  label: string;
  labelColor: string;
  borderColor: string;
  bgColor: string;
  bgHover: string; // bg when isOver (drop highlight)
  count?: number;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  emptyMessage?: string;
}

export const DroppableZone: React.FC<DroppableZoneProps> = ({
  id,
  disabled = false,
  children,
  className = '',
  label,
  labelColor,
  borderColor,
  bgColor,
  bgHover,
  count,
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
  emptyMessage = 'No orders',
}) => {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });

  const isEmpty = count === 0 || count === undefined;

  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border-2 transition-all duration-300 flex flex-col min-h-0 ${
        isOver && !disabled
          ? `${bgHover} ${borderColor} scale-[1.01] shadow-lg`
          : `${bgColor} ${borderColor.replace('/30', '/15')}`
      } ${className}`}
    >
      {/* Zone header */}
      <div
        className={`px-3 py-2 flex items-center justify-between shrink-0 ${
          collapsible ? 'cursor-pointer' : ''
        }`}
        onClick={collapsible ? onToggleCollapse : undefined}
      >
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-black uppercase tracking-widest ${labelColor}`}>
            {label}
          </span>
          {count !== undefined && count > 0 && (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${labelColor} bg-white/10`}
            >
              {count}
            </span>
          )}
        </div>
        {collapsible && (
          <svg
            className={`w-3 h-3 ${labelColor} transition-transform duration-200 ${
              collapsed ? '' : 'rotate-180'
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>

      {/* Zone content */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2 space-y-1">
          {isEmpty && !disabled ? (
            <div className="flex items-center justify-center py-8 opacity-30">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted italic">
                {emptyMessage}
              </span>
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
};
