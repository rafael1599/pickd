/**
 * Stock search: which field a term is looked up in, and the SKU dash.
 *
 * Rafael, 2 oct 2026: «por defecto se busque por sku, pero cuando se detecte
 * que se están escribiendo letras se cambie a la búsqueda por nombre, modelo,
 * row… si es sku que se ponga automáticamente el guion, con un seleccionable».
 *
 * `auto` reads the term: SKU-shaped (`DD-NNNN[CCC]` while being typed) goes to
 * the SKU column only; anything else — letters, a 7+ digit UPC — searches every
 * column, as the search always did. The other modes pin one field. The field
 * names are the `p_field` values of `search_inventory_with_metadata`.
 */

export type StockSearchField = 'all' | 'sku' | 'name' | 'location' | 'serial';
export type StockSearchMode = 'auto' | Exclude<StockSearchField, 'all'>;

export const STOCK_SEARCH_MODES: ReadonlyArray<{
  mode: StockSearchMode;
  label: string;
  hint: string;
}> = [
  { mode: 'auto', label: 'Auto', hint: 'Numbers → SKU · letters → everything' },
  { mode: 'sku', label: 'SKU', hint: '03-4710BL' },
  { mode: 'name', label: 'Name', hint: 'Name, model, condition' },
  { mode: 'location', label: 'Location', hint: 'ROW 12, PALLETIZED…' },
  { mode: 'serial', label: 'Serial', hint: 'Serial, UPC, FedEx tracking' },
];

/**
 * SKU prefixes offered as chips under the Stock search while it is empty.
 * Rafael, 7 oct 2026: «debajo quiero que se vea los prefijos para elegir sin
 * ponerlos manualmente (03-, 06-, 07)».
 */
export const STOCK_SKU_PREFIXES = ['03-', '06-', '07-'] as const;

/** Short tag shown on the selector for the field a search resolves to. */
export const STOCK_SEARCH_FIELD_TAG: Record<StockSearchField, string> = {
  all: 'ANY',
  sku: 'SKU',
  name: 'NAME',
  location: 'LOC',
  serial: 'SERIAL',
};

/** A canonical SKU at any point of being typed: `0`, `03`, `03-47`, `034710BL`. */
const SKU_IN_PROGRESS = /^\d{1,2}$|^\d{2}-?\d{0,4}[A-Z]{0,3}$/i;

export function looksLikeSku(term: string): boolean {
  return SKU_IN_PROGRESS.test(term.trim());
}

export function resolveSearchField(term: string, mode: StockSearchMode): StockSearchField {
  if (mode !== 'auto') return mode;
  const t = term.trim();
  if (t === '' || looksLikeSku(t)) return 'sku';
  return 'all';
}

/**
 * Formats what was just typed. Only adds the dash when the text grew (typing or
 * pasting), so backspacing over `03-` leaves `03` instead of fighting back.
 * In `auto`, a run of digits too long for a SKU loses the dash again: it's a
 * UPC or a serial (the server ignores dashes for those anyway).
 */
export function formatStockSearchInput(prev: string, next: string, mode: StockSearchMode): string {
  if (mode !== 'auto' && mode !== 'sku') return next;

  if (mode === 'auto' && /^\d{2}-\d{5,}$/.test(next)) return next.replace('-', '');

  if (next.length <= prev.length) return next;

  const dashed = next.replace(/^(\d{2})(\d)/, '$1-$2');
  if (mode === 'sku') return dashed.toUpperCase();
  return looksLikeSku(dashed) ? dashed.toUpperCase() : next;
}
