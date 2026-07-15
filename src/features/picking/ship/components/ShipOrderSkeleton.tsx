import React from 'react';

/**
 * Skeleton loading state for the ShipScreen detail panel (left 60% column).
 * Mimics the layout of LivePrintPreview → status pill → ShipOrderCard
 * while the full order data is being fetched.
 */
export const ShipOrderSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500">
      {/* ── Print preview skeleton ── */}
      <div className="w-full px-1 md:px-4">
        {/* Header row: order number + carrier logo */}
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-3">
            <div className="h-7 w-48 rounded-lg bg-subtle/30 animate-pulse" />
            <div className="h-7 w-16 rounded-lg bg-subtle/30 animate-pulse" />
          </div>
          <div className="h-4 w-28 rounded-lg bg-subtle/30 animate-pulse" />
        </div>

        {/* Label card body */}
        <div
          className="bg-card border border-subtle rounded-2xl p-5 space-y-4"
          style={{ minHeight: 200 }}
        >
          {/* Two-column address & shipping details */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {/* Left column — address lines */}
            <div className="space-y-2.5">
              <div className="h-4 w-full rounded-lg bg-subtle/30 animate-pulse" />
              <div className="h-4 w-3/4 rounded-lg bg-subtle/30 animate-pulse" />
              <div className="h-4 w-5/6 rounded-lg bg-subtle/30 animate-pulse" />
            </div>
            {/* Right column — shipping details */}
            <div className="space-y-2.5">
              <div className="h-4 w-2/3 rounded-lg bg-subtle/30 animate-pulse" />
              <div className="h-4 w-1/2 rounded-lg bg-subtle/30 animate-pulse" />
              <div className="h-4 w-3/4 rounded-lg bg-subtle/30 animate-pulse" />
            </div>
          </div>

          {/* Spacer */}
          <div className="border-t border-subtle" />

          {/* Bottom bar — weight / units info */}
          <div className="flex items-center gap-4">
            <div className="h-5 w-24 rounded-lg bg-subtle/30 animate-pulse" />
            <div className="h-5 w-20 rounded-lg bg-subtle/30 animate-pulse" />
            <div className="h-5 w-28 rounded-lg bg-subtle/30 animate-pulse" />
          </div>
        </div>
      </div>

      {/* ── Status bar skeleton (inline pill) ── */}
      <div className="-mt-2 px-1">
        <div className="inline-flex items-center gap-2 rounded-full border border-subtle bg-card px-3 py-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-subtle/30 animate-pulse" />
          <div className="h-3 w-16 rounded-lg bg-subtle/30 animate-pulse" />
          <span className="text-subtle/30">·</span>
          <div className="h-3 w-14 rounded-lg bg-subtle/30 animate-pulse" />
          <span className="text-subtle/30">·</span>
          <div className="h-3 w-12 rounded-lg bg-subtle/30 animate-pulse" />
        </div>
      </div>

      {/* ── Order card skeleton (mirrors ShipOrderCard) ── */}
      <div className="w-full bg-card border border-subtle rounded-3xl p-5 md:p-7 flex flex-col gap-5 relative overflow-hidden">
        {/* Decorative blur (matches ShipOrderCard) */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-accent/5 blur-[100px] pointer-events-none" />

        {/* Header row: status pill + customer name */}
        <div className="flex items-start gap-4">
          <div className="h-6 w-24 rounded-full bg-subtle/30 animate-pulse" />
        </div>

        {/* Customer name */}
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-lg bg-subtle/30 animate-pulse" />
          <div className="h-6 w-56 rounded-lg bg-subtle/30 animate-pulse" />
        </div>

        {/* Address block */}
        <div className="flex items-start gap-2 pb-4 border-b border-dashed border-subtle">
          <div className="h-5 w-5 rounded-lg bg-subtle/30 animate-pulse mt-0.5" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-full max-w-xs rounded-lg bg-subtle/30 animate-pulse" />
            <div className="h-4 w-2/3 max-w-[200px] rounded-lg bg-subtle/30 animate-pulse" />
          </div>
        </div>

        {/* Form fields — 5 label+input pairs in a grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              {/* Label */}
              <div className="h-3 w-16 rounded bg-subtle/30 animate-pulse" />
              {/* Input */}
              <div className="h-10 w-full rounded-2xl bg-subtle/30 animate-pulse" />
            </div>
          ))}
        </div>

        {/* Big stat numbers row (pallets / bikes / parts / weight) */}
        <div className="flex flex-wrap gap-6 pt-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-14 w-20 rounded-2xl bg-subtle/30 animate-pulse" />
              <div className="h-2.5 w-12 rounded bg-subtle/30 animate-pulse" />
            </div>
          ))}
        </div>

        {/* Action buttons row */}
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-2">
          <div className="flex-1 min-w-[160px] h-12 rounded-2xl bg-subtle/30 animate-pulse" />
          <div className="flex-1 min-w-[160px] h-12 rounded-2xl bg-subtle/30 animate-pulse" />
          <div className="flex-1 min-w-[160px] h-12 rounded-2xl bg-subtle/30 animate-pulse" />
        </div>
      </div>
    </div>
  );
};
