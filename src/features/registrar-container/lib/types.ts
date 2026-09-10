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

/**
 * One container of the file: the lines under one PO marker.
 *
 * The shipment schedule lists every load on the water in one sheet, one
 * section per PO ('7005N · EVER BIRTH · TXGU5768052', then its lines). The PO
 * is also the location the stock lands in -- the warehouse calls a load by its
 * PO -- so it is never typed. Until 10 Sep 2026 the screen took a whole sheet
 * as one container, and six containers meant cutting the file into six by hand
 * (Rafael: more than 30 minutes, split + download + register, for one file).
 */
export interface ParsedContainer {
  /** '7005N'. Null only when the file names no PO -- the one case a name is typed. */
  po: string | null;
  /** Where it was read: 'NJ Breakdown', 'FL Breakdown', or the PDF's file name. */
  sheet: string;
  vessel: string | null;
  /** What is painted on the box. Two when one PO filled two boxes (the Direct sheet's 6433FL). */
  containerIds: string[];
  items: ParsedLine[];
  total: number;
}

/**
 * A container PickD already has: its location has received stock before.
 * `units` is what people put there (the intake); `stock` what is there now,
 * which reaches 0 once the load is moved to the rows.
 */
export interface ContainerIntake {
  location: string;
  /** The first ADD into it; null when the stock is there but no ADD says how. */
  firstAt: string | null;
  units: number;
  stock: number;
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

/** A container of the file, read against PickD. */
export interface AnalyzedContainer {
  key: string;
  container: ParsedContainer;
  /** Set when PickD already has it: shown, never registered again. */
  intake: ContainerIntake | null;
  /** What it would register. Empty when PickD already has it. */
  resolved: ResolvedItem[];
}

/** One container of a batch, on its way to register_container. */
export interface RegisterBatchItem {
  location: string;
  /** The PO the location is named after; null when the name was typed. */
  po: string | null;
  items: ContainerInputItem[];
  /** Its canonical SKUs -- the only ones whose type this call may write. */
  skus: string[];
}

/** One container of a batch, as it came back: registered, or why not. */
export type RegisterOutcome =
  | { location: string; ok: true; summary: RegisterSummary }
  | { location: string; ok: false; error: string };
