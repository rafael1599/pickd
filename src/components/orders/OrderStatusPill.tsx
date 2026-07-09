import React from 'react';

const LABELS: Record<string, string> = {
  ready_to_double_check: 'Ready',
  active: 'Picking',
  reopened: 'Editing',
  completed: 'Completed',
  cancelled: 'Cancelled',
  needs_correction: 'Needs Fix',
  double_checking: 'Checking',
};

const COLORS: Record<string, string> = {
  ready_to_double_check: 'bg-sky-500/15 text-sky-400',
  active: 'bg-orange-500/15 text-orange-400',
  reopened: 'bg-purple-500/15 text-purple-400',
  completed: 'bg-emerald-500/15 text-emerald-400',
  cancelled: 'bg-red-500/15 text-red-400',
  needs_correction: 'bg-red-500/15 text-red-400',
  double_checking: 'bg-sky-500/15 text-sky-400',
};

export const OrderStatusPill: React.FC<{ status: string; className?: string }> = ({
  status,
  className = '',
}) => (
  <span
    className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full shrink-0 ${COLORS[status] || 'bg-subtle text-muted'} ${className}`}
  >
    {LABELS[status] || status.toUpperCase()}
  </span>
);
