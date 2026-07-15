import React from 'react';

export const ShipOrderListSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col gap-2 w-full animate-in fade-in duration-500">
      <div className="px-2 py-1 space-y-1 mb-2">
        <div className="h-3 w-24 rounded bg-subtle/30 animate-pulse" />
        <div className="h-3 w-32 rounded bg-subtle/30 animate-pulse" />
      </div>

      <div className="space-y-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl border border-transparent bg-surface"
          >
            <div className="flex-1 flex flex-col gap-1.5">
              {/* Order number */}
              <div className="h-5 w-24 rounded bg-subtle/30 animate-pulse" />
              {/* Customer name */}
              <div className="h-3 w-32 rounded bg-subtle/30 animate-pulse" />
              {/* Created date / extra info */}
              <div className="h-2.5 w-20 rounded bg-subtle/30 animate-pulse mt-1" />
              {/* Progress bar placeholder */}
              <div className="h-1.5 w-full max-w-[120px] rounded-full bg-subtle/30 animate-pulse mt-1" />
            </div>

            {/* Carrier logo placeholder */}
            <div className="shrink-0 h-6 w-12 rounded bg-subtle/30 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
};
