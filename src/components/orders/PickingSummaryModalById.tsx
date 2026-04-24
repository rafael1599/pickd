import React from 'react';
import { useQuery } from '@tanstack/react-query';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { PickingSummaryModal } from './PickingSummaryModal';
import type { PickingListItem } from '../../schemas/picking.schema';

interface Props {
  listId: string;
  onClose: () => void;
}

interface OrderRow {
  id: string;
  order_number: string | null;
  items: PickingListItem[] | null;
  updated_at: string | null;
  pallet_photos: string[] | null;
  status: string | null;
  customer: { name: string | null } | null;
  user: { full_name: string | null } | null;
  checker: { full_name: string | null } | null;
}

/**
 * Self-contained wrapper around PickingSummaryModal that fetches the order
 * by id so consumers can open the summary from anywhere via the Modal Manager
 * (see `docs/modal-pattern.md`). Used by HistoryScreen, InventoryScreen ghost
 * trail, and ActivityReport low-stock completions — all previously coupled
 * via `setExternalOrderId + navigate('/orders')`.
 */
export const PickingSummaryModalById: React.FC<Props> = ({ listId, onClose }) => {
  const { data, isLoading, isError } = useQuery<OrderRow | null>({
    queryKey: ['picking-summary', listId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('picking_lists')
        .select(
          'id, order_number, items, updated_at, pallet_photos, status, customer:customers(name), user:profiles!user_id(full_name), checker:profiles!checked_by(full_name)'
        )
        .eq('id', listId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as OrderRow | null;
    },
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (isError) {
      toast.error('Could not load order details');
      onClose();
    }
  }, [isError, onClose]);

  if (isLoading || !data) {
    // Lightweight placeholder so the user sees immediate feedback. Keeps the
    // modal overlay active without rendering the full picking summary until
    // the order is loaded.
    return (
      <div
        className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-2 text-muted text-sm">
          <Loader2 className="animate-spin" size={16} />
          Loading order…
        </div>
      </div>
    );
  }

  return (
    <PickingSummaryModal
      listId={data.id}
      orderNumber={data.order_number || ''}
      customerName={data.customer?.name ?? undefined}
      items={data.items ?? []}
      completedAt={data.updated_at ?? undefined}
      pickedBy={data.user?.full_name ?? undefined}
      checkedBy={data.checker?.full_name ?? undefined}
      palletPhotos={data.pallet_photos ?? undefined}
      status={data.status ?? undefined}
      onClose={onClose}
    />
  );
};
