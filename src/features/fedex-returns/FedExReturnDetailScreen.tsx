import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Play from 'lucide-react/dist/esm/icons/play';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Package from 'lucide-react/dist/esm/icons/package';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import { printReturnLabel } from './utils/generateReturnLabel';
import {
  useFedExReturn,
  useUpdateFedExReturn,
  useRemoveReturnItem,
  useUpdateReturnItem,
  useResolveReturn,
  useDisposeReturn,
  useFedExReturnsRealtime,
} from './hooks/useFedExReturns';
import { ReturnItemRow } from './components/ReturnItemRow';
import { ReturnToStockSheet } from './components/ReturnToStockSheet';
import { SDQuickIntakeModal } from '../scratch-and-dent/components/SDQuickIntakeModal';

export const FedExReturnDetailScreen: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  useFedExReturnsRealtime();

  const [addOpen, setAddOpen] = useState(false);
  const [sdIntakeOpen, setSdIntakeOpen] = useState(false);
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposeReason, setDisposeReason] = useState('');

  const { data: ret, isLoading } = useFedExReturn(id ?? '');
  const updateReturn = useUpdateFedExReturn();
  const removeItem = useRemoveReturnItem();
  const updateItem = useUpdateReturnItem();
  const resolveReturn = useResolveReturn();
  const disposeReturn = useDisposeReturn();

  const items = useMemo(() => ret?.items ?? [], [ret]);
  const pendingItems = useMemo(() => items.filter((i) => !i.moved_to_location), [items]);
  const allLocationsSet = pendingItems.every((i) => !!i.target_location?.trim());

  const handleStartProcessing = async () => {
    if (!ret) return;
    try {
      await updateReturn.mutateAsync({ id: ret.id, status: 'processing' });
      toast.success('Processing started');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start processing';
      toast.error(message);
    }
  };

  const handleResolve = async () => {
    if (!ret) return;
    if (pendingItems.length === 0) {
      toast.error('Add at least one item before resolving');
      return;
    }
    if (!allLocationsSet) {
      toast.error('Set a destination location for every item');
      return;
    }

    try {
      await resolveReturn.mutateAsync({
        returnId: ret.id,
        items: pendingItems.map((i) => ({
          id: i.id,
          sku: i.sku,
          quantity: i.quantity,
          target_location: (i.target_location ?? '').trim().toUpperCase(),
          target_warehouse: i.target_warehouse ?? 'LUDLOW',
        })),
      });
      toast.success('Return resolved');
      navigate('/fedex-returns');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resolve return';
      toast.error(message);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-main flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    );
  }

  if (!ret) {
    return (
      <div className="min-h-screen bg-main flex flex-col items-center justify-center text-muted gap-2">
        <Package size={32} />
        <p className="text-sm">Return not found</p>
        <button onClick={() => navigate('/fedex-returns')} className="text-accent text-sm mt-2">
          Back to queue
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-main text-content">
      <header className="sticky top-0 z-10 bg-main/95 backdrop-blur-sm border-b border-subtle px-4 py-3">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <button
            onClick={() => navigate('/fedex-returns')}
            className="p-1.5 text-muted hover:text-content"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold truncate">{ret.tracking_number}</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 pb-24 space-y-4">
        {/* Label photo */}
        {ret.label_photo_url && (
          <img
            src={ret.label_photo_url}
            alt="Return label"
            className="w-full max-h-64 object-contain bg-surface rounded-2xl border border-subtle"
          />
        )}

        {/* Meta */}
        <div className="bg-card border border-subtle rounded-2xl p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Status</span>
            <span className="font-bold capitalize">{ret.status}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Received by</span>
            <span>{ret.received_by_name ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Received</span>
            <span>{ret.received_at ? new Date(ret.received_at).toLocaleString() : '—'}</span>
          </div>
          {ret.notes && (
            <div className="pt-2 border-t border-subtle mt-2">
              <div className="text-muted text-xs uppercase tracking-widest mb-1">Notes</div>
              <div className="text-content">{ret.notes}</div>
            </div>
          )}
        </div>

        {/* Actions: Start Processing + Print Label */}
        <div className="flex gap-2">
          {ret.status === 'received' && (
            <button
              onClick={handleStartProcessing}
              disabled={updateReturn.isPending}
              className="flex-1 bg-accent text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {updateReturn.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              Start Processing
            </button>
          )}
          <button
            onClick={async () => {
              try {
                await printReturnLabel({
                  trackingNumber: ret.tracking_number,
                  receivedAt: ret.received_at,
                  receivedByName: ret.received_by_name,
                  notes: ret.notes,
                  rma: ret.rma,
                });
              } catch (err) {
                const message = err instanceof Error ? err.message : 'Print failed';
                toast.error(message);
              }
            }}
            className={`${
              ret.status === 'received' ? 'flex-shrink-0 px-4' : 'flex-1'
            } bg-surface border border-subtle text-content rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 hover:border-accent/40 transition-colors`}
            title="Print labels (2 per sheet)"
          >
            <Printer size={16} />
            Print Label
          </button>
        </div>

        {/* Items */}
        {(ret.status === 'processing' || ret.status === 'resolved') && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">
                Contents ({items.length})
              </h2>
              {ret.status === 'processing' && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSdIntakeOpen(true)}
                    className="flex items-center gap-1 text-xs text-amber-400 font-bold"
                  >
                    <Plus size={12} />
                    Register S/D
                  </button>
                  <button
                    onClick={() => setAddOpen(true)}
                    className="flex items-center gap-1 text-xs text-accent font-bold"
                  >
                    <Plus size={12} />
                    Return to Stock
                  </button>
                  <button
                    onClick={() => setDisposeOpen(true)}
                    disabled={disposeReturn.isPending}
                    className="flex items-center gap-1 text-xs text-red-400 font-bold disabled:opacity-50"
                    title="Dispose this return — drains placeholder stock and marks resolved"
                  >
                    <Trash2 size={12} />
                    Dispose
                  </button>
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className="text-center text-muted py-8 text-sm border border-dashed border-subtle rounded-2xl">
                No items yet
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <ReturnItemRow
                    key={item.id}
                    item={item}
                    onRemove={
                      ret.status === 'processing' && !item.moved_to_location
                        ? () => removeItem.mutate(item.id)
                        : undefined
                    }
                    onChangeLocation={
                      ret.status === 'processing' && !item.moved_to_location
                        ? (loc) =>
                            updateItem.mutate({
                              itemId: item.id,
                              target_location: loc,
                            })
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Resolve */}
        {ret.status === 'processing' && pendingItems.length > 0 && (
          <button
            onClick={handleResolve}
            disabled={resolveReturn.isPending || !allLocationsSet}
            className="w-full bg-emerald-500 text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {resolveReturn.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            Resolve Return ({pendingItems.length} {pendingItems.length === 1 ? 'item' : 'items'})
          </button>
        )}
      </main>

      <ReturnToStockSheet returnId={ret.id} open={addOpen} onClose={() => setAddOpen(false)} />
      <SDQuickIntakeModal open={sdIntakeOpen} onClose={() => setSdIntakeOpen(false)} />

      {disposeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => !disposeReturn.isPending && setDisposeOpen(false)}
        >
          <div
            className="bg-card border border-red-500/30 rounded-2xl w-full max-w-md p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2">
              <Trash2 size={18} className="text-red-400" />
              <h2 className="text-base font-bold text-content">Dispose this return?</h2>
            </div>
            <p className="text-[12px] text-muted leading-snug mb-3">
              This drains all pending FDX placeholder stock to 0, marks every pending item as
              <span className="text-red-300 font-bold"> DISPOSED</span>, and closes the return as
              resolved. No items will land in inventory. This action is final.
            </p>
            <textarea
              value={disposeReason}
              onChange={(e) => setDisposeReason(e.target.value)}
              rows={2}
              placeholder="Reason (optional) — e.g. damaged on arrival"
              className="w-full bg-surface border border-subtle rounded-xl px-3 py-2 text-sm text-content placeholder:text-muted/50 focus:outline-none focus:border-red-400 resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setDisposeOpen(false)}
                disabled={disposeReturn.isPending}
                className="px-4 py-2 rounded-xl text-[12px] font-bold text-muted hover:text-content"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    const result = await disposeReturn.mutateAsync({
                      returnId: ret.id,
                      reason: disposeReason.trim() || null,
                    });
                    toast.success(
                      `Disposed ${result.disposed_items} item${result.disposed_items === 1 ? '' : 's'}`
                    );
                    setDisposeOpen(false);
                    setDisposeReason('');
                    navigate('/fedex-returns');
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Failed to dispose';
                    toast.error(msg);
                  }
                }}
                disabled={disposeReturn.isPending}
                className="px-4 py-2 rounded-xl text-[12px] font-bold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 flex items-center gap-2"
              >
                {disposeReturn.isPending && <Loader2 size={14} className="animate-spin" />}
                Dispose Return
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
