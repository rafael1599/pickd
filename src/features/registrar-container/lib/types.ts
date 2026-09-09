// Types for the Registrar Container feature.

/** A single line parsed from a shipment-breakdown sheet. */
export interface ParsedLine {
  po: string | null;
  sku: string;
  qty: number;
  itemName: string;
  /**
   * The catalog line as the sheet already writes it, in three columns.
   *
   * The JAMIS breakdown keeps Model, Size and Colour apart (F/G/H) and this
   * carries them apart: joining them into `itemName` and asking the database to
   * take them back out is guesswork over a split that was never lost. `null`
   * where the sheet leaves the cell empty -- a bike with one frame size has no
   * size, and saying so is not the same as forgetting to ask.
   */
  model: string | null;
  size: string | null;
  color: string | null;
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
  model?: string | null;
  size?: string | null;
  color?: string | null;
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
  model: string | null;
  size: string | null;
  color: string | null;
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
