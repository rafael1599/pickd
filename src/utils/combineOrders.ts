import { mergeSiblingPalletPhotos } from './mergeSiblingPalletPhotos';

export interface BaseOrderInput {
  id: string;
  order_number?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  status?: string | null;
  items?: unknown;
  total_units?: number | null;
  pallets_qty?: number | null;
  load_number?: string | null;
  transport_company?: string | null;
  total_weight_lbs?: number | null;
  pallet_photos?: string[] | null;
  pallet_dims?: unknown;
  ship_to_address_id?: string | null;
  is_shipped?: boolean | null;
  is_waiting_inventory?: boolean | null;
  shipment_id?: string | null;
  shipment?: {
    id?: string;
    pallets_qty?: number | null;
    load_number?: string | null;
    transport_company?: string | null;
    total_weight_lbs?: number | null;
    pallet_photos?: string[] | null;
    pallet_dims?: unknown;
    ship_to_address_id?: string | null;
    is_shipped?: boolean | null;
  } | null;
}

export interface TaggedOrderItem {
  sku: string;
  source_order: string;
  source_list_id: string;
  pickingQty?: number;
  qty?: number;
  location?: string | null;
  [key: string]: unknown;
}

export interface CombinedOrdersCoreResult<T extends BaseOrderInput> {
  sorted: T[];
  anchor: T;
  orderNumbers: string[];
  combinedOrderNumber: string;
  combinedItems: TaggedOrderItem[];
  combinedTotalUnits: number;
  unitsByOrder: Record<string, number>;
  combinedPalletsQty: number;
  combinedLoadNumber: string | null;
  combinedTransportCompany: string | null;
  combinedTotalWeightLbs: number;
  combinedPalletPhotos: string[];
  combinedIsShipped: boolean;
  combinedPalletDims: unknown;
  combinedShipToAddressId: string | null;
  oldestCreatedAt: string;
  newestCreatedAt: string;
  newestUpdatedAt: string;
  anchorShipment: T['shipment'];
}

export function getItemQty(item: unknown): number {
  if (!item || typeof item !== 'object') return 0;
  const obj = item as Record<string, unknown>;
  const val = obj.pickingQty ?? obj.qty ?? obj.quantity;
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num : 0;
}

function toISOStringSafe(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

/**
 * Core engine for merging sibling orders across ShipScreen, Live Board,
 * and PublicOrderView.
 *
 * Enforces:
 * 1. Deterministic anchor: oldest order by `created_at ASC`.
 * 2. Formatted combined order numbers (descending numeric, joined by ' / ').
 * 3. Physical shipping facts prioritized from `anchor.shipment`.
 * 4. Summed `total_units` from live tagged items.
 * 5. Items tagged with `source_order` and `source_list_id`.
 */
export function combineOrdersCore<T extends BaseOrderInput>(
  orders: readonly T[]
): CombinedOrdersCoreResult<T> {
  if (orders.length === 0) {
    throw new Error('Cannot combine empty order list');
  }

  const sorted = [...orders].sort((a, b) => {
    const dateA = toISOStringSafe(a.created_at);
    const dateB = toISOStringSafe(b.created_at);
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const numA = String(a.order_number || a.id || '');
    const numB = String(b.order_number || b.id || '');
    return numA.localeCompare(numB, undefined, { numeric: true });
  });
  const anchor = sorted[0];

  const orderNumbers = sorted
    .map((s) => s.order_number || (s.id ? s.id.slice(-6).toUpperCase() : ''))
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const combinedOrderNumber = orderNumbers.join(' / ');

  const combinedItems: TaggedOrderItem[] = sorted.flatMap((s) => {
    const rawItems = Array.isArray(s.items) ? s.items : [];
    return rawItems.map((item) => {
      const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const sku = typeof obj.sku === 'string' ? obj.sku : '';
      const source_order =
        typeof obj.source_order === 'string' && obj.source_order
          ? obj.source_order
          : (s.order_number ?? 'unknown');
      const source_list_id =
        typeof obj.source_list_id === 'string' && obj.source_list_id ? obj.source_list_id : s.id;
      return {
        ...obj,
        sku,
        source_order,
        source_list_id,
      } as TaggedOrderItem;
    });
  });

  const combinedTotalUnits =
    combinedItems.length > 0
      ? combinedItems.reduce((sum, item) => sum + getItemQty(item), 0)
      : sorted.reduce((sum, s) => sum + (s.total_units ?? 0), 0);

  const unitsByOrder: Record<string, number> = {};
  for (const item of combinedItems) {
    if (item.source_order) {
      unitsByOrder[item.source_order] = (unitsByOrder[item.source_order] ?? 0) + getItemQty(item);
    }
  }

  const anchorShipment = anchor.shipment;
  const combinedPalletsQty =
    anchorShipment?.pallets_qty ??
    sorted.reduce((sum, s) => sum + (s.shipment?.pallets_qty ?? s.pallets_qty ?? 0), 0);
  const combinedLoadNumber = anchorShipment?.load_number ?? anchor.load_number ?? null;
  const combinedTransportCompany =
    anchorShipment?.transport_company ?? anchor.transport_company ?? null;
  const combinedTotalWeightLbs =
    anchorShipment?.total_weight_lbs ??
    sorted.reduce(
      (sum, s) =>
        sum +
        (s.shipment?.total_weight_lbs ??
          (s as { total_weight_lbs?: number | null }).total_weight_lbs ??
          0),
      0
    );
  const combinedPalletPhotos =
    anchorShipment?.pallet_photos ??
    mergeSiblingPalletPhotos(
      sorted.map((s) => ({ id: s.id, pallet_photos: s.pallet_photos ?? [] }))
    ).photos;
  const combinedIsShipped =
    anchorShipment?.is_shipped ?? sorted.every((s) => Boolean(s.is_shipped));
  const combinedPalletDims = anchorShipment?.pallet_dims ?? anchor.pallet_dims ?? null;
  const combinedShipToAddressId =
    anchorShipment?.ship_to_address_id ?? anchor.ship_to_address_id ?? null;

  const oldestCreatedAt = anchor.created_at ?? '';
  const newestCreatedAt = sorted.reduce(
    (max, s) => ((s.created_at ?? '') > max ? (s.created_at ?? '') : max),
    anchor.created_at ?? ''
  );
  const newestUpdatedAt = sorted.reduce(
    (max, s) => ((s.updated_at ?? '') > max ? (s.updated_at ?? '') : max),
    anchor.updated_at ?? anchor.created_at ?? ''
  );

  return {
    sorted,
    anchor,
    orderNumbers,
    combinedOrderNumber,
    combinedItems,
    combinedTotalUnits,
    unitsByOrder,
    combinedPalletsQty,
    combinedLoadNumber,
    combinedTransportCompany,
    combinedTotalWeightLbs,
    combinedPalletPhotos,
    combinedIsShipped,
    combinedPalletDims,
    combinedShipToAddressId,
    oldestCreatedAt,
    newestCreatedAt,
    newestUpdatedAt,
    anchorShipment,
  };
}
