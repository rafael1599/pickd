import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Play from 'lucide-react/dist/esm/icons/play';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Package from 'lucide-react/dist/esm/icons/package';
import {
  useFedExReturn,
  useUpdateFedExReturn,
  useRemoveReturnItem,
  useResolveReturn,
  useFedExReturnsRealtime,
} from './hooks/useFedExReturns';
import { ReturnItemRow } from './components/ReturnItemRow';
import { AddItemSheet } from './components/AddItemSheet';

export const FedExReturnDetailScreen: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  useFedExReturnsRealtime();

  const [addOpen, setAddOpen] = useState(false);
  const [targetLocations, setTargetLocations] = useState<Record<string, string>>({});

  const { data: ret, isLoading } = useFedExReturn(id ?? '');
  const updateReturn = useUpdateFedExReturn();
  const removeItem = useRemoveReturnItem();
  const resolveReturn = useResolveReturn();

  const items = useMemo(() => ret?.items ?? [], [ret]);
  const pendingItems = useMemo(() => items.filter((i) => !i.moved_to_location), [items]);
  const allLocationsSet = pendingItems.every((i) => targetLocations[i.id]?.trim());

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
          target_location: targetLocations[i.id].trim().toUpperCase(),
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

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4">
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

        {/* Start Processing */}
        {ret.status === 'received' && (
          <button
            onClick={handleStartProcessing}
            disabled={updateReturn.isPending}
            className="w-full bg-accent text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {updateReturn.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            Start Processing
          </button>
        )}

        {/* Items */}
        {(ret.status === 'processing' || ret.status === 'resolved') && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">
                Contents ({items.length})
              </h2>
              {ret.status === 'processing' && (
                <button
                  onClick={() => setAddOpen(true)}
                  className="flex items-center gap-1 text-xs text-accent font-bold"
                >
                  <Plus size={12} />
                  Add Item
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="text-center text-muted py-8 text-sm border border-dashed border-subtle rounded-2xl">
                No items yet
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="space-y-2">
                    <ReturnItemRow
                      item={item}
                      onRemove={
                        ret.status === 'processing' && !item.moved_to_location
                          ? () => removeItem.mutate(item.id)
                          : undefined
                      }
                    />
                    {ret.status === 'processing' && !item.moved_to_location && (
                      <input
                        type="text"
                        placeholder="Destination location (e.g., ROW 15)"
                        value={targetLocations[item.id] ?? ''}
                        onChange={(e) =>
                          setTargetLocations({
                            ...targetLocations,
                            [item.id]: e.target.value,
                          })
                        }
                        className="w-full bg-surface border border-subtle rounded-xl px-3 py-1.5 text-xs text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent ml-2"
                      />
                    )}
                  </div>
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

      <AddItemSheet returnId={ret.id} open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
};
