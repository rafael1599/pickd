import { describe, it, expect } from 'vitest';
import type { InventoryItemWithMetadata } from '../../../../schemas/inventory.schema';
import {
  EMPTY_FILTERS,
  applyStockFilters,
  facetCounts,
  filtersFromParams,
  itemCond,
  itemFacets,
  locationArea,
  modelLine,
  nameYear,
  scopeStockSource,
  withFacets,
  writeFiltersToParams,
  type StockFilters,
} from '../stockFacets';

function bike(
  sku: string,
  qty: number,
  location: string,
  meta: Record<string, unknown>,
  itemName = ''
): InventoryItemWithMetadata {
  return {
    id: Math.floor(Math.random() * 1e9),
    sku,
    quantity: qty,
    location,
    warehouse: 'LUDLOW',
    item_name: itemName,
    is_active: qty > 0,
    sku_metadata: { sku, is_bike: true, ...meta },
  } as unknown as InventoryItemWithMetadata;
}

const rows = withFacets([
  bike(
    '03-1',
    30,
    'ROW 22',
    { model: 'CITIZEN 2', size: '17"', color: 'GLOSS BLACK' },
    'CITIZEN 2 17 2026 GLOSS BLACK'
  ),
  bike(
    '03-2',
    10,
    'ROW 22',
    { model: 'CITIZEN 2 S/T', size: '15"', color: 'MINT' },
    'CITIZEN 2 S/T 15 2025 MINT'
  ),
  bike('03-3', 5, 'ROW 3', { model: 'CODA S2', size: '17"', color: 'MINT' }),
  bike('03-4', 1, 'CAGE 8', {
    model: 'HUDSON E1',
    size: '19"',
    color: 'DAKOTA GREY',
    is_scratch_dent: true,
    image_url: 'x',
  }),
  bike('03-5', 60, '7006N', { model: 'JUV LASER 1.6', size: '16"', color: 'RED' }),
]);

const f = (patch: Partial<StockFilters>): StockFilters => ({ ...EMPTY_FILTERS, ...patch });

describe('modelLine', () => {
  it.each([
    ['CITIZEN 2 S/T', 'CITIZEN'],
    ['TRAIL X A1', 'TRAIL'], // TRAIL X and TRAIL XR are one line
    ['KROMO L', 'KROMO'],
    ['BOSS CRUISER 7 BC7', 'BOSS CRUISER'],
    ['JUV LASER 1.6', 'LASER'],
    ['DIVIDE S/O', 'DIVIDE'],
    ['ALLEGRO A1 W', 'ALLEGRO'],
    ['HUDSON', 'HUDSON'],
    ['03-4070BK', ''],
    [null, ''],
  ])('%s → %s', (model, line) => expect(modelLine(model)).toBe(line));
});

describe('derived facets', () => {
  it('reads the model year from the name, not anything else', () => {
    expect(nameYear('Komodo 29 15 2026 Riptide')).toBe('2026');
    expect(nameYear('KOMODO 29 RIPTIDE')).toBe('');
  });

  it('maps rows to bays and staging areas', () => {
    expect(locationArea('ROW 17')).toBe('bay2');
    expect(locationArea('ROW 20B')).toBe('bay3');
    expect(locationArea('ROW 42 BURIED')).toBe('bay1');
    expect(locationArea('7006N')).toBe('containers');
    expect(locationArea('CAGE 7')).toBe('cages');
    expect(locationArea('FDX RETURNS')).toBe('fedex');
    expect(locationArea('RETURN TO STOCK')).toBe('other');
  });

  it('condition: unit_kind decides, the S/D flag covers a row read before it (idea-248)', () => {
    expect(itemCond({ unit_kind: 'photo' })).toBe('photo');
    expect(itemCond({ unit_kind: 'sd', is_scratch_dent: true })).toBe('sd');
    expect(itemCond({ is_scratch_dent: true })).toBe('sd');
    expect(itemCond({ unit_kind: 'new' })).toBe('new');
    expect(itemCond(null)).toBe('new');
  });

  it('the PH checkbox scopes the catalogue to PH bikes', () => {
    const catalog = [
      bike('02-3510BL', 1, 'PHOTO', { unit_kind: 'photo' }),
      bike('03-4229BL', 5, 'ROW 3', { unit_kind: 'new' }),
      bike('01-0357', 1, 'ROW 20', { unit_kind: 'sd', is_scratch_dent: true }),
    ];
    const scoped = scopeStockSource(catalog, {
      showInactive: false,
      onlyScratchDent: false,
      onlyPhoto: true,
    });
    expect(scoped.map((i) => i.sku)).toEqual(['02-3510BL']);
  });

  it('types: e-bike, kids, step-over; adult pedal is what is left', () => {
    expect(rows[3].facets.types).toEqual(['ebike']);
    expect(rows[4].facets.types).toEqual(['kids']);
    expect(rows[1].facets.types).toEqual(['stepover', 'adult']);
    expect(rows[0].facets.types).toEqual(['adult']);
  });
});

describe('filtering', () => {
  it('OR inside a facet, AND between facets', () => {
    const out = applyStockFilters(rows, f({ size: ['17"', '15"'], color: ['MINT'] }));
    expect(out.map((i) => i.sku)).toEqual(['03-2', '03-3']);
  });

  it('a line selects all its models; a model only itself', () => {
    expect(applyStockFilters(rows, f({ model: ['L:CITIZEN'] })).map((i) => i.sku)).toEqual([
      '03-1',
      '03-2',
    ]);
    expect(applyStockFilters(rows, f({ model: ['M:CITIZEN 2'] })).map((i) => i.sku)).toEqual([
      '03-1',
    ]);
  });

  it('an area or a single location', () => {
    expect(applyStockFilters(rows, f({ area: ['A:bay3'] })).length).toBe(2);
    expect(applyStockFilters(rows, f({ area: ['R:ROW 3'] })).map((i) => i.sku)).toEqual(['03-3']);
  });
});

describe('facetCounts (disjunctive)', () => {
  it('ticking a size keeps the other sizes counted, and narrows the colours', () => {
    const c = facetCounts(rows, f({ size: ['17"'] }));
    expect(c.size.get('15"')?.rows).toBe(1);
    expect(c.size.get('17"')?.rows).toBe(2);
    expect(c.color.get('MINT')?.rows).toBe(1); // only CODA is 17" and mint
    expect(c.color.get('RED')).toBeUndefined();
  });

  it('counts units as well as rows', () => {
    const c = facetCounts(rows, EMPTY_FILTERS);
    expect(c.model.get('L:CITIZEN')).toEqual({ rows: 2, units: 40 });
    expect(c.stock.get('51+')?.rows).toBe(1);
  });
});

describe('URL round trip', () => {
  it('keeps other params and empty values', () => {
    const p = writeFiltersToParams(
      new URLSearchParams('mode=x'),
      f({ size: ['17"'], color: [''] })
    );
    expect(p.get('mode')).toBe('x');
    const back = filtersFromParams(p);
    expect(back.size).toEqual(['17"']);
    expect(back.color).toEqual(['']);
    expect(itemFacets(rows[0].item).color).toBe('GLOSS BLACK');
  });
});
