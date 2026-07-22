import React from 'react';

export const ShipHeader: React.FC = () => {
  return (
    <header className="shrink-0 ios-glass !border-none !shadow-none px-4 md:px-6 py-2.5 z-[100]">
      <div className="w-full flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-content">
            Ship
          </h1>
        </div>
      </div>
    </header>
  );
};
