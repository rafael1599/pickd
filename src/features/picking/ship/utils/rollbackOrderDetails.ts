/**
 * Helper to rollback optimistic state in persistOrderDetails when updates fail
 * (e.g. Postgres 23505 duplicate key on load_number).
 */
export interface OrderDetailsRollbackSnapshot<TOrder, TCustomerParams> {
  previousOrders: TOrder[];
  previousSelectedOrder: TOrder | null;
  previousCustomerId: string | null;
  previousCustomerParams: TCustomerParams | null;
}

export interface OrderDetailsRollbackSetters<TOrder, TCustomerParams> {
  setOrders: (orders: TOrder[]) => void;
  setSelectedOrder: (order: TOrder | null) => void;
  setSelectedCustomerId: (id: string | null) => void;
  setOriginalCustomerParams: (params: TCustomerParams | null) => void;
}

export function rollbackOrderDetailsState<TOrder, TCustomerParams>(
  snapshot: OrderDetailsRollbackSnapshot<TOrder, TCustomerParams>,
  setters: OrderDetailsRollbackSetters<TOrder, TCustomerParams>
): void {
  setters.setOrders(snapshot.previousOrders);
  setters.setSelectedOrder(snapshot.previousSelectedOrder);
  setters.setSelectedCustomerId(snapshot.previousCustomerId);
  setters.setOriginalCustomerParams(snapshot.previousCustomerParams);
}
