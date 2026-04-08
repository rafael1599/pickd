import React, { useMemo } from 'react';
import { useScrollLock } from '../../hooks/useScrollLock';
import X from 'lucide-react/dist/esm/icons/x';
import { useLocationManagement } from '../../features/inventory/hooks/useLocationManagement';
import { getOptimizedPickingPath, calculatePallets } from '../../utils/pickingLogic';
import type { PickingListItem } from '../../schemas/picking.schema';

interface PickingSummaryModalProps {
  orderNumber: string;
  items: PickingListItem[];
  completedAt?: string;
  pickedBy?: string;
  checkedBy?: string;
  onClose: () => void;
}

export const PickingSummaryModal: React.FC<PickingSummaryModalProps> = ({
  orderNumber,
  items,
  completedAt,
  pickedBy,
  checkedBy,
  onClose,
}) => {
  useScrollLock(true, onClose);
  const { locations } = useLocationManagement();

  // Group items into pallets using the same logic as the Picking flow
  const pallets = useMemo(() => {
    if (!items || items.length === 0) return [];
    const optimizedItems = getOptimizedPickingPath(items, locations);
    return calculatePallets(optimizedItems);
  }, [items, locations]);

  const totalUnits = useMemo(() => {
    return pallets.reduce((sum, p) => sum + p.totalUnits, 0);
  }, [pallets]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
      {/* Backdrop with heavy blur */}
      <div
        className="absolute inset-0 bg-[#0f0f12]/80 backdrop-blur-md cursor-pointer"
        onClick={onClose}
      />

      {/* Modal Content - Graphite Frost Aesthetic */}
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-[#0f1115]/90 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-soft-in">
        {/* Header Section */}
        <div className="px-8 py-7 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/[0.02]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              <h3 className="text-white/30 text-[10px] font-black uppercase tracking-[0.2em]">
                Live Picking Summary
              </h3>
            </div>
            <h2 className="text-white text-3xl font-black tracking-tight leading-none">
              Order #{orderNumber}
            </h2>
            {completedAt && (
              <p className="text-white/30 text-[11px] font-bold mt-2 tracking-wide">
                {new Date(completedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {' · '}
                {new Date(completedAt).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                })}
              </p>
            )}
            {(pickedBy || checkedBy) && (
              <div className="flex items-center gap-3 mt-2">
                {pickedBy && (
                  <span className="text-[10px] font-bold text-white/25 uppercase tracking-widest">
                    Picked by <span className="text-white/50">{pickedBy.split(' ')[0]}</span>
                  </span>
                )}
                {checkedBy && (
                  <span className="text-[10px] font-bold text-white/25 uppercase tracking-widest">
                    Checked by <span className="text-white/50">{checkedBy.split(' ')[0]}</span>
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white/40 transition-all active:scale-90 group"
            title="Close"
          >
            <X size={24} className="group-hover:text-white transition-colors" />
          </button>
        </div>

        {/* List Container */}
        <div className="flex-1 overflow-y-auto p-8 no-scrollbar scroll-smooth">
          {pallets.length === 0 ? (
            <div className="py-32 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                <X size={32} className="text-white/10" />
              </div>
              <p className="text-white/20 font-black uppercase tracking-widest text-xs">
                No picking items found for this order
              </p>
            </div>
          ) : (
            pallets.map((pallet) => (
              <div key={pallet.id} className="mb-12 last:mb-0">
                {/* Pallet Separator */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="px-4 py-1.5 bg-white/5 border border-white/10 rounded-full">
                    <span className="text-blue-400 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap">
                      Pallet {pallet.id}
                    </span>
                  </div>
                  <div className="h-[1px] w-full bg-white/5" />
                  <span className="text-[10px] text-white/20 font-bold uppercase tracking-widest whitespace-nowrap">
                    {pallet.totalUnits} Units
                  </span>
                </div>

                {/* Item Grid */}
                <div className="grid gap-3">
                  {pallet.items.map((item, idx) => (
                    <div
                      key={`${pallet.id}-${item.sku}-${idx}`}
                      className="bg-white/5 border border-white/5 rounded-2xl p-5 flex items-center justify-between group hover:bg-white/[0.08] hover:border-white/10 transition-all duration-300"
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-3">
                          <span className="text-white font-black text-2xl tracking-tighter leading-none group-hover:text-blue-400 transition-colors">
                            {item.sku}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-white/40 font-bold uppercase tracking-[0.1em] bg-white/5 px-2 py-0.5 rounded">
                            Qty: {item.pickingQty}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end">
                        <span className="text-[9px] text-white/20 font-black uppercase tracking-[0.2em] mb-1">
                          Row
                        </span>
                        <div className="font-mono font-black text-3xl text-amber-500 leading-none tracking-tighter">
                          {item.location?.toUpperCase().replace('ROW', '').trim() || '-'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Static Footer with Totals */}
        <div className="px-8 py-6 bg-white/[0.03] border-t border-white/10 flex items-center justify-between shrink-0">
          <div className="flex gap-10">
            <div className="flex flex-col">
              <span className="text-[9px] text-white/25 font-black uppercase tracking-[0.2em] mb-1">
                Pallet Count
              </span>
              <span className="text-white text-xl font-black leading-none">{pallets.length}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-white/25 font-black uppercase tracking-[0.2em] mb-1">
                Total Items
              </span>
              <span className="text-white text-xl font-black leading-none">{totalUnits}</span>
            </div>
          </div>

          <div className="flex flex-col items-end opacity-40">
            <span className="text-[8px] text-white font-black uppercase tracking-widest mb-1">
              Status
            </span>
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-emerald-500" />
              <span className="text-[10px] text-white font-bold uppercase tracking-widest italic">
                Inventory Linked
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
