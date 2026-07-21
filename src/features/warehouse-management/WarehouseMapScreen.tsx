import React from 'react';
import { WarehouseMap } from './components/WarehouseMap/WarehouseMap';
import { useNavigate } from 'react-router-dom';

export const WarehouseMapScreen: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="h-full w-full flex flex-col bg-white">
      {/* We can add a back button or leave it to the LayoutMain */}
      <div className="border-b px-6 py-4 flex items-center bg-white shadow-sm z-10">
        <button
          onClick={() => navigate(-1)}
          className="mr-4 px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
        >
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-slate-800">Visual Layout</h1>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <WarehouseMap />
      </div>
    </div>
  );
};
