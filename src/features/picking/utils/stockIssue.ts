/**
 * Stock issue diagnosis for one order line — the "what exactly did you find"
 * behind a LOW STOCK / UNREG badge.
 *
 * Double Check used to show the badge and wait for someone to open Edit Order,
 * where the auto-swap and the suggestions lived. The picker read LOW STOCK on a
 * bike that was on the shelf under its other name and had no idea which of
 * five different situations they were looking at. This turns the live facts
 * the view already loads (inventory rows, reservations, the variant family, a
 * similar SKU) into ONE named case with the sentence to show and the actions
 * that make sense for it. Pure, so every case is a test.
 *
 * Cases, most actionable first:
 *   auto_swap        the same bike under another catalog name covers the line
 *                    → swapped without asking (same rule Edit Order applied)
 *   unregistered     no catalog row at all → register, replace or remove
 *   no_stock         registered, 0 units anywhere → replace or remove
 *   reserved         units on the shelf, but other open orders already hold
 *                    them → replace or remove
 *   partial          some available, not enough → take what there is, replace
 *                    or remove
 *   ok               live stock covers the line; the badge is stale
 */

import { isVariantSibling } from '../../../utils/skuNormalize';
import { pickVariantSiblingRow, type StockRow } from './stockSubstitute';
import type { PickingOrderMap } from './pickLocation';

export interface IssueRow {
  location: string | null;
  warehouse: string;
  quantity: number;
}

export interface SimilarSuggestion {
  sku: string;
  location: string | null;
  quantity: number;
  item_name: string | null;
}

export interface StockIssueInput {
  sku: string;
  pickingQty: number;
  warehouse: string;
  /** A catalog row exists for this exact SKU (the DB-derived flag, inverted). */
  registered: boolean;
  /** Inventory rows for this exact SKU, any warehouse, any quantity. */
  rows: IssueRow[];
  /** Units of this SKU in this warehouse held by OTHER open orders. */
  reservedElsewhere: number;
  reservingOrders?: string[];
  /** Live rows for the variant family (may include the SKU itself). */
  siblingRows?: StockRow[];
  similar?: SimilarSuggestion | null;
  pickingOrder?: PickingOrderMap;
}

interface IssueBase {
  sku: string;
  need: number;
  /** One line, plain English, the picker can act on. */
  headline: string;
  /** Second line with the evidence, when there is more to say. */
  detail: string | null;
  /** A sibling that has some stock but not enough — offered as "use X for n". */
  sibling: StockRow | null;
  similar: SimilarSuggestion | null;
}

export type StockIssue =
  | { kind: 'ok'; sku: string }
  | (IssueBase & { kind: 'auto_swap'; to: StockRow })
  | (IssueBase & { kind: 'unregistered' })
  | (IssueBase & { kind: 'no_stock' })
  | (IssueBase & { kind: 'reserved'; onShelf: number; reserved: number; orders: string[] })
  | (IssueBase & { kind: 'partial'; available: number; onShelf: number; reserved: number });

function whereList(rows: IssueRow[]): string {
  return rows
    .filter((r) => (r.quantity ?? 0) > 0)
    .sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))
    .map((r) => `${r.location ?? '?'} (${r.quantity})`)
    .join(', ');
}

function siblingLine(row: StockRow | null, need: number): string | null {
  if (!row) return null;
  return `Same bike under ${row.sku}: ${row.quantity} in ${row.location ?? '?'}${
    row.quantity < need ? ` (need ${need})` : ''
  }`;
}

function similarLine(s: SimilarSuggestion | null): string | null {
  if (!s) return null;
  return `Closest match with stock: ${s.sku} · ${s.quantity} in ${s.location ?? '?'}`;
}

export function diagnoseStockIssue(input: StockIssueInput): StockIssue {
  const need = Math.max(1, Math.trunc(Number(input.pickingQty) || 0));
  const warehouse = input.warehouse || 'LUDLOW';
  const here = input.rows.filter((r) => r.warehouse === warehouse);
  const onShelf = here.reduce((s, r) => s + Math.max(0, r.quantity ?? 0), 0);
  const reserved = Math.max(0, Math.trunc(Number(input.reservedElsewhere) || 0));
  const available = onShelf - reserved;

  if (input.registered && available >= need) return { kind: 'ok', sku: input.sku };

  // The variant family: the same bike under another catalog name. Only rows
  // that are siblings (never the SKU itself) are candidates.
  const siblingRows = (input.siblingRows ?? []).filter((r) => isVariantSibling(input.sku, r.sku));
  const best =
    siblingRows.length > 0
      ? pickVariantSiblingRow(siblingRows, input.sku, warehouse, input.pickingOrder, need)
      : null;
  const similar = input.similar ?? null;

  const base = (headline: string, detail: string | null): IssueBase => ({
    sku: input.sku,
    need,
    headline,
    detail,
    sibling: best,
    similar,
  });

  if (best && best.quantity >= need) {
    return {
      ...base(`Same bike under ${best.sku}: ${best.quantity} in ${best.location ?? '?'}`, null),
      kind: 'auto_swap',
      to: best,
    };
  }

  const hint = siblingLine(best, need) ?? similarLine(similar);

  if (!input.registered) {
    return { ...base('Not in PickD — this SKU has no catalog entry', hint), kind: 'unregistered' };
  }

  if (onShelf === 0) {
    return {
      ...base('Registered, but 0 units in any location', hint),
      kind: 'no_stock',
    };
  }

  const where = whereList(here);
  const orders = (input.reservingOrders ?? []).filter(Boolean);

  if (available <= 0) {
    const by = orders.length > 0 ? ` by ${orders.join(', ')}` : ' by other open orders';
    return {
      ...base(
        `${onShelf} on the shelf — ${where} — but ${reserved} already reserved${by}`,
        hint ?? 'None left for this order'
      ),
      kind: 'reserved',
      onShelf,
      reserved,
      orders,
    };
  }

  const reservedNote =
    reserved > 0
      ? `${reserved} of the ${onShelf} reserved${orders.length > 0 ? ` by ${orders.join(', ')}` : ''}`
      : null;
  return {
    ...base(`Only ${available} available of ${need} — ${where}`, hint ?? reservedNote),
    kind: 'partial',
    available,
    onShelf,
    reserved,
  };
}
