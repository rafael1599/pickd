export interface AddressConflictOption {
  addressId: string;
  street: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  orderNumbers: string[];
}

export interface LoadNumberConflictOption {
  loadNumber: string;
  orderNumbers: string[];
}

export interface CombineConflictAnalysis {
  hasConflict: boolean;
  hasAddressConflict: boolean;
  hasLoadNumberConflict: boolean;
  addressOptions: AddressConflictOption[];
  loadOptions: LoadNumberConflictOption[];
  defaultAddressId: string | null;
  defaultLoadNumber: string | null;
}

export interface ConflictCheckOrder {
  order_number: string | null;
  ship_to_address_id?: string | null;
  load_number?: string | null;
  shipment?: {
    ship_to_address_id?: string | null;
    load_number?: string | null;
  } | null;
  ship_to?: {
    id: string;
    street: string;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
  } | null;
  customer?: {
    name?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
  } | null;
}

/**
 * Pure evaluator to detect conflicts between orders being merged into a single shipment.
 * Evaluates whether orders differ in destination address or load number.
 */
export function detectCombineConflicts(orders: ConflictCheckOrder[]): CombineConflictAnalysis {
  // Address aggregation
  const addressMap = new Map<string, AddressConflictOption>();

  for (const order of orders) {
    const orderNum = order.order_number || 'N/A';
    const addressId = order.shipment?.ship_to_address_id ?? order.ship_to_address_id;
    if (addressId) {
      const existing = addressMap.get(addressId);
      if (existing) {
        if (!existing.orderNumbers.includes(orderNum)) {
          existing.orderNumbers.push(orderNum);
        }
      } else {
        const street = order.ship_to?.street ?? order.customer?.street ?? 'Registered address';
        const city = order.ship_to?.city ?? order.customer?.city ?? null;
        const state = order.ship_to?.state ?? order.customer?.state ?? null;
        const zip = order.ship_to?.zip_code ?? order.customer?.zip_code ?? null;
        addressMap.set(addressId, {
          addressId,
          street,
          city,
          state,
          zip,
          orderNumbers: [orderNum],
        });
      }
    }
  }

  const addressOptions = Array.from(addressMap.values());
  const hasAddressConflict = addressOptions.length > 1;

  // Load number aggregation
  const loadMap = new Map<string, LoadNumberConflictOption>();

  for (const order of orders) {
    const orderNum = order.order_number || 'N/A';
    const rawLoad = (order.shipment?.load_number ?? order.load_number)?.trim();
    if (rawLoad) {
      const existing = loadMap.get(rawLoad);
      if (existing) {
        if (!existing.orderNumbers.includes(orderNum)) {
          existing.orderNumbers.push(orderNum);
        }
      } else {
        loadMap.set(rawLoad, {
          loadNumber: rawLoad,
          orderNumbers: [orderNum],
        });
      }
    }
  }

  const loadOptions = Array.from(loadMap.values());
  const hasLoadNumberConflict = loadOptions.length > 1;

  return {
    hasConflict: hasAddressConflict || hasLoadNumberConflict,
    hasAddressConflict,
    hasLoadNumberConflict,
    addressOptions,
    loadOptions,
    defaultAddressId: addressOptions[0]?.addressId ?? null,
    defaultLoadNumber: loadOptions[0]?.loadNumber ?? null,
  };
}
