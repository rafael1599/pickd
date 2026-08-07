import React, { useState } from 'react';
import { DsPalletPlanView } from './components/WarehouseMap/DsPalletPlanView';
import { WarehouseLiveMap } from './components/WarehouseMap/WarehouseLiveMap';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';

export const WarehouseMapScreen: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'plan' | 'live'>('plan');

  return (
    <div className="h-full w-full flex flex-col bg-white">
      {/* Top Header Bar. It wraps: the layout clips its overflow rather than
          scrolling it, so a tab pushed past the right edge is unreachable. */}
      <div className="border-b px-6 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-white shadow-sm z-10 print:hidden">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
          >
            &larr; Back
          </button>
          <h1 className="text-xl font-bold text-slate-800">Visual Layout</h1>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 shrink-0">
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
        {activeTab === 'plan' ? (
          <DsPalletPlanView onGoToNoMovers={() => {}} />
        ) : (
          <WarehouseLiveMap />
        )}
      </div>
    </div>
  );
};
