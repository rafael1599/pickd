import { describe, expect, it } from 'vitest';
import {
  buildRegisterWrite,
  emptyIdentity,
  fillFromCatalogue,
  identityFromDraft,
  identityFromPrefill,
  readiness,
  settle,
  squaresForRow,
  unitsBySquare,
} from '../registerItem';
import type { SkuLabelDraft, DraftField } from '../labelToSkuDraft';
import type { InventoryItemWithMetadata } from '../../../../schemas/inventory.schema';

const found = <T>(value: T): DraftField<T> => ({ value, status: 'found', source: 'ocr' });
const none = <T>(): DraftField<T> => ({ value: null, status: 'missing', source: null });

/** The RENEGADE C2 of the study (V1): size read two ways, no serial. */
const renegade: SkuLabelDraft = {
  sku: found('03-4710BL'),
  isBike: found(true),
  model: found('RENEGADE C2'),
  size: { value: '54cm', status: 'uncertain', source: 'ocr', options: ['54cm', '56cm'] },
  color: found('ADOBE CLAY'),
  serial: none(),
  upc: found('741039201543'),
  gtin: none(),
  weightLbs: found(37.9),
  missingFields: ['serial'],
  uncertainFields: ['size'],
};

describe('identityFromDraft', () => {
  it('paints read fields green, the ambiguous one amber with its options, the absent one red', () => {
    const id = identityFromDraft(renegade);
    expect(id.fields.sku).toEqual({ value: '03-4710BL', status: 'read' });
    expect(id.fields.size).toEqual({ value: '', status: 'choose', options: ['54cm', '56cm'] });
    expect(id.fields.serial.status).toBe('missing');
    expect(id.isBike).toBe(true);
    expect(id.labelWeightLbs).toBe(37.9);
  });

  it('never offers the reader’s conflict note as a value, nor a caption as a serial', () => {
    const id = identityFromDraft({
      ...renegade,
      sku: {
        value: 'CONFLICTO: 03-3988TL ≠ 03-3989GY',
        status: 'uncertain',
        source: 'ocr',
        options: ['CONFLICTO: 03-3988TL ≠ 03-3989GY', '03-3988TL', '03-3989GY'],
      },
      serial: found('BICYCLING'),
    });
    expect(id.fields.sku).toEqual({
      value: '',
      status: 'choose',
      options: ['03-3988TL', '03-3989GY'],
    });
    expect(id.fields.serial.status).toBe('missing');
  });

  it('takes the type only when the label was sure of it', () => {
    const id = identityFromDraft({
      ...renegade,
      isBike: { value: true, status: 'uncertain', source: 'ocr', options: [true, false] },
    });
    expect(id.isBike).toBeNull();
  });

  it('keeps what the caller already knew over the OCR', () => {
    const base = identityFromPrefill({
      sku: '03-4710BR',
      sku_metadata: { sku: '03-4710BR', is_bike: true },
    } as unknown as InventoryItemWithMetadata);
    expect(identityFromDraft(renegade, base).fields.sku).toEqual({
      value: '03-4710BR',
      status: 'given',
    });
  });
});

describe('identityFromPrefill', () => {
  it('asks the type of a SKU that arrives without a catalogue row', () => {
    const id = identityFromPrefill({ sku: '03-0288' } as unknown as InventoryItemWithMetadata);
    expect(id.isBike).toBeNull();
    expect(id.fields.sku.status).toBe('given');
  });
});

describe('readiness', () => {
  const answered = settle(identityFromDraft(renegade), 'size', '54cm');

  it('blocks on an amber field until it is chosen (V1)', () => {
    const r = readiness({ identity: identityFromDraft(renegade), location: 'ROW 24', quantity: 1 });
    expect(r.what).toBe(false);
    expect(r.blocker).toBe('Size');
  });

  it('blocks until somebody says bike or part', () => {
    const id = { ...answered, isBike: null };
    expect(readiness({ identity: id, location: 'ROW 24', quantity: 1 }).blocker).toBe(
      'Bike or part'
    );
  });

  it('needs where and how many, and allows a placeholder of 0', () => {
    expect(readiness({ identity: answered, location: null, quantity: 3 }).blocker).toBe('Where');
    expect(readiness({ identity: answered, location: 'ROW 24', quantity: null }).blocker).toBe(
      'How many'
    );
    const r = readiness({ identity: answered, location: 'UNKNOWN', quantity: 0 });
    expect(r).toEqual({ what: true, where: true, howMany: true, blocker: null });
  });

  it('an S/D needs its serial', () => {
    const sd = { ...answered, isScratchDent: true };
    expect(readiness({ identity: sd, location: 'ROW 24', quantity: 1 }).blocker).toBe(
      'Serial (S/D)'
    );
  });
});

describe('unitsBySquare / squaresForRow', () => {
  it('spreads a line over the letters it lists (V3)', () => {
    const m = unitsBySquare([
      { sublocation: ['A'], quantity: 30 },
      { sublocation: ['B', 'C'], quantity: 40 },
      { sublocation: null, quantity: 9 },
      { sublocation: ['F'], quantity: 7 },
    ]);
    expect(Object.fromEntries(m)).toEqual({ A: 30, B: 20, C: 20, F: 7 });
  });

  it('draws A–K and any extra letter the row uses', () => {
    expect(squaresForRow([])).toHaveLength(11);
    const withL = squaresForRow(['L', 'A']);
    expect(withL[withL.length - 1]).toBe('L');
  });
});

describe('buildRegisterWrite', () => {
  const identity = settle(identityFromDraft(renegade), 'size', '54cm');
  const base = { identity, location: 'ROW 24', quantity: 12, square: 'F', warehouse: 'LUDLOW' };

  it('writes the row with its square and the bike distribution', () => {
    const { item } = buildRegisterWrite({ ...base, itemName: null });
    expect(item).toMatchObject({
      sku: '03-4710BL',
      location: 'ROW 24',
      quantity: 12,
      sublocation: ['F'],
      item_name: 'RENEGADE C2 54cm ADOBE CLAY',
      is_bike: true,
    });
    expect(item.distribution?.reduce((s, d) => s + d.count * d.units_each, 0)).toBe(12);
  });

  it('never sends dimensions, and sends the weight only when the carton printed a real one', () => {
    const { metadata } = buildRegisterWrite({ ...base, itemName: null });
    expect(metadata).not.toHaveProperty('length_in');
    expect(metadata.weight_lbs).toBe(37.9);
    const at45 = buildRegisterWrite({
      ...base,
      identity: { ...identity, labelWeightLbs: 45 },
      itemName: null,
    });
    expect(at45.metadata).not.toHaveProperty('weight_lbs');
  });

  it('leaves out what nobody said, so a known SKU keeps its catalogue', () => {
    const id = emptyIdentity();
    id.fields.sku = { value: '01-530', status: 'typed' };
    id.isBike = false;
    const w = buildRegisterWrite({ ...base, identity: id, itemName: 'BRAKE CABLE' });
    expect(w.metadata).toEqual({ sku: '01-0530', is_bike: false, is_scratch_dent: false });
    expect(w.item.item_name).toBe('BRAKE CABLE');
    expect(w.item.distribution).toEqual([]);
  });

  it('files the serial as a carton’s, unless the unit is an S/D', () => {
    const withSerial = settle(identity, 'serial', 'JB24A01234');
    expect(buildRegisterWrite({ ...base, identity: withSerial, itemName: null })).toMatchObject({
      cartonSerial: 'JB24A01234',
    });
    const sd = buildRegisterWrite({
      ...base,
      identity: { ...withSerial, isScratchDent: true },
      itemName: null,
      sdFields: { condition: 'returned' },
    });
    expect(sd.cartonSerial).toBeNull();
    expect(sd.metadata).toMatchObject({ serial_number: 'JB24A01234', condition: 'returned' });
  });

  it('a square only goes on a ROW (V7)', () => {
    const { item } = buildRegisterWrite({ ...base, location: 'UNKNOWN', itemName: null });
    expect(item.sublocation).toBeNull();
  });
});

describe('fillFromCatalogue', () => {
  it('fills what the catalogue knows and leaves what the operator said', () => {
    const id = settle(emptyIdentity(), 'sku', '03-3956GY');
    const typed = settle(id, 'color', 'SMOKE GREY');
    const out = fillFromCatalogue(typed, {
      is_bike: true,
      model: 'BEATNIK',
      size: '51',
      color: 'SMOKE',
      upc: null,
    });
    expect(out.isBike).toBe(true);
    expect(out.fields.model).toEqual({ value: 'BEATNIK', status: 'given' });
    expect(out.fields.color).toEqual({ value: 'SMOKE GREY', status: 'typed' });
    expect(out.fields.upc.status).toBe('missing');
  });
});
