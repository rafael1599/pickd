import React from 'react';
import shippedImg from '../../assets/shipped.png';

const LABELS: Record<string, string> = {
  ready_to_double_check: 'To Verify',
  active: 'Pulling',
  reopened: 'Editing',
  completed: 'Verified',
  cancelled: 'Cancelled',
  needs_correction: 'Needs Correction',
  double_checking: 'Verifying',
};

const COLORS: Record<string, string> = {
  ready_to_double_check: 'bg-sky-500/15 text-sky-400 border border-sky-500/10',
  active: 'bg-orange-500/15 text-orange-400 border border-orange-500/10',
  reopened: 'bg-purple-500/15 text-purple-400 border border-purple-500/10',
  completed: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/10',
  cancelled: 'bg-red-500/15 text-red-400 border border-red-500/10',
  needs_correction: 'bg-red-500/15 text-red-400 border border-red-500/10',
  double_checking: 'bg-sky-500/15 text-sky-400 border border-sky-500/10',
};

interface OrderStatusPillProps {
  status: string;
  is_waiting_inventory?: boolean | null;
  is_shipped?: boolean | null;
  className?: string;
}

export const OrderStatusPill: React.FC<OrderStatusPillProps> = ({
  status,
  is_waiting_inventory,
  is_shipped,
  className = '',
}) => {
  if (is_shipped) {
    return (
      <img
        src={shippedImg}
        alt="Shipped"
        className={`h-6 w-auto object-contain shrink-0 ${className}`}
      />
    );
  }

  let label = LABELS[status] || status.toUpperCase();
  let colorClass = COLORS[status] || 'bg-subtle text-muted border border-subtle';

  if (is_waiting_inventory) {
    label = 'Waiting';
    colorClass = 'bg-amber-500/15 text-amber-500 border border-amber-500/10';
  }

  return (
    <span
      className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full shrink-0 ${colorClass} ${className}`}
    >
      {label}
    </span>
  );
};
