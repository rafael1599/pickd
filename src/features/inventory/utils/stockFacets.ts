/**
 * Stock filters, the way Amazon and eBay do them: facets with a count next to
 * every option, OR inside a facet, AND between facets.
 *
 * The counts are **disjunctive**: the number beside an option is how many rows
 * you would see if you ticked it, given everything ticked in the *other*
 * facets. So ticking `17"` never makes the other sizes read 0 — you can still
 * add `19"` — while the colours shrink to the ones that come in those sizes.
 *
 * Everything here is pure and runs on the rows the screen already holds (the
 * whole bike catalogue is ~700 active rows), so filtering is instant and works
 * offline. Nothing is written anywhere: a filter is a way of looking.
 */
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import { isElectricBikeItem } from '../../../utils/electricBikes';

export const FACET_IDS = [
  'model',
  'size',
  'color',
  'year',
  'area',
  'type',
  'cond',
  'photo',
  'stock',
] as const;
export type FacetId = (typeof FACET_IDS)[number];

/** One list of selected values per facet; an empty list means "any". */
export type StockFilters = Record<FacetId, string[]>;

export const EMPTY_FILTERS: StockFilters = {
  model: [],
  size: [],
  color: [],
  year: [],
  area: [],
  type: [],
  cond: [],
  photo: [],
  stock: [],
};

/**
 * Two facets are trees — a model line holds its models, an area holds its
 * locations — and both levels live in the same list, told apart by prefix:
 * `L:CITIZEN` (every Citizen) vs `M:CITIZEN 2` (just that one).
 */
export const LINE = 'L:';
export const MODEL = 'M:';
export const AREA = 'A:';
export const LOC = 'R:';

/** What a row is, along every facet. Derived once per row. */
export interface ItemFacets {
  /** `CITIZEN` for `CITIZEN 2 S/T`; '' when the row has no usable model. */
  line: string;
  model: string;
  size: string;
  color: string;
  year: string;
  area: AreaId;
  location: string;
  types: TypeId[];
  cond: 'new' | 'sd';
  photo: 'with' | 'without';
  stock: StockBucket;
}

export type AreaId = 'bay2' | 'bay3' | 'bay1' | 'containers' | 'cages' | 'fedex' | 'other';
export type TypeId = 'ebike' | 'kids' | 'stepover' | 'adult';
export type StockBucket = '1' | '2-10' | '11-50' | '51+';

export const AREA_ORDER: AreaId[] = [
  'bay2',
  'bay3',
  'bay1',
  'containers',
  'cages',
  'fedex',
  'other',
];
export const AREA_LABEL: Record<AreaId, string> = {
  bay2: 'Bay 2 · ROW 1–17',
  bay3: 'Bay 3 · ROW 18–40',
  bay1: 'Bay 1 · ROW 41+',
  containers: 'Containers',
  cages: 'Cages & S/D',
  fedex: 'FedEx & Rebox',
  other: 'Floor & staging',
};

export const TYPE_ORDER: TypeId[] = ['adult', 'ebike', 'kids', 'stepover'];
export const TYPE_LABEL: Record<TypeId, string> = {
  adult: 'Adult pedal',
  ebike: 'E-bike',
  kids: 'Kids',
  stepover: 'Step-over / Step-thru',
};

export const COND_LABEL: Record<ItemFacets['cond'], string> = { new: 'New', sd: 'Scratch & Dent' };
export const PHOTO_LABEL: Record<ItemFacets['photo'], string> = {
  with: 'With photo',
  without: 'Needs photo',
};
export const STOCK_ORDER: StockBucket[] = ['1', '2-10', '11-50', '51+'];
export const STOCK_LABEL: Record<StockBucket, string> = {
  '1': '1 unit',
  '2-10': '2 – 10',
  '11-50': '11 – 50',
  '51+': '51 +',
};

const SKU_SHAPED = /^\d{2}-\d{3,}/;

/**
 * The line is the model's name before its designation: everything up to the
 * first token that carries a digit (`A2`, `29`, `E1`), a slash (`S/O`) or is a
 * lone letter (`W`, `L`). `JUV` is an age flag, not a name, so it is skipped.
 * `TRAIL X A1` → `TRAIL`, `BOSS CRUISER 7 BC7` → `BOSS CRUISER`.
 */
export function modelLine(model: string | null | undefined): string {
  const clean = normalizeModel(model);
  if (!clean) return '';
  const tokens = clean.split(' ');
  if (tokens[0] === 'JUV' && tokens.length > 1) tokens.shift();
  const out: string[] = [];
  for (const t of tokens) {
    if (out.length > 0 && (/\d/.test(t) || t.includes('/') || t.length === 1)) break;
    out.push(t);
  }
  return out.join(' ');
}

function normalizeModel(model: string | null | undefined): string {
  const clean = (model ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  // A model that is a SKU (`03-4070BK`) is a registration slip, not a name.
  if (!clean || SKU_SHAPED.test(clean)) return '';
  return clean;
}

/** The model year printed in the name (`… 17 2026 RIPTIDE`), not the arrival year. */
export function nameYear(itemName: string | null | undefined): string {
  const m = (itemName ?? '').match(/(?:^|\s)((?:19[89]|20[0-4])\d)(?=\s|$)/);
  return m ? m[1] : '';
}

export function locationArea(location: string | null | undefined): AreaId {
  const loc = (location ?? '').trim().toUpperCase();
  const row = loc.match(/^ROW (\d+)/);
  if (row) {
    const n = Number(row[1]);
    if (n <= 17) return 'bay2';
    if (n <= 40) return 'bay3';
    return 'bay1';
  }
  if (/^\d{4}N$/.test(loc)) return 'containers';
  if (loc.startsWith('CAGE') || loc === 'SD') return 'cages';
  if (loc.startsWith('FDX') || loc === 'REBOX') return 'fedex';
  return 'other';
}

export function stockBucket(qty: number): StockBucket {
  if (qty <= 1) return '1';
  if (qty <= 10) return '2-10';
  if (qty <= 50) return '11-50';
  return '51+';
}

export function itemFacets(item: InventoryItemWithMetadata): ItemFacets {
  const meta = item.sku_metadata;
  const model = normalizeModel(meta?.model);
  const name = item.item_name ?? '';
  const haystack = `${model} ${name}`.toUpperCase();
  const types: TypeId[] = [];
  if (isElectricBikeItem({ sku: item.sku, item_name: `${model} ${name}`, isBike: true })) {
    types.push('ebike');
  }
  if (/(^|\s)JUV(\s|$)/.test(haystack)) types.push('kids');
  if (/(^|\s)S\/[OT](\s|$)|STEP[- ]?(OVER|THRU|THROUGH)/.test(haystack)) types.push('stepover');
  if (!types.includes('ebike') && !types.includes('kids')) types.push('adult');
  return {
    line: modelLine(model),
    model,
    size: (meta?.size ?? '').trim(),
    color: (meta?.color ?? '').trim().toUpperCase(),
    year: nameYear(name),
    area: locationArea(item.location),
    location: (item.location ?? '').trim().toUpperCase(),
    types,
    cond: meta?.is_scratch_dent ? 'sd' : 'new',
    photo: meta?.image_url ? 'with' : 'without',
    stock: stockBucket(item.quantity ?? 0),
  };
}

function matchesFacet(f: ItemFacets, id: FacetId, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  switch (id) {
    case 'model':
      return selected.includes(LINE + f.line) || selected.includes(MODEL + f.model);
    case 'area':
      return selected.includes(AREA + f.area) || selected.includes(LOC + f.location);
    case 'type':
      return f.types.some((t) => selected.includes(t));
    default:
      return selected.includes(f[id]);
  }
}

function matchesAll(f: ItemFacets, filters: StockFilters, except?: FacetId): boolean {
  for (const id of FACET_IDS) {
    if (id !== except && !matchesFacet(f, id, filters[id])) return false;
  }
  return true;
}

export function activeFilterCount(filters: StockFilters): number {
  return FACET_IDS.reduce((n, id) => n + filters[id].length, 0);
}

/** Rows paired with their facets, so filtering and counting derive them once. */
export interface FacetedRow {
  item: InventoryItemWithMetadata;
  facets: ItemFacets;
}

export function withFacets(items: readonly InventoryItemWithMetadata[]): FacetedRow[] {
  return items.map((item) => ({ item, facets: itemFacets(item) }));
}

export function applyStockFilters(
  rows: readonly FacetedRow[],
  filters: StockFilters
): InventoryItemWithMetadata[] {
  if (activeFilterCount(filters) === 0) return rows.map((r) => r.item);
  return rows.filter((r) => matchesAll(r.facets, filters)).map((r) => r.item);
}

export interface OptionCount {
  /** Rows (cards) the option would show. */
  rows: number;
  units: number;
}
export type FacetCounts = Record<FacetId, Map<string, OptionCount>>;

function bump(map: Map<string, OptionCount>, key: string, units: number) {
  const c = map.get(key);
  if (c) {
    c.rows += 1;
    c.units += units;
  } else map.set(key, { rows: 1, units });
}

/** Disjunctive counts: each facet is tallied over rows that pass every *other* facet. */
export function facetCounts(rows: readonly FacetedRow[], filters: StockFilters): FacetCounts {
  const out = Object.fromEntries(FACET_IDS.map((id) => [id, new Map()])) as FacetCounts;
  for (const { item, facets: f } of rows) {
    const units = item.quantity ?? 0;
    for (const id of FACET_IDS) {
      if (!matchesAll(f, filters, id)) continue;
      const map = out[id];
      switch (id) {
        case 'model':
          bump(map, LINE + f.line, units);
          if (f.model) bump(map, MODEL + f.model, units);
          break;
        case 'area':
          bump(map, AREA + f.area, units);
          bump(map, LOC + f.location, units);
          break;
        case 'type':
          for (const t of f.types) bump(map, t, units);
          break;
        default:
          bump(map, f[id], units);
      }
    }
  }
  return out;
}

// ── Display helpers ──────────────────────────────────────────────────────

/** Stored in CAPITALS; painted in Title Case (CLAUDE.md, «Un color, una grafía»). */
export function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

export type SizeGroup = 'in' | 'cm' | 'other';

export function sizeGroup(size: string): SizeGroup {
  if (/^\d+(\.\d+)?"$/.test(size)) return 'in';
  if (/^\d+(\.\d+)?cm$/.test(size)) return 'cm';
  return 'other';
}

export function compareSizes(a: string, b: string): number {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1;
  return a.localeCompare(b);
}

/**
 * A swatch for a JAMIS colour name. The names are marketing (`RIPTIDE`,
 * `MASH`), so this only reads the plain words in them; anything it can't
 * place gets a neutral dot — the label, not the dot, is the identity.
 */
const SWATCH_WORDS: [RegExp, string][] = [
  [/BLACK|COAL|ONYX|SHADOW/, '#111827'],
  [/WHITE|PEARL WHITE|IVORY|VANILLA|MILK/, '#f3f4f6'],
  [/SILVER|NICKEL|PALLADIUM|CHROME|ANO/, '#cbd5e1'],
  [/GREY|GRAY|GRAPHITE|CHARCOAL|SLATE|FLINT|SMOKE|STORM|RHINO|PRIMER/, '#6b7280'],
  [/NAVY|MIDNIGHT|INK|DEEP BLUE/, '#1e3a8a'],
  [/TEAL|LAGOON|CERULEAN|RIPTIDE|AQUA|TURQ/, '#0d9488'],
  [/BLUE|COBALT|SKY|COSMO|GALAXY/, '#2563eb'],
  [/MINT|KIWI|LIME/, '#86efac'],
  [/GREEN|PINE|MOSS|OLIVE|DRAB|SAGE/, '#15803d'],
  [/RED|CAYENNE|GARNET|OXBLOOD|POMODORO|CHERRY|RASPBERRY/, '#dc2626'],
  [/PINK|ROSE|BERRY/, '#ec4899'],
  [/PURPLE|GRAPE|PLUM|VIOLET/, '#7c3aed'],
  [/ORANGE|COPPER|AMBER|RUST/, '#ea580c'],
  [/YELLOW|GOLD|SUN/, '#eab308'],
  [/BROWN|CHOCOLATE|ROOT BEER|COFFEE|CLAY|SANDSTONE|PUTTY|TAN|SAND/, '#a16207'],
];

export function colorSwatch(color: string): string | null {
  const c = color.toUpperCase();
  for (const [re, hex] of SWATCH_WORDS) if (re.test(c)) return hex;
  return null;
}

// ── URL ──────────────────────────────────────────────────────────────────

/** The filters live in the URL (`?size=17"&color=MINT`), so a view can be shared and survives reload. */
export function filtersFromParams(params: URLSearchParams): StockFilters {
  const out = { ...EMPTY_FILTERS };
  // An empty value is real: `color=` is "No color", the catalogue gap to fill.
  for (const id of FACET_IDS) out[id] = params.getAll(id);
  return out;
}

export function writeFiltersToParams(
  params: URLSearchParams,
  filters: StockFilters
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const id of FACET_IDS) {
    next.delete(id);
    for (const v of filters[id]) next.append(id, v);
  }
  return next;
}

/** The text on an active-filter chip. */
export function chipLabel(id: FacetId, value: string): string {
  switch (id) {
    case 'model':
      if (value === LINE) return 'No model';
      return titleCase(value.slice(2)) + (value.startsWith(LINE) ? ' (all)' : '');
    case 'area':
      return value.startsWith(AREA) ? AREA_LABEL[value.slice(2) as AreaId] : value.slice(2);
    case 'color':
      return value ? titleCase(value) : 'No color';
    case 'size':
      return value || 'No size';
    case 'year':
      return value || 'No year';
    case 'type':
      return TYPE_LABEL[value as TypeId] ?? value;
    case 'cond':
      return COND_LABEL[value as ItemFacets['cond']] ?? value;
    case 'photo':
      return PHOTO_LABEL[value as ItemFacets['photo']] ?? value;
    case 'stock':
      return `Qty ${STOCK_LABEL[value as StockBucket] ?? value}`;
  }
}

/**
 * The rows the facets work on when no text search is open: the whole bike
 * catalogue, narrowed the way the S/D and "Deleted & Qty 0" toggles already
 * narrow the list, so a filter never shows what the toggles hide.
 */
export function scopeStockSource(
  catalog: readonly InventoryItemWithMetadata[],
  { showInactive, onlyScratchDent }: { showInactive: boolean; onlyScratchDent: boolean }
): InventoryItemWithMetadata[] {
  return catalog.filter(
    (i) =>
      (showInactive || (i.is_active && (i.quantity ?? 0) > 0)) &&
      (!onlyScratchDent || i.sku_metadata?.is_scratch_dent === true)
  );
}
