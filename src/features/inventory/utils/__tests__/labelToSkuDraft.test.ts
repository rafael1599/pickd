import { describe, it, expect } from 'vitest';
import { buildSkuLabelDraft, inferIsBike, skuDraftToPrefill } from '../labelToSkuDraft';
import type { ClientRecognitionResult } from '../../../../lib/recognition/recognizeLabelClient';

/**
 * Builds the slice of a recognition result this mapper actually reads, so the
 * fixtures stay legible next to the label they came from.
 */
function resultOf(
  extractedFields: Partial<ClientRecognitionResult['extractedFields']>,
  opts: {
    fullText?: string;
    fieldSources?: Record<string, string>;
    modelCandidates?: string[];
    sizeCandidates?: string[];
    colorCandidates?: string[];
    skuCandidates?: string[];
    upcConflict?: { direct: string; fromGtin: string } | null;
  } = {}
): ClientRecognitionResult {
  return {
    extractedFields: {
      sku: null,
      upc: null,
      gtin: null,
      serial: null,
      carton: null,
      order: null,
      factoryCode: null,
      model: null,
      size: null,
      color: null,
      gw_kg: null,
      ...extractedFields,
    },
    fieldSources: opts.fieldSources ?? {},
    ocr: {
      lineCount: 0,
      fullText: opts.fullText ?? '',
      extracted: {
        sku: extractedFields.sku ?? null,
        upc: extractedFields.upc ?? null,
        gtin: extractedFields.gtin ?? null,
        model: extractedFields.model ?? null,
        size: extractedFields.size ?? null,
        color: extractedFields.color ?? null,
        gw_kg: extractedFields.gw_kg ?? null,
        serial: extractedFields.serial ?? null,
        upcConflict: opts.upcConflict ?? null,
        modelCandidates: (opts.modelCandidates ?? []).map((value) => ({ value, source: 'ocr' })),
        sizeCandidates: (opts.sizeCandidates ?? []).map((value) => ({ value, source: 'ocr' })),
        colorCandidates: (opts.colorCandidates ?? []).map((value) => ({ value, source: 'ocr' })),
        skuCandidates: (opts.skuCandidates ?? []).map((sku) => ({
          sku,
          rawText: sku,
          source: 'ocr',
          surroundingAnchors: [],
        })),
      },
    },
  } as unknown as ClientRecognitionResult;
}

describe('buildSkuLabelDraft', () => {
  // The XR20 carton Rafael photographed on 2026-09-21: a type-B label with no
  // MODEL: anchor (the model sits in a black banner), no COLOR: anchor, a
  // serial barcode, and UPC and GTIN printed with the same 12 digits.
  const XR20 = resultOf(
    {
      sku: '07-3721RD',
      upc: '845436099323',
      gtin: '845436099323',
      model: 'XR20',
      size: '20"x10"',
      color: 'Blaze Red',
      serial: 'M25H000440',
      gw_kg: 13.56,
    },
    {
      fullText: 'JAMIS XR20 SIZE:20"x10" Blaze Red QTY.: 1 SET N.W: 10.5 KG G.W: 13.56KG',
      fieldSources: { sku: 'barcode+ocr', upc: 'barcode', model: 'ocr' },
    }
  );

  it('marks every field the label states outright as found', () => {
    const draft = buildSkuLabelDraft(XR20);

    expect(draft.sku).toMatchObject({ value: '07-3721RD', status: 'found' });
    expect(draft.model).toMatchObject({ value: 'XR20', status: 'found' });
    expect(draft.size).toMatchObject({ value: '20"x10"', status: 'found' });
    expect(draft.color).toMatchObject({ value: 'Blaze Red', status: 'found' });
    expect(draft.serial).toMatchObject({ value: 'M25H000440', status: 'found' });
    expect(draft.missingFields).toHaveLength(0);
  });

  it('reads the type off the quantity line rather than guessing it', () => {
    expect(buildSkuLabelDraft(XR20).isBike).toMatchObject({ value: true, status: 'found' });
  });

  it('converts the printed G.W. to pounds', () => {
    // 13.56 kg x 2.20462 = 29.9 lbs
    expect(buildSkuLabelDraft(XR20).weightLbs).toMatchObject({ value: 29.9, status: 'found' });
  });

  it('leaves what the label does not say as missing, never as a guess', () => {
    const draft = buildSkuLabelDraft(
      resultOf({ sku: '03-4005-MN', model: 'CITIZEN 1 STEP-THRU' }, { fullText: 'JAMIS' })
    );

    expect(draft.size).toMatchObject({ value: null, status: 'missing' });
    expect(draft.color).toMatchObject({ value: null, status: 'missing' });
    expect(draft.serial).toMatchObject({ value: null, status: 'missing' });
    expect(draft.missingFields).toContain('size');
    expect(draft.missingFields).toContain('color');
  });

  it('offers both readings instead of picking one when the label is ambiguous', () => {
    const draft = buildSkuLabelDraft(
      resultOf(
        { sku: '03-3858BL', size: '23"' },
        { sizeCandidates: ['23"', '14"'], colorCandidates: ['DEEP BLUE', 'SUGAR MINT'] }
      )
    );

    expect(draft.size.status).toBe('uncertain');
    expect(draft.size.options).toEqual(['23"', '14"']);
    expect(draft.color.status).toBe('uncertain');
    expect(draft.color.options).toEqual(['DEEP BLUE', 'SUGAR MINT']);
    expect(draft.uncertainFields).toContain('size');
  });

  it('surfaces a UPC/GTIN conflict as a choice rather than resolving it', () => {
    const draft = buildSkuLabelDraft(
      resultOf(
        { sku: '03-3858BL', upc: '845436086644' },
        { upcConflict: { direct: '845436086644', fromGtin: '845436085644' } }
      )
    );

    expect(draft.upc.status).toBe('uncertain');
    expect(draft.upc.options).toEqual(['845436086644', '845436085644']);
  });

  it('does not treat a repeated candidate as a disagreement', () => {
    const draft = buildSkuLabelDraft(
      resultOf({ model: 'XR20' }, { modelCandidates: ['XR20', 'XR20'] })
    );

    expect(draft.model.status).toBe('found');
    expect(draft.model.options).toBeUndefined();
  });
});

describe('inferIsBike', () => {
  it('reads a bulk parts carton as a part', () => {
    // The chainstay carton from R10 §3: ITEM: CHIAN STAY, Q'TY: 10 PCS.
    const result = inferIsBike("ITEM: CHIAN STAY MODEL: FAULTLINE 29 Q'TY: 10 PCS", false);
    expect(result).toMatchObject({ value: false, status: 'found' });
  });

  it('reads a single set with a serial as a bike', () => {
    expect(inferIsBike('QTY.: 1 SET', true)).toMatchObject({ value: true, status: 'found' });
  });

  it('asks when the carton reads both ways', () => {
    const result = inferIsBike("ITEM: SPARE WHEEL Q'TY: 4 PCS", true);
    expect(result.status).toBe('uncertain');
    expect(result.options).toEqual([true, false]);
  });

  it('stays missing when the label says nothing either way', () => {
    expect(inferIsBike('JAMIS MADE IN TAIWAN', false)).toMatchObject({
      value: null,
      status: 'missing',
    });
  });
});

describe('skuDraftToPrefill', () => {
  it('names a bike Model Size Colour and keeps the printed weight', () => {
    const draft = buildSkuLabelDraft(
      resultOf(
        {
          sku: '07-3721RD',
          model: 'XR20',
          size: '20"x10"',
          color: 'Blaze Red',
          serial: 'M25H000440',
          gw_kg: 13.56,
        },
        { fullText: 'QTY.: 1 SET' }
      )
    );
    const prefill = skuDraftToPrefill(draft) as unknown as {
      item_name: string;
      quantity: number;
      location: string | null;
      sku_metadata: Record<string, unknown>;
    };

    expect(prefill.item_name).toBe('XR20 20"x10" Blaze Red');
    expect(prefill.sku_metadata.weight_lbs).toBe(29.9);
    expect(prefill.sku_metadata.serial_number).toBe('M25H000440');
    // What only the floor knows is left for the operator.
    expect(prefill.quantity).toBe(0);
    expect(prefill.location).toBeNull();
  });
});
