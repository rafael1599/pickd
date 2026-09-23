import { describe, expect, it } from 'vitest';
import { buildNewSkuPrefill, fieldsFromName } from '../newSkuPrefill';
import { nameAfterSave } from '../itemName';
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

  it('stores an abbreviated model with its full name in front (EC3 → EARTH CRUISER 3 EC3)', () => {
    const p = buildNewSkuPrefill({ sku: '06-4638BK', itemName: 'EC3 21 2025 GLOSS BLACK' }, 'bike');
    // The name stays the AS400's; the model is what search and the label read.
    expect(p.item_name).toBe('EC3 21 2025 GLOSS BLACK');
    expect(p.sku_metadata).toMatchObject({ model: 'EARTH CRUISER 3 EC3', size: '21' });
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

describe('buildNewSkuPrefill · canonical spelling', () => {
  it("registers the watcher's dashless spelling under the canonical SKU", () => {
    const prefill = buildNewSkuPrefill(
      { sku: '010530', itemName: null, warehouse: 'LUDLOW' },
      'part'
    );
    expect(prefill.sku).toBe('01-0530');
    expect(prefill.sku_metadata?.sku).toBe('01-0530');
  });
});

describe('buildNewSkuPrefill - new parser cases', () => {
  it('parses a bike name without a year', () => {
    const p = buildNewSkuPrefill(
      { sku: '03-1234XX', itemName: 'Citizen 2 17" Storm Grey', warehouse: 'LUDLOW' },
      'bike'
    );
    expect(p.item_name).toBe('Citizen 2 17" Storm Grey');
    expect(p.sku_metadata).toMatchObject({
      is_bike: true,
      model: 'CITIZEN 2',
      size: '17"',
      color: 'Storm Grey',
    });
  });
});

describe('fieldsFromName', () => {
  it('a bike name without a year gives its model, size and colour (bug-044)', () => {
    expect(fieldsFromName('Explorer A2 19" Gloss Black', true)).toEqual({
      model: 'EXPLORER A2',
      size: '19"',
      color: 'Gloss Black',
    });
  });

  it('a bike name that does not split gives nothing, never the whole name as model', () => {
    expect(fieldsFromName('HARDLINE C2 19 CLAY', true)).toEqual({
      model: null,
      size: null,
      color: null,
    });
  });

  it('a part is its name', () => {
    expect(fieldsFromName('POLICE REAR CARGO CARRIER RACK', false).model).toBe(
      'POLICE REAR CARGO CARRIER RACK'
    );
  });

  it('filled from the name into the baseline, a save keeps the AS400 year in the name', () => {
    // What ItemDetailView does on open: the fields it fills are also the baseline.
    const name = 'ALLEGRO A2 15 2025 GLOSS BLACK';
    const f = fieldsFromName(name, true);
    const baseline = { model: f.model ?? '', size: f.size ?? '', color: f.color ?? '' };
    expect(
      nameAfterSave({ mode: 'edit', isBike: true, ...baseline, baseline, itemName: name })
    ).toBe(name);
  });
});
