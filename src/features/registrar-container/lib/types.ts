// Types for the Registrar Container feature.

/** A single line parsed from a shipment-breakdown sheet. */
export interface ParsedLine {
  po: string | null;
  sku: string;
  qty: number;
  itemName: string;
}

/** A worksheet that matched the breakdown layout. */
export interface ParsedSheet {
  name: string;
  items: ParsedLine[];
  total: number;
}

/** Item shape sent to the resolve/register RPCs. */
export interface ContainerInputItem {
  sku: string;
  qty: number;
  item_name: string;
}

export interface ExistingLocation {
  sku: string;
  location: string | null;
  sublocation: string[] | null;
  qty: number;
}

/** One row returned by resolve_container_skus. */
export interface ResolvedItem {
  canonical_sku: string;
  qty: number;
  item_name: string | null;
  merged_from: string[];
  is_new: boolean;
  is_bike: boolean;
  existing_qty: number;
  existing_locations: ExistingLocation[];
}

export interface RegisterSummary {
  location: string;
  warehouse: string;
  skus: number;
  units: number;
  new_skus: string[];
}
