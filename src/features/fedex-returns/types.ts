export interface FedExReturn {
  id: string;
  tracking_number: string;
  status: 'received' | 'processing' | 'resolved';
  label_photo_url: string | null;
  notes: string | null;
  rma: string | null;
  is_misship: boolean;
  received_by: string | null;
  received_by_name: string | null;
  processed_by: string | null;
  processed_by_name: string | null;
  received_at: string;
  processed_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  items?: FedExReturnItem[];
}

export interface FedExReturnItem {
  id: string;
  return_id: string;
  sku: string;
  item_name: string | null;
  quantity: number;
  condition: 'good' | 'damaged' | 'defective' | 'unknown';
  moved_to_location: string | null;
  moved_to_warehouse: string | null;
  moved_at: string | null;
  target_location: string | null;
  target_warehouse: string | null;
  created_at: string;
}

export type ReturnStatus = FedExReturn['status'];
export type ItemCondition = FedExReturnItem['condition'];
