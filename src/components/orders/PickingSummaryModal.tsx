import React, { useMemo, useState } from 'react';
import { useScrollLock } from '../../hooks/useScrollLock';
import X from 'lucide-react/dist/esm/icons/x';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import { useLocationManagement } from '../../features/inventory/hooks/useLocationManagement';
import { usePickingNotes } from '../../features/picking/hooks/usePickingNotes';
import { getOptimizedPickingPath, calculatePallets } from '../../utils/pickingLogic';
import type { PickingListItem } from '../../schemas/picking.schema';

interface PickingSummaryModalProps {
  listId: string;
  orderNumber: string;
  customerName?: string;
  items: PickingListItem[];
  completedAt?: string;
  pickedBy?: string;
  checkedBy?: string;
  palletPhotos?: string[];
  onClose: () => void;
}

export const PickingSummaryModal: React.FC<PickingSummaryModalProps> = ({
  listId,
  orderNumber,
  customerName,
  items,
  completedAt,
  pickedBy,
  checkedBy,
  palletPhotos,
  onClose,
}) => {
  useScrollLock(true, onClose);
  const { locations } = useLocationManagement();
  const { notes } = usePickingNotes(listId);
  const [notesOpen, setNotesOpen] = useState(false);

  // Group items into pallets using the same logic as the Picking flow
  const pallets = useMemo(() => {
    if (!items || items.length === 0) return [];
    const optimizedItems = getOptimizedPickingPath(items, locations);
    return calculatePallets(optimizedItems);
  }, [items, locations]);

  const totalUnits = useMemo(() => {
    return pallets.reduce((sum, p) => sum + p.totalUnits, 0);
  }, [pallets]);

  const formatRow = (location?: string | null) => {
    if (!location) return null;
    const cleaned = location.toUpperCase().replace('ROW', '').trim();
    return cleaned || null;
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 md:p-8">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#0f0f12]/80 backdrop-blur-md cursor-pointer"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-[#0f1115]/90 backdrop-blur-3xl border border-white/10 rounded-[2rem] shadow-2xl flex flex-col overflow-hidden animate-soft-in">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 shrink-0 bg-white/[0.02]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-white text-2xl font-black tracking-tight leading-tight truncate">
                #{orderNumber}
              </h2>
              {customerName && (
                <p className="text-white/70 text-sm font-bold mt-0.5 truncate">{customerName}</p>
              )}
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2">
                {completedAt && (
                  <span className="text-white/40 text-[10px] font-bold uppercase tracking-widest">
                    {new Date(completedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                    {' · '}
                    {new Date(completedAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </span>
                )}
                {pickedBy && (
                  <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">
                    Picked by <span className="text-white/60">{pickedBy.split(' ')[0]}</span>
                  </span>
                )}
                {checkedBy && (
                  <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">
                    Checked by <span className="text-white/60">{checkedBy.split(' ')[0]}</span>
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/40 hover:text-white transition-all active:scale-90"
              title="Close"
            >
              <X size={20} />
            </button>
          </div>

          {/* Notes accordion trigger — only when notes exist */}
          {notes.length > 0 && (
            <>
              <button
                onClick={() => setNotesOpen((v) => !v)}
                className="mt-4 w-full flex items-center justify-between gap-2 px-3 py-2 bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/20 rounded-xl transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className="text-amber-400" />
                  <span className="text-[11px] font-black text-amber-400 uppercase tracking-widest">
                    {notes.length} note{notes.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <ChevronDown
                  size={14}
                  className={`text-amber-400 transition-transform ${notesOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {notesOpen && (
                <div className="mt-2 space-y-2 max-h-48 overflow-y-auto no-scrollbar">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      className="px-3 py-2 bg-amber-500/5 border border-amber-500/15 rounded-lg"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] font-bold text-amber-400/80 uppercase tracking-wider">
                          {note.user_display_name?.split(' ')[0] ?? 'Unknown'}
                        </span>
                        <span className="text-[9px] text-white/30 font-bold">
                          {new Date(note.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-[12px] text-white/80 leading-snug">{note.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Items List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 no-scrollbar scroll-smooth">
          {pallets.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mb-3">
                <X size={28} className="text-white/10" />
              </div>
              <p className="text-white/20 font-black uppercase tracking-widest text-xs">
                No picking items found for this order
              </p>
            </div>
          ) : (
            pallets.map((pallet) => (
              <div key={pallet.id} className="mb-5 last:mb-0">
                {/* Pallet header — centered */}
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-blue-400 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap">
                    Pallet {pallet.id}
                  </span>
                  <span className="text-white/20 text-[10px] font-black">·</span>
                  <span className="text-[10px] text-white/40 font-black uppercase tracking-[0.2em] whitespace-nowrap">
                    {pallet.totalUnits} unit{pallet.totalUnits !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Compact item rows */}
                <div className="space-y-1">
                  {pallet.items.map((item, idx) => {
                    const row = formatRow(item.location);
                    return (
                      <div
                        key={`${pallet.id}-${item.sku}-${idx}`}
                        className="flex items-center gap-3 px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-lg hover:bg-white/[0.07] transition-colors"
                      >
                        {/* Qty */}
                        <span
                          className={`w-6 text-center text-sm font-black tabular-nums shrink-0 ${
                            item.pickingQty > 1 ? 'text-amber-400' : 'text-white'
                          }`}
                        >
                          {item.pickingQty}
                        </span>

                        {/* SKU + name */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-white font-black text-sm tracking-tight shrink-0">
                              {item.sku}
                            </span>
                            {item.item_name && (
                              <span className="text-white/40 text-[11px] font-bold truncate">
                                {item.item_name}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Row badge */}
                        <div
                          className={`w-9 h-7 flex items-center justify-center rounded-md font-mono font-black text-sm shrink-0 ${
                            row
                              ? 'bg-amber-500/15 text-amber-400'
                              : 'bg-white/5 text-white/20'
                          }`}
                        >
                          {row ?? '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {/* Pallet Scan Photos */}
          {palletPhotos && palletPhotos.length > 0 && (
            <div className="mt-6">
              <p className="text-[10px] text-white/30 font-black uppercase tracking-widest mb-2">
                Scan Verification Photos
              </p>
              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {palletPhotos.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`Pallet scan ${i + 1}`}
                    className="w-28 h-28 object-cover rounded-xl border border-white/10 shrink-0"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-white/[0.03] border-t border-white/10 flex items-center justify-between shrink-0">
          <div className="flex gap-6">
            <div className="flex items-baseline gap-1.5">
              <span className="text-white text-base font-black leading-none">{pallets.length}</span>
              <span className="text-[9px] text-white/30 font-black uppercase tracking-[0.15em]">
                pallet{pallets.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-white text-base font-black leading-none">{totalUnits}</span>
              <span className="text-[9px] text-white/30 font-black uppercase tracking-[0.15em]">
                items
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 opacity-50">
            <div className="w-1 h-1 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-white font-bold uppercase tracking-widest italic">
              Inventory Linked
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
