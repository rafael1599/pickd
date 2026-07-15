import React from 'react';
import { ShipOrderSkeleton } from '../../features/picking/ship/components/ShipOrderSkeleton';
import { ShipOrderListSkeleton } from '../../features/picking/ship/components/ShipOrderListSkeleton';

export const ShipScreenFallback: React.FC = () => {
  return (
    <div className="relative flex flex-col h-screen w-full overflow-hidden bg-bg-main font-body">
      {/* Header Skeleton */}
      <header className="shrink-0 ios-glass !border-none !shadow-none px-4 md:px-6 py-4 z-[100]">
        <div className="w-full flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-black uppercase tracking-tight text-content">Ship</h1>
            <div className="flex items-center gap-3">
              {/* Double Check Header Placeholder */}
              <div className="h-8 w-24 rounded-lg bg-subtle/30 animate-pulse" />
              {/* FedEx toggle Placeholder */}
              <div className="h-6 w-16 rounded-lg bg-subtle/30 animate-pulse" />
            </div>
          </div>
          {/* Search bar placeholder */}
          <div className="h-12 w-full rounded-2xl bg-surface animate-pulse" />
        </div>
      </header>

      {/* Main split view skeleton */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column */}
        <div className="w-[60%] border-r border-subtle h-full overflow-y-auto no-scrollbar relative flex flex-col items-center">
          <div className="w-full max-w-2xl px-6 py-6 pb-24 mx-auto flex flex-col gap-6 relative">
            <ShipOrderSkeleton />
          </div>
        </div>

        {/* Right Column */}
        <div className="w-[40%] flex flex-col h-full bg-surface/30">
          <div className="shrink-0 px-3 md:px-4 py-3 pb-2 flex flex-col gap-2">
            {/* Tabs placeholder */}
            <div className="flex bg-card p-1 rounded-xl h-10 w-full animate-pulse" />
            <div className="h-3 w-16 bg-subtle/30 rounded mt-2 animate-pulse" />
            <div className="h-3 w-12 bg-subtle/30 rounded mt-1 animate-pulse" />
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar p-3">
            <ShipOrderListSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
};
