import React from 'react';

interface OrderChipProps {
    orderNumber: string;
    status: string;
    isSelected: boolean;
    isCombined?: boolean;
    onClick: () => void;
}

export const OrderChip: React.FC<OrderChipProps> = ({ orderNumber, status, isSelected, isCombined, onClick }) => {
    const displayStatus = status === 'ready_to_double_check' ? 'READY' :
        status === 'active' ? 'PICKING' :
            status === 'reopened' ? 'EDITING' :
                status.toUpperCase();

    return (
        <button
            onClick={onClick}
            className={`
                min-w-[140px] h-20 rounded-[2rem] font-bold ios-transition shrink-0 flex flex-col justify-center items-center relative overflow-hidden group
                ${isSelected
                    ? 'bg-accent text-white shadow-[0_20px_40px_rgba(16,185,129,0.2)] scale-105 z-10'
                    : 'bg-surface hover:bg-main text-muted border border-subtle active:scale-95'
                }
            `}
        >
            <span className={`
                text-[9px] uppercase tracking-[0.2em] leading-none mb-1 font-black flex items-center gap-1
                ${isSelected ? 'opacity-60 text-white' : 'text-accent opacity-100'}
            `}>
                {isCombined && <span title="Combined order">🔗</span>}
                {isSelected ? 'SELECTED' : displayStatus}
            </span>
            <span className={`font-mono text-2xl font-black tracking-tighter ${isSelected ? 'text-white' : 'text-content/80'}`}>
                {orderNumber}
            </span>

            {/* Subtle glow for selected */}
            {isSelected && (
                <div className="absolute inset-x-0 bottom-0 h-1.5 bg-emerald-500 animate-soft-in"></div>
            )}
        </button>
    );
};
