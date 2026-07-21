import React from 'react';
import { RowColumn, SublocationData } from './RowColumn';

// Helper to generate mock data to visualize the design
const generateMockRow = (rowName: string, count: number): SublocationData[] => {
  return Array.from({ length: count }).map((_, i) => {
    // Generate a mix of empty, partial, and full sublocations
    // Weighted to be more empty/partial for realism
    const randomStatus = i % 3 === 0 ? 'full' : i % 2 === 0 ? 'partial' : 'empty';

    // Naming them like 31-A, 31-B, etc.
    const letter = String.fromCharCode(65 + i);

    return {
      id: `${rowName}-${letter}`,
      name: `${letter}`,
      status: randomStatus,
    };
  });
};

const MOCK_WAREHOUSE_DATA = [
  { id: 'row-31', name: '31', sublocations: generateMockRow('31', 12) },
  { id: 'row-32', name: '32', sublocations: generateMockRow('32', 12) },
  { id: 'row-33', name: '33', sublocations: generateMockRow('33', 12) },
];

export const WarehouseMap: React.FC = () => {
  return (
    <div className="w-full h-full flex flex-col p-6 overflow-auto bg-white">
      {/* Header & Legend */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Warehouse Top View</h2>
          <p className="text-slate-500">Visual layout of rows 31, 32, and 33</p>
        </div>

        <div className="flex bg-gray-50 px-4 py-2 rounded-lg border border-gray-100 gap-6">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-white border-2 border-gray-200 shadow-sm" />
            <span className="text-sm font-medium text-slate-600">Empty</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-yellow-50 border-2 border-yellow-300 shadow-sm" />
            <span className="text-sm font-medium text-slate-600">Partial</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-green-50 border-2 border-green-400 shadow-sm" />
            <span className="text-sm font-medium text-slate-600">Full</span>
          </div>
        </div>
      </div>

      {/* Map Container */}
      <div className="flex-1 rounded-2xl bg-[#F8FAFC] border-2 border-dashed border-slate-200 p-8 overflow-x-auto">
        <div className="flex justify-center gap-16 md:gap-24 min-w-max mx-auto h-full items-start">
          {MOCK_WAREHOUSE_DATA.map((row) => (
            <RowColumn
              key={row.id}
              rowId={row.id}
              rowName={row.name}
              sublocations={row.sublocations}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
