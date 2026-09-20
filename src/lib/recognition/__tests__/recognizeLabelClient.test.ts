import { describe, it, expect, vi } from 'vitest';
import { buildSummaryText, recognizeLabelClient } from '../recognizeLabelClient';
import {
  extractFieldsFromOcrLines,
  groupLinesBySpatialProximity,
  matchKnownModel,
  matchKnownColor,
  type OcrItem,
  runClientOcr,
  reconstructMultiLineSku,
  mergeSlicePair,
} from '../clientOcr';
import { readBarcodesOffThread } from '../useBarcodeReader';

vi.mock('../useBarcodeReader', () => ({
  readBarcodesOffThread: vi.fn(),
}));

vi.mock('../clientOcr', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../clientOcr')>();
  return {
    ...mod,
    runClientOcr: vi.fn(),
  };
});

describe('buildSummaryText', () => {
  it('formats full plain text summary correctly with barcodes and OCR timing', () => {
    const timingMs = { total: 495.5, barcodes: 95.2, ocr: 400.3 };
    const imageInfo = { sizeBytes: 2500000, type: 'image/jpeg', name: 'photo-14.jpg' };
    const extracted = {
      sku: '09-4807CL',
      upc: '845436091679',
      serial: 'WMEI00094',
      carton: 'R161',
      order: 'A23JC-938-0009',
      factoryCode: '0123JC-7RS1-G541',
      model: 'RENEGADE S1 FRAMEKIT',
      size: '700C x 54cm',
      color: 'CHARCOAL',
      gw_kg: 7,
    };
    const fieldSources = {
      sku: 'barcode:Code39',
      upc: 'barcode:UPCA (checksum verificado)',
      serial: 'factory_qr:QRCode',
      model: 'ocr:pp-ocrv6',
      size: 'ocr:pp-ocrv6',
      color: 'ocr:pp-ocrv6',
      gw_kg: 'ocr:pp-ocrv6',
    };
    const barcodes = [
      {
        format: 'Code39',
        text: '09-4807CL',
        hits: 2,
        box: { x: 10, y: 10, width: 100, height: 50 },
        meaning: { kind: 'stock-number' as const, sku: '09-4807CL' },
      },
      {
        format: 'QRCode',
        text: '0123JC-7RS1-G541,WMEI00094,1,SET,R161,A23JC-938,0009',
        hits: 3,
        box: { x: 50, y: 50, width: 200, height: 200 },
        meaning: {
          kind: 'factory-qr' as const,
          qr: {
            factoryCode: '0123JC-7RS1-G541',
            frame: 'WMEI00094',
            quantity: 1,
            carton: 'R161',
            order: 'A23JC-938-0009',
          },
        },
      },
    ];

    const summary = buildSummaryText(timingMs, imageInfo, extracted, fieldSources, barcodes, {
      lineCount: 12,
    });

    expect(summary).toContain('=== TEST DE RECONOCIMIENTO DE ETIQUETAS (CLIENTE) ===');
    expect(summary).toContain('Tiempo total: 495.5 ms');
    expect(summary).toContain('Desglose barras: 95.2 ms');
    expect(summary).toContain('Desglose OCR: 400.3 ms');
    expect(summary).toContain('photo-14.jpg');
    expect(summary).toContain('09-4807CL [barcode:Code39]');
    expect(summary).toContain('845436091679 [barcode:UPCA (checksum verificado)]');
    expect(summary).toContain('WMEI00094 [factory_qr:QRCode]');
    expect(summary).toContain('RENEGADE S1 FRAMEKIT [ocr:pp-ocrv6]');
    expect(summary).toContain('700C x 54cm [ocr:pp-ocrv6]');
    expect(summary).toContain('CHARCOAL [ocr:pp-ocrv6]');
    expect(summary).toContain('7 kg [ocr:pp-ocrv6]');
    expect(summary).toContain('CÓDIGOS DETECTADOS (2):');
    expect(summary).toContain('[Code39] 09-4807CL (hits: 2)');
  });

  it('handles empty barcodes and reports OCR error gracefully', () => {
    const timingMs = { total: 45.0, barcodes: 45.0, ocr: 0 };
    const imageInfo = { sizeBytes: 500000, type: 'image/png' };
    const extracted = {
      sku: null,
      upc: null,
      serial: null,
      carton: null,
      order: null,
      factoryCode: null,
      model: null,
      size: null,
      color: null,
      gw_kg: null,
    };
    const summary = buildSummaryText(timingMs, imageInfo, extracted, {}, [], {
      lineCount: 0,
      error: 'WASM initialization failed',
    });
    expect(summary).toContain('Desglose OCR: 0.0 ms (Error: WASM initialization failed)');
    expect(summary).toContain('CÓDIGOS DETECTADOS (0):');
    expect(summary).toContain('Ningún código de barras detectado');
  });

  it('formats raw OCR lines structure when lines are provided (A3e)', () => {
    const timingMs = { total: 400.0, barcodes: 50.0, ocr: 350.0 };
    const imageInfo = { sizeBytes: 1000000, type: 'image/jpeg' };
    const extracted = {
      sku: '03-3989GY',
      upc: null,
      serial: null,
      carton: null,
      order: null,
      factoryCode: null,
      model: 'CITIZEN 2 STEP-THRU',
      size: '16',
      color: 'STORM GREY',
      gw_kg: null,
    };
    const sampleLines: OcrItem[][] = [
      [{ text: '03-396 C', box: { x: 10, y: 50, width: 100, height: 20 }, confidence: 0.95 }],
      [{ text: '1 9.', box: { x: 10, y: 75, width: 80, height: 20 }, confidence: 0.92 }],
      [{ text: '-GY', box: { x: 10, y: 100, width: 50, height: 20 }, confidence: 0.96 }],
    ];

    const summary = buildSummaryText(timingMs, imageInfo, extracted, {}, [], {
      lineCount: 3,
      lines: sampleLines,
    });

    expect(summary).toContain('ESTRUCTURA CRUDA OCR (3 líneas agrupadas):');
    expect(summary).toContain('"text": "03-396 C"');
    expect(summary).toContain('"x": 10');
  });
});

describe('extractFieldsFromOcrLines', () => {
  function makeLine(...texts: string[]): OcrItem[] {
    return texts.map((text, idx) => ({
      text,
      box: { x: idx * 100, y: 0, width: 90, height: 20 },
      confidence: 0.95,
    }));
  }

  it('extracts Renegade S1 Framekit catalog fields and SKU', () => {
    const lines = [
      makeLine('JAMIS BICYCLES'),
      makeLine('MODEL: RENEGADE S1 FRAMEKIT'),
      makeLine('SIZE:', '700C x 54cm'),
      makeLine('COLOR: CHARCOAL'),
      makeLine('G.W.: 7 KGS', 'N.W.: 5 KGS'),
      makeLine('ITEM NO: 09-4807CL'),
    ];

    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.model).toBe('RENEGADE S1 FRAMEKIT');
    expect(fields.size).toBe('700C x 54cm');
    expect(fields.color).toBe('CHARCOAL');
    expect(fields.gw_kg).toBe(7);
    expect(fields.sku).toBe('09-4807CL');
  });

  it('extracts bulk spare parts label (#15) with PP-part SKU and gross weight', () => {
    const lines = [
      makeLine('PART NO:', 'PP1202JC'),
      makeLine('DESCRIPTION:', 'FAULTLINE 29 REAR TRIANGLE'),
      makeLine('COLOR:', 'BLACK'),
      makeLine('G.W. 12.00 KGS'),
    ];

    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('PP1202JC');
    expect(fields.model).toBe('FAULTLINE 29');
    expect(fields.color).toBe('BLACK');
    expect(fields.gw_kg).toBe(12.0);
  });

  it('extracts Laser 1.6 label (#16) with inch size, deep blue color, and valid UPC', () => {
    const lines = [
      makeLine('MODEL: LASER 1.6'),
      makeLine('SIZE: 8" * 16"'),
      makeLine('COLOR: DEEP BLUE'),
      makeLine('G.W.: 14.80 KG'),
      makeLine('UPC:', '845436082769'),
      makeLine('SKU: 07-3692-BL'),
    ];

    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.model).toBe('LASER 1.6');
    expect(fields.size).toBe('8" * 16"');
    expect(fields.color).toBe('DEEP BLUE');
    expect(fields.gw_kg).toBe(14.8);
    expect(fields.upc).toBe('845436082769');
    expect(fields.sku).toBe('07-3692BL');
  });

  it('extracts Coda S1 Femme label (#18) with frame number and Misty Green', () => {
    const lines = [
      makeLine('JAMIS'),
      makeLine('MODEL: CODA S1 FEMME'),
      makeLine('SIZE: 700Cx16"'),
      makeLine('COLOR: MISTY GREEN'),
      makeLine('SERIAL NO: WAKCA2052'),
      makeLine('G.W.: 17 KGS'),
    ];

    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.model).toBe('CODA S1 FEMME');
    expect(fields.size).toBe('700Cx16"');
    expect(fields.color).toBe('MISTY GREEN');
    expect(fields.serial).toBe('WAKCA2052');
    expect(fields.gw_kg).toBe(17);
  });
});

describe('recognizeLabelClient fusion', () => {
  it('fuses barcode results with OCR results giving barcode priority for SKU and UPC', async () => {
    const mockBarcodes = [
      {
        format: 'Code39',
        text: '09-4807CL',
        hits: 2,
        box: { x: 0, y: 0, width: 100, height: 50 },
      },
      {
        format: 'UPCA',
        text: '845436091679',
        hits: 3,
        box: { x: 0, y: 50, width: 100, height: 50 },
      },
    ];

    const mockOcr = {
      lines: [],
      fullText:
        'JAMIS BICYCLES\nMODEL: RENEGADE S1\nCOLOR: CHARCOAL\nSIZE: 700C x 54cm\nG.W.: 7 KGS',
      extracted: {
        sku: '09-4807CL',
        upc: '845436091679',
        gtin: null,
        model: 'RENEGADE S1',
        size: '700C x 54cm',
        color: 'CHARCOAL',
        gw_kg: 7,
        serial: null,
      },
      elapsedMs: 350,
    };

    vi.mocked(readBarcodesOffThread).mockResolvedValueOnce(mockBarcodes);
    vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcr);

    const dummyBlob = new Blob(['test'], { type: 'image/jpeg' });
    const result = await recognizeLabelClient(dummyBlob, 'test.jpg');

    expect(result.extractedFields.sku).toBe('09-4807CL');
    expect(result.fieldSources.sku).toBe('barcode:Code39');
    expect(result.extractedFields.upc).toBe('845436091679');
    expect(result.fieldSources.upc).toContain('barcode:UPCA');
    expect(result.extractedFields.model).toBe('RENEGADE S1');
    expect(result.fieldSources.model).toBe('ocr:pp-ocrv6');
    expect(result.extractedFields.size).toBe('700C x 54cm');
    expect(result.extractedFields.color).toBe('CHARCOAL');
    expect(result.extractedFields.gw_kg).toBe(7);
    expect(result.timingMs.total).toBeGreaterThanOrEqual(0);
    expect(result.timingMs.barcodes).toBeGreaterThanOrEqual(0);
    expect(result.timingMs.ocr).toBeGreaterThanOrEqual(0);
  });

  it('falls back to OCR for SKU and UPC when barcodes are absent', async () => {
    const mockOcr = {
      lines: [],
      fullText:
        'MODEL: LASER 1.6\nSIZE: 8" * 16"\nCOLOR: DEEP BLUE\nSKU: 07-3692-BL\nUPC: 845436082769',
      extracted: {
        sku: '07-3692BL',
        upc: '845436082769',
        gtin: null,
        model: 'LASER 1.6',
        size: '8" * 16"',
        color: 'DEEP BLUE',
        gw_kg: 14.8,
        serial: null,
      },
      elapsedMs: 300,
    };

    vi.mocked(readBarcodesOffThread).mockResolvedValueOnce([]);
    vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcr);

    const dummyBlob = new Blob(['test'], { type: 'image/jpeg' });
    const result = await recognizeLabelClient(dummyBlob, 'laser.jpg');

    expect(result.extractedFields.sku).toBe('07-3692BL');
    expect(result.fieldSources.sku).toBe('ocr:pp-ocrv6 (texto plano)');
    expect(result.extractedFields.upc).toBe('845436082769');
    expect(result.fieldSources.upc).toBe('ocr:pp-ocrv6 (checksum verificado)');
    expect(result.extractedFields.model).toBe('LASER 1.6');
    expect(result.extractedFields.color).toBe('DEEP BLUE');
  });
});

describe('loadReconstructedWasmBinary', () => {
  it('fetches chunks in parallel, concatenates them in order, and caches the result', async () => {
    // We import the actual loadReconstructedWasmBinary (not mocked)
    const { loadReconstructedWasmBinary, WASM_CACHE_NAME, WASM_CACHE_KEY } =
      await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    const chunk1 = new Uint8Array([1, 2, 3, 4]);
    const chunk2 = new Uint8Array([5, 6, 7, 8]);

    const cachedStore = new Map<string, Response>();
    const mockCache = {
      match: vi.fn(async (key: string) => cachedStore.get(key)),
      put: vi.fn(async (key: string, res: Response) => {
        cachedStore.set(key, res);
      }),
    } as unknown as Cache;

    globalThis.caches = {
      open: vi.fn(async (name: string) => {
        expect(name).toBe(WASM_CACHE_NAME);
        return mockCache;
      }),
    } as unknown as CacheStorage;

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('part1.wasm')) {
        return new Response(chunk1.buffer);
      }
      if (urlStr.includes('part2.wasm')) {
        return new Response(chunk2.buffer);
      }
      return new Response(null, { status: 404 });
    });

    try {
      // First call: not cached, should fetch both parts
      const buffer = await loadReconstructedWasmBinary();
      const combined = new Uint8Array(buffer);

      expect(Array.from(combined)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(mockCache.put).toHaveBeenCalledWith(WASM_CACHE_KEY, expect.any(Response));

      // Second call: cached, should not fetch again
      vi.mocked(globalThis.fetch).mockClear();
      const cachedBuffer = await loadReconstructedWasmBinary();
      const cachedArr = new Uint8Array(cachedBuffer);
      expect(Array.from(cachedArr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
      // @ts-expect-error clean up mock
      delete globalThis.caches;
    }
  });
});

describe('A3b-precision: Geometric spatial clustering and noise tolerance', () => {
  it('groups bounding boxes into lines by vertical overlap, sorted left-to-right', () => {
    // Unordered boxes from different lines
    const rawItems: OcrItem[] = [
      { text: 'BLACK', box: { x: 120, y: 102, width: 60, height: 18 }, confidence: 0.95 },
      { text: 'MODEL:', box: { x: 20, y: 50, width: 70, height: 20 }, confidence: 0.98 },
      { text: 'FAULTLINE 29', box: { x: 100, y: 52, width: 140, height: 20 }, confidence: 0.96 },
      { text: 'COLOR:', box: { x: 20, y: 100, width: 80, height: 19 }, confidence: 0.97 },
      { text: 'PP1202JC', box: { x: 30, y: 10, width: 110, height: 22 }, confidence: 0.99 },
    ];

    const grouped = groupLinesBySpatialProximity(rawItems);
    expect(grouped).toHaveLength(3);

    // Line 1: PP1202JC
    expect(grouped[0].map((i) => i.text)).toEqual(['PP1202JC']);

    // Line 2: MODEL: FAULTLINE 29
    expect(grouped[1].map((i) => i.text)).toEqual(['MODEL:', 'FAULTLINE 29']);

    // Line 3: COLOR: BLACK
    expect(grouped[2].map((i) => i.text)).toEqual(['COLOR:', 'BLACK']);
  });

  it('correctly resolves Photo #15 with real Galaxy S25 Ultra OCR noise', () => {
    // Exactly reproducing the noisy OCR output documented in Cambios de rumbo #5:
    // - FAULTLINE 20K instead of FAULTLINE 29
    // - RTEM: CHIAN STAY instead of ITEM: CHAIN STAY
    // - FCAOLOR: BLACK instead of COLOR: BLACK
    // - Tabular line with Q'TY, N.W. 11.00 KGS, G.W. 12.00 KGS
    const lines: OcrItem[][] = [
      [{ text: 'PP1202JC', box: { x: 50, y: 20, width: 120, height: 20 }, confidence: 0.98 }],
      [{ text: 'JAMIS', box: { x: 50, y: 50, width: 80, height: 20 }, confidence: 0.98 }],
      [
        {
          text: 'RTEM: CHIAN STAY R.O.C.',
          box: { x: 50, y: 80, width: 220, height: 20 },
          confidence: 0.88,
        },
      ],
      [{ text: 'MODEL:', box: { x: 50, y: 110, width: 70, height: 20 }, confidence: 0.95 }],
      [{ text: 'FAULTLINE 20K', box: { x: 50, y: 140, width: 140, height: 20 }, confidence: 0.9 }],
      [
        {
          text: 'FCAOLOR: BLACK',
          box: { x: 50, y: 170, width: 150, height: 20 },
          confidence: 0.89,
        },
        { text: "Q'TY:", box: { x: 220, y: 170, width: 50, height: 20 }, confidence: 0.92 },
        { text: '10 PCS', box: { x: 280, y: 170, width: 60, height: 20 }, confidence: 0.95 },
      ],
      [
        { text: 'N.W.:', box: { x: 50, y: 200, width: 50, height: 20 }, confidence: 0.95 },
        { text: '11.00 KGS', box: { x: 110, y: 200, width: 80, height: 20 }, confidence: 0.94 },
      ],
      [
        { text: 'G.W.:', box: { x: 50, y: 230, width: 50, height: 20 }, confidence: 0.95 },
        { text: '12.00 KGS', box: { x: 110, y: 230, width: 80, height: 20 }, confidence: 0.94 },
      ],
    ];

    const fields = extractFieldsFromOcrLines(lines);

    // SKU extracted accurately
    expect(fields.sku).toBe('PP1202JC');
    // Model mapped to canonical FAULTLINE 29 despite OCR 20K typo
    expect(fields.model).toBe('FAULTLINE 29');
    // Color extracted cleanly as BLACK despite FCAOLOR misreading
    expect(fields.color).toBe('BLACK');
    // G.W. extracted as 12 (NOT 11 from N.W.)
    expect(fields.gw_kg).toBe(12);
  });

  it('strictly excludes N.W. when G.W. number is on an adjacent line', () => {
    // Label where G.W. label has number on next line and N.W. on previous line
    const lines: OcrItem[][] = [
      [
        {
          text: 'N.W.: 15.00 KGS',
          box: { x: 50, y: 50, width: 140, height: 20 },
          confidence: 0.95,
        },
      ],
      [{ text: 'G.W.:', box: { x: 50, y: 80, width: 50, height: 20 }, confidence: 0.95 }],
      [{ text: '17.50 KGS', box: { x: 50, y: 110, width: 80, height: 20 }, confidence: 0.94 }],
    ];

    const fields = extractFieldsFromOcrLines(lines);
    // Must take 17.50, never 15.00
    expect(fields.gw_kg).toBe(17.5);
  });

  it('matches catalog models and colors with noise tolerance', () => {
    expect(matchKnownModel('FAULTLINE 20K')).toBe('FAULTLINE 29');
    expect(matchKnownModel('RENEGADE S1 FRAMEKIT')).toBe('RENEGADE S1 FRAMEKIT');
    expect(matchKnownModel('CODA S1 FEMME')).toBe('CODA S1 FEMME');
    expect(matchKnownModel('LASER 1.6')).toBe('LASER 1.6');
    expect(matchKnownModel('DXT A1')).toBe('DXT A1');

    expect(matchKnownColor('BLACK')).toBe('BLACK');
    expect(matchKnownColor('CHARCOAL')).toBe('CHARCOAL');
    expect(matchKnownColor('ANO DEEP BLUE')).toBe('ANO DEEP BLUE');
    expect(matchKnownColor('MISTY GREEN')).toBe('MISTY GREEN');
    expect(matchKnownColor('MONTEREY GREY')).toBe('MONTEREY GREY');
  });
});

/**
 * REGLA ESTRICTA DE FIXTURES OCR (Cambios de rumbo #8 / A3e):
 * Un fixture derivado de `fullText` (e.g. `fullText.split('\n')` con cajas sintéticas ordenadas)
 * NO prueba el camino real del pipeline on-device.
 * Los fixtures válidos deben salir de la estructura `OcrItem[][]` real capturada directamente
 * desde el dispositivo (con sus cajas, coordenadas y agrupamiento espacial verdadero).
 *
 * NOTA A3e: El test a continuación utiliza temporalmente el fixture derivado de fullText
 * hasta que Rafael proporcione la captura real de OcrItem[][] desde el dispositivo (Paso 2 y 3).
 */
describe('A3d: Multi-line SKU reconstruction', () => {
  it('merges horizontally split digit pairs accurately', () => {
    expect(mergeSlicePair('6', '1')).toBe('8');
    expect(mergeSlicePair('C', '9')).toBe('9');
    expect(mergeSlicePair('O', 'O')).toBe('8');
    expect(mergeSlicePair('1', '1')).toBe('1');
    expect(mergeSlicePair('7', '1')).toBe('7');
  });

  it('resolves real Galaxy S25 Ultra Citizen 2 Step-Thru fixture to 03-3989GY', () => {
    // Real raw OCR text documented in Cambios de rumbo #7 (04-plan-f2-subfases.md)
    const fullText =
      '07:24 可 四  ● 5G.4! 16\nJAMIS\n\nN2S] STEP-THRU  \na12ETo06 1Or\nCDLO aiar\nR\n03-396 C\n1 9.\n-GY\nMK YI\nT SX ARHS\nCNDLOI\nT\nRIRLHDu\nQTY E aEE\nFURTAAA';

    // Test with OcrItem[][]
    const lines: OcrItem[][] = fullText.split('\n').map((line, idx) => [
      {
        text: line,
        box: { x: 10, y: idx * 25, width: 120, height: 20 },
        confidence: 0.95,
      },
    ]);

    const extracted = extractFieldsFromOcrLines(lines);

    // The fixture MUST resolve to 03-3989GY
    expect(extracted.sku).toBe('03-3989GY');
    // Model resolved via noise-tolerant matching
    expect(extracted.model).toBe('CITIZEN 2 STEP-THRU');
  });

  it('reconstructs cleanly split SKUs across 2 and 3 lines', () => {
    // Split: 03-3989 on line 1, -GY on line 2
    const lines2: OcrItem[][] = [
      [{ text: '03-3989', box: { x: 10, y: 10, width: 100, height: 20 }, confidence: 0.95 }],
      [{ text: '-GY', box: { x: 10, y: 35, width: 50, height: 20 }, confidence: 0.95 }],
    ];
    expect(reconstructMultiLineSku(lines2)).toBe('03-3989GY');

    // Split: 03- on line 1, 3989-GY on line 2
    const linesPrefix: OcrItem[][] = [
      [{ text: '03-', box: { x: 10, y: 10, width: 50, height: 20 }, confidence: 0.95 }],
      [{ text: '3989-GY', box: { x: 10, y: 35, width: 100, height: 20 }, confidence: 0.95 }],
    ];
    expect(reconstructMultiLineSku(linesPrefix)).toBe('03-3989GY');

    // Split across 3 lines: 03- / 3989 / GY
    const lines3: OcrItem[][] = [
      [{ text: '03-', box: { x: 10, y: 10, width: 50, height: 20 }, confidence: 0.95 }],
      [{ text: '3989', box: { x: 10, y: 35, width: 60, height: 20 }, confidence: 0.95 }],
      [{ text: 'GY', box: { x: 10, y: 60, width: 40, height: 20 }, confidence: 0.95 }],
    ];
    expect(reconstructMultiLineSku(lines3)).toBe('03-3989GY');
  });

  it('strictly discards lines that do not form a valid canonical SKU (never invents a digit)', () => {
    const invalidLines: OcrItem[][] = [
      [{ text: 'JAMIS BICYCLES', box: { x: 10, y: 10, width: 150, height: 20 }, confidence: 0.95 }],
      [{ text: 'QTY: 10 PCS', box: { x: 10, y: 35, width: 100, height: 20 }, confidence: 0.95 }],
      [{ text: 'MADE IN TAIWAN', box: { x: 10, y: 60, width: 120, height: 20 }, confidence: 0.95 }],
    ];
    expect(reconstructMultiLineSku(invalidLines)).toBeNull();

    // Partial department with non-matching trailing characters
    const nonMatching: OcrItem[][] = [
      [{ text: '03-HELLO', box: { x: 10, y: 10, width: 100, height: 20 }, confidence: 0.95 }],
      [{ text: 'WORLD', box: { x: 10, y: 35, width: 100, height: 20 }, confidence: 0.95 }],
    ];
    expect(reconstructMultiLineSku(nonMatching)).toBeNull();
  });
});
