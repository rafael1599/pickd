import { describe, it, expect, vi } from 'vitest';
import {
  rollbackOrderDetailsState,
  type OrderDetailsRollbackSnapshot,
  type OrderDetailsRollbackSetters,
} from '../rollbackOrderDetails';

describe('bug-032: rollbackOrderDetailsState', () => {
  it('restores all four state slices (orders, selectedOrder, customerId, customerParams) on rollback', () => {
    const previousOrders = [{ id: 'order-1', load_number: 'BOL-ORIGINAL' }];
    const previousSelectedOrder = { id: 'order-1', load_number: 'BOL-ORIGINAL' };
    const previousCustomerId = 'cust-1';
    const previousCustomerParams = {
      id: 'cust-1',
      name: 'Acme Bikes',
      street: '123 Main St',
      city: 'Austin',
      state: 'TX',
      zip_code: '78701',
    };

    const snapshot: OrderDetailsRollbackSnapshot<
      typeof previousSelectedOrder,
      typeof previousCustomerParams
    > = {
      previousOrders,
      previousSelectedOrder,
      previousCustomerId,
      previousCustomerParams,
    };

    const setOrders = vi.fn();
    const setSelectedOrder = vi.fn();
    const setSelectedCustomerId = vi.fn();
    const setOriginalCustomerParams = vi.fn();

    const setters: OrderDetailsRollbackSetters<
      typeof previousSelectedOrder,
      typeof previousCustomerParams
    > = {
      setOrders,
      setSelectedOrder,
      setSelectedCustomerId,
      setOriginalCustomerParams,
    };

    rollbackOrderDetailsState(snapshot, setters);

    expect(setOrders).toHaveBeenCalledTimes(1);
    expect(setOrders).toHaveBeenCalledWith(previousOrders);

    expect(setSelectedOrder).toHaveBeenCalledTimes(1);
    expect(setSelectedOrder).toHaveBeenCalledWith(previousSelectedOrder);

    expect(setSelectedCustomerId).toHaveBeenCalledTimes(1);
    expect(setSelectedCustomerId).toHaveBeenCalledWith(previousCustomerId);

    expect(setOriginalCustomerParams).toHaveBeenCalledTimes(1);
    expect(setOriginalCustomerParams).toHaveBeenCalledWith(previousCustomerParams);
  });
});
