import { describe, expect, it } from 'vitest';
import {
  mergeDraftFields,
  mergeDrafts,
  type DraftField,
  type SkuLabelDraft,
} from '../labelToSkuDraft';

const found = <T>(value: T, source = 'ocr'): DraftField<T> => ({ value, status: 'found', source });
const missing: DraftField<never> = { value: null, status: 'missing', source: null };
const uncertain = <T>(value: T, options: T[], source = 'ocr'): DraftField<T> => ({
  value,
  status: 'uncertain',
  source,
  options,
});

function draft(p: Partial<Record<keyof SkuLabelDraft, DraftField<unknown>>>): SkuLabelDraft {
  const base = {
    sku: missing,
    isBike: missing,
    model: missing,
    size: missing,
    color: missing,
    serial: missing,
    upc: missing,
    gtin: missing,
    weightLbs: missing,
    ...p,
  } as unknown as SkuLabelDraft;
  return { ...base, missingFields: [], uncertainFields: [] };
}

describe('mergeDraftFields — varias etiquetas de la misma foto', () => {
  it('lo que dicen igual queda firme', () => {
    const f = mergeDraftFields([found('CITIZEN 2'), found('citizen  2'), missing]);
    expect(f.status).toBe('found');
    expect(f.value).toBe('CITIZEN 2');
  });

  it('lo que difiere se ofrece, primero lo que más etiquetas repiten', () => {
    const f = mergeDraftFields([found('17"'), found('19"'), found('19"')]);
    expect(f.status).toBe('uncertain');
    expect(f.options).toEqual(['19"', '17"']);
    expect(f.value).toBe('19"');
  });

  it('una etiqueta que no dice nada no vota', () => {
    expect(mergeDraftFields([missing, found('STORM GREY'), missing]).status).toBe('found');
  });

  it('ninguna lo dice: sigue faltando', () => {
    expect(mergeDraftFields([missing, missing]).status).toBe('missing');
  });

  it('una duda de una etiqueta sigue siendo duda aunque otra no la tenga', () => {
    const f = mergeDraftFields([uncertain('14"', ['14"', '16"']), found('14"')]);
    expect(f.status).toBe('uncertain');
    expect(f.value).toBe('14"');
    expect(f.options).toEqual(['14"', '16"']);
  });
});

describe('mergeDrafts', () => {
  it('cada etiqueta llena lo que la otra no trae', () => {
    const product = draft({
      sku: found('03-3989GY'),
      model: found('CITIZEN 2'),
      size: found('16"'),
    });
    const serial = draft({ serial: found('Y22B005974', 'barcode') });
    const weight = draft({ weightLbs: found(43.2) });
    const d = mergeDrafts([product, serial, weight]);
    expect(d.sku.value).toBe('03-3989GY');
    expect(d.serial.value).toBe('Y22B005974');
    expect(d.weightLbs.value).toBe(43.2);
    expect(d.missingFields).toEqual(expect.arrayContaining(['color', 'upc', 'gtin', 'isBike']));
    expect(d.uncertainFields).toEqual([]);
  });

  it('el SKU se compara en su grafía canónica: 03-3990-TL y 03-3990TL son uno', () => {
    const d = mergeDrafts([
      draft({ sku: found('03-3990-TL') }),
      draft({ sku: found('03-3990TL') }),
    ]);
    expect(d.sku.status).toBe('found');
  });

  it('dos SKUs distintos en la misma foto: se ofrecen los dos, no se elige en silencio', () => {
    const d = mergeDrafts([draft({ sku: found('03-4705GY') }), draft({ sku: found('03-4706GY') })]);
    expect(d.sku.status).toBe('uncertain');
    expect(d.sku.options).toHaveLength(2);
    expect(d.uncertainFields).toContain('sku');
  });

  it('el peso se compara a la décima de libra', () => {
    const d = mergeDrafts([draft({ weightLbs: found(43.21) }), draft({ weightLbs: found(43.24) })]);
    expect(d.weightLbs.status).toBe('found');
  });
});
