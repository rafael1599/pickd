/**
 * Shared type definitions for the Ship feature.
 *
 * Extracted from ShipScreen.tsx so that child components, hooks, and
 * containers can import types without circular dependencies.
 */
import type { PickingListItem, CombineMeta } from '../../../schemas/picking.schema';

export interface CustomerDetails {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip_code: string;
}

export interface OrderWithRelations {
  id: string;
  order_number: string | null;
  user_id: string | null;
  customer_id: string | null;
  pallets_qty: number | null;
  total_units: number | null;
  load_number: string | null;
  transport_company: string | null;
  status: string;
  items: PickingListItem[] | null;
  correction_notes: string | null;
  notes: string | null;
  checked_by: string | null;
  combine_meta: CombineMeta;
  created_at: string;
  updated_at: string;
  customer: CustomerDetails | null;
  customer_details: CustomerDetails | Record<string, never>;
  user: { full_name: string | null } | null;
  checker: { full_name: string | null } | null;
  presence: { last_seen_at: string | null } | null;
  pallet_photos: string[] | null;
  group_id: string | null;
  order_group: { group_type: string | null } | null;
  is_waiting_inventory?: boolean | null;
  is_shipped?: boolean | null;
  verified_item_keys?: string[] | null;
}

export interface DayGroup {
  key: string;
  label: string;
  orders: OrderWithRelations[];
}

export interface OrderFormData {
  customerName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  pallets: string;
  units: string;
  loadNumber: string;
  transportCompany: string;
  bikes: string;
  parts: string;
  weight: string;
}

/** Status of the auto-save operation for the inline indicator. */
export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
