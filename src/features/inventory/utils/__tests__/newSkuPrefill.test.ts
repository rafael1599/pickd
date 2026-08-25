import { describe, expect, it } from 'vitest';
import { buildNewSkuPrefill } from '../newSkuPrefill';
import { BIKE_SKU_DEFAULTS, PART_SKU_DEFAULTS } from '../../../../utils/skuDefaults';

describe('buildNewSkuPrefill', () => {
  // The AS400 description the watchdog puts on an item it could not match.
  const src = { sku: '03-4066BK', itemName: 'EXPLORER A2 15 2026 GLOSS BLAC', warehouse: 'LUDLOW' };

  it('splits a bike name into model / size / colour and fills the bike defaults', () => {
    const p = buildNewSkuPrefill(src, 'bike');
    expect(p.sku).toBe('03-4066BK');
    expect(p.item_name).toBe('EXPLORER A2 15 2026 GLOSS BLAC');
    expect(p.sku_metadata).toMatchObject({
      is_bike: true,
      model: 'EXPLORER A2',
      size: '15',
      color: 'GLOSS BLAC',
      ...BIKE_SKU_DEFAULTS,
    });
  });

  it('leaves the floor fields to the operator', () => {
    const p = buildNewSkuPrefill(src, 'bike');
    expect(p.location).toBeNull();
    expect(p.quantity).toBe(0);
  });

  it('keeps a bike name that does not split as a name only — never as a model', () => {
    const p = buildNewSkuPrefill({ sku: 'X', itemName: 'Bike example' }, 'bike');
    expect(p.item_name).toBe('Bike example');
    expect(p.sku_metadata).toMatchObject({ is_bike: true, model: null, size: null, color: null });
  });

  it('files a part with its description as the model and the part defaults', () => {
    const p = buildNewSkuPrefill(
      { sku: '86-004BK', itemName: 'JRP PIVOT 3VO PORTAL UPPER REAR TRGL LIM' },
      'part'
    );
    expect(p.sku_metadata).toMatchObject({
      is_bike: false,
      model: 'JRP PIVOT 3VO PORTAL UPPER REAR TRGL LIM',
      size: null,
      color: null,
      ...PART_SKU_DEFAULTS,
    });
  });

  it('defaults an unknown warehouse to LUDLOW and keeps ATS', () => {
    expect(buildNewSkuPrefill({ sku: 'X' }, 'part').warehouse).toBe('LUDLOW');
    expect(buildNewSkuPrefill({ sku: 'X', warehouse: 'ATS' }, 'part').warehouse).toBe('ATS');
  });

  it('tolerates a missing name', () => {
    const p = buildNewSkuPrefill({ sku: 'X', itemName: null }, 'part');
    expect(p.item_name).toBeNull();
    expect(p.sku_metadata?.model).toBeNull();
  });
});
