import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import {
  bikeSetsFrom,
  buildCartSkuMeta,
  cartSkusKey,
  type CatalogRow,
} from '../cartSkuMeta.service';

const row = (over: Partial<CatalogRow> & { sku: string }): CatalogRow => ({
  weight_lbs: null,
  is_bike: null,
  length_in: null,
  width_in: null,
  height_in: null,
  dimensions_verified: null,
  dimensions_measured_at: null,
  model: null,
  size: null,
  category: null,
  as400_description: null,
  is_scratch_dent: null,
  serial_number: null,
  ...over,
});

describe('buildCartSkuMeta', () => {
  it('encuentra la fila por sus candidatos (034664BR → 03-4664BR)', () => {
    const meta = buildCartSkuMeta(
      ['034664BR'],
      [row({ sku: '03-4664BR', is_bike: true, weight_lbs: 44 })]
    );
    expect(meta['034664BR']).toMatchObject({
      catalog_sku: '03-4664BR',
      is_bike: true,
      weight_lbs: 44,
    });
  });

  it('sin ficha decide por el prefijo (01-0015 de #881293 es bici)', () => {
    expect(buildCartSkuMeta(['01-0015'], [])['01-0015']).toMatchObject({
      catalog_sku: null,
      is_bike: true,
    });
  });

  it('el catálogo manda sobre el prefijo', () => {
    expect(
      buildCartSkuMeta(['03-9999'], [row({ sku: '03-9999', is_bike: false })])['03-9999'].is_bike
    ).toBe(false);
  });

  it('de niño sólo si es bici', () => {
    const meta = buildCartSkuMeta(
      ['07-3741RD', '99-0001'],
      [
        row({ sku: '07-3741RD', is_bike: true, model: 'JUV LASER 1.6' }),
        row({ sku: '99-0001', is_bike: false, model: 'JUV LASER 1.6' }),
      ]
    );
    expect(meta['07-3741RD'].is_small_bike).toBe(true);
    expect(meta['99-0001'].is_small_bike).toBe(false);
  });
});

describe('bikeSetsFrom y cartSkusKey', () => {
  it('arma los dos conjuntos', () => {
    const sets = bikeSetsFrom(
      buildCartSkuMeta(
        ['03-1', '07-3741RD', '99-0001'],
        [
          row({ sku: '07-3741RD', is_bike: true, model: 'JUV LASER 1.6' }),
          row({ sku: '99-0001', is_bike: false }),
        ]
      )
    );
    expect([...sets.bikes].sort()).toEqual(['03-1', '07-3741RD']);
    expect([...sets.smallBikes]).toEqual(['07-3741RD']);
  });

  it('la clave no depende del orden ni de repetidos', () => {
    expect(cartSkusKey(['b', 'a', 'b', null, ''])).toBe('a,b');
  });
});
