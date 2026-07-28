import React, { useState } from 'react';
import { WarehouseMap } from './components/WarehouseMap/WarehouseMap';
import { WarehouseLiveMap } from './components/WarehouseMap/WarehouseLiveMap';
import { NoMoverClassification } from './components/NoMoverClassification';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, ListChecks } from 'lucide-react';

export const WarehouseMapScreen: React.FC = () => {
  const navigate = useNavigate();
  // No-movers comes first: the plan cannot be calculated without the list.
  const [activeTab, setActiveTab] = useState<'no-movers' | 'plan' | 'live'>('no-movers');

  return (
    <div className="h-full w-full flex flex-col bg-white">
      {/* Top Header Bar */}
      <div className="border-b px-6 py-3 flex items-center justify-between bg-white shadow-sm z-10 print:hidden">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
          >
            &larr; Back
          </button>
          <h1 className="text-xl font-bold text-slate-800">Visual Layout</h1>
        </div>

        {/* No-movers → Plan → Live. The order is the workflow. */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            onClick={() => setActiveTab('no-movers')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-extrabold uppercase tracking-wider transition-all ${
              activeTab === 'no-movers'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ListChecks className="w-3.5 h-3.5 text-slate-600" />
            <span>No-movers</span>
          </button>

          <button
            onClick={() => setActiveTab('plan')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-extrabold uppercase tracking-wider transition-all ${
              activeTab === 'plan'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5 text-slate-600" />
            <span>Plan</span>
          </button>

          <button
            onClick={() => setActiveTab('live')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-extrabold uppercase tracking-wider transition-all ${
              activeTab === 'live'
                ? 'bg-white text-emerald-700 shadow-sm border border-emerald-200/60'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span>Live</span>
          </button>
        </div>
      </div>

      {/* Screen Body */}
      <div className="flex-1 overflow-hidden print:overflow-visible relative">
        {activeTab === 'no-movers' ? (
          <NoMoverClassification />
        ) : activeTab === 'plan' ? (
          <WarehouseMap />
        ) : (
          <WarehouseLiveMap />
        )}
      </div>
    </div>
  );
};
