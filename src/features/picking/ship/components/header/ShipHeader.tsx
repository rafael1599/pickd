import React from 'react';
import { DoubleCheckHeader } from '../../../components/DoubleCheckHeader';
import { SearchInput } from '../../../../../components/ui/SearchInput';

interface ShipHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const ShipHeader: React.FC<ShipHeaderProps> = ({ searchQuery, onSearchChange }) => {
  return (
    <header className="shrink-0 ios-glass !border-none !shadow-none px-4 md:px-6 py-2.5 z-[100]">
      <div className="w-full flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-content">
            Ship
          </h1>
          <DoubleCheckHeader />
        </div>
        <div className="w-64 md:w-80 shrink-0">
          <SearchInput
            variant="inline"
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search orders or customer..."
            preferenceId="ship"
          />
        </div>
      </div>
    </header>
  );
};
