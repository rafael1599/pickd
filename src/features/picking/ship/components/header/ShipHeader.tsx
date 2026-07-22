import React from 'react';
import { DoubleCheckHeader } from '../../../components/DoubleCheckHeader';
import { SearchInput } from '../../../../../components/ui/SearchInput';

interface ShipHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const ShipHeader: React.FC<ShipHeaderProps> = ({ searchQuery, onSearchChange }) => {
  return (
    <header className="shrink-0 ios-glass !border-none !shadow-none px-4 md:px-6 py-4 z-[100]">
      <div className="w-full flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-black uppercase tracking-tight text-content">Ship</h1>
          <DoubleCheckHeader />
        </div>
        <SearchInput
          variant="inline"
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search orders or customer..."
          preferenceId="ship"
        />
      </div>
    </header>
  );
};
