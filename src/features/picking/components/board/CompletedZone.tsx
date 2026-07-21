import React from 'react';
import type { PickingList } from '../../hooks/useDoubleCheckList';
import { StaticOrderCard } from './SortableOrderCard';
import { mergeGroupOrders } from './mergeGroupOrders';

interface CompletedZoneProps {
  fedexOrders: PickingList[];
  regularOrders: PickingList[];
  onSelectOrder: (orderId: string) => void;
  onMerge?: (order: PickingList) => void;
  onUngroup?: (order: PickingList) => void;
  onDelete?: (order: PickingList) => void;
  /** Prefix the time with the date ("Jul 9 · 3:51 PM") — used when the list
   *  spans previous days (empty-board fallback). */
  showDate?: boolean;
  /** Returns a same-customer, unshipped, not-already-grouped-together
   *  sibling to suggest combining with — combining stays manual/suggested,
   *  never automatic. */
  findCombineSuggestion?: (order: PickingList) => PickingList | null;
  onCombineSuggestionAccept?: (order: PickingList, candidate: PickingList) => void;
}

export const CompletedZone: React.FC<CompletedZoneProps> = ({
  fedexOrders,
  regularOrders,
  onSelectOrder,
  onMerge,
  onUngroup,
  onDelete,
  showDate = false,
  findCombineSuggestion,
  onCombineSuggestionAccept,
}) => {
  if (fedexOrders.length === 0 && regularOrders.length === 0) return null;

  const handleSelect = (order: PickingList) => onSelectOrder(order.id);

  // PICK UP orders get their own red stripe, regardless of how their
  // content would otherwise auto-classify (fedex/regular) — a PICK UP order
  // is picked up in person, it's neither a FedEx parcel nor a truck pallet.
  const effectiveShippingType = (
    order: PickingList,
    fallback: 'fedex' | 'regular'
  ): 'fedex' | 'regular' | 'pickup' =>
    order.transport_company === 'PICK UP' ? 'pickup' : fallback;

  const renderOrderButton = (order: PickingList, shippingType: 'fedex' | 'regular') => {
    const suggestion = findCombineSuggestion?.(order) ?? null;
    return (
      <div key={order.id} className="space-y-1">
        <StaticOrderCard
          order={order}
          shippingType={effectiveShippingType(order, shippingType)}
          showShippingBadge={true}
          showDate={showDate}
          onSelect={handleSelect}
          onMerge={onMerge}
          onUngroup={onUngroup}
          onDelete={onDelete}
        />
        {suggestion && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCombineSuggestionAccept?.(order, suggestion);
            }}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-accent/40 bg-accent/5 text-accent hover:bg-accent/10 transition-colors text-[10px] font-black uppercase tracking-wider"
          >
            Combine with #{suggestion.order_number}?
          </button>
        )}
      </div>
    );
  };

  // Regular/general combines are real single shipments (same customer) —
  // group by group_id and collapse into one standard card, same as Ship.
  // FedEx orders decouple the moment they individually complete: even a
  // fully-completed FedEx auto-group renders as separate solo cards here —
  // the grouping was only ever a workspace convenience for the active lane.
  const renderRegularLane = (laneOrders: PickingList[]) => {
    const grouped = new Map<string, PickingList[]>();
    const ungrouped: PickingList[] = [];
    for (const order of laneOrders) {
      if (order.group_id) {
        const arr = grouped.get(order.group_id) || [];
        arr.push(order);
        grouped.set(order.group_id, arr);
      } else {
        ungrouped.push(order);
      }
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Array.from(grouped.entries()).map(([groupId, groupOrders]) => {
          const merged = mergeGroupOrders(groupOrders);
          return (
            <StaticOrderCard
              key={groupId}
              order={merged}
              shippingType={effectiveShippingType(merged, 'regular')}
              showShippingBadge={true}
              showDate={showDate}
              onSelect={handleSelect}
              onMerge={onMerge}
              onUngroup={onUngroup}
              onDelete={onDelete}
            />
          );
        })}
        {ungrouped.map((order) => renderOrderButton(order, 'regular'))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Regular Completed Orders Row */}
      <div className="space-y-2">
        {regularOrders.length > 0 ? renderRegularLane(regularOrders) : null}
      </div>

      {/* FedEx Completed Orders Row — flat, no grouping (see comment above) */}
      <div className="space-y-2">
        {fedexOrders.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {fedexOrders.map((order) => renderOrderButton(order, 'fedex'))}
          </div>
        ) : null}
      </div>

      {/* Empty state */}
      {regularOrders.length === 0 && fedexOrders.length === 0 && (
        <div className="text-center text-xs text-muted/40 italic py-4 bg-subtle/20 border border-dashed border-subtle rounded-2xl">
          No completed orders
        </div>
      )}
    </div>
  );
};
