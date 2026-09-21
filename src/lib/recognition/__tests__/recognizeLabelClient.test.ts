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
  countOcrAnchors,
  type ClientOcrResult,
} from '../clientOcr';
import type { BarcodeReadArray } from '../barcodes';
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
    expect(summary).toContain('CHARCOAL [ocr:pp-ocrv6]');
    expect(summary).toContain('7 kg [ocr:pp-ocrv6]');
    expect(summary).toContain('CÓDIGOS DETECTADOS (2):');
    expect(summary).toContain('[Code39] 09-4807CL');
    expect(summary).toContain('hits: 2');
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

  it('formats rotation used and attempts in OCR timing and always includes raw OCR structure', () => {
    const timingMs = {
      total: 1200.0,
      barcodes: 911.0,
      ocr: 289.0,
      ocrAttempts: [
        { rotation: 0, elapsedMs: 140.0 },
        { rotation: 90, elapsedMs: 149.0 },
      ],
    };
    const imageInfo = { sizeBytes: 1500000, type: 'image/jpeg' };
    const extracted = {
      sku: '07-3743PK',
      upc: '845438006710',
      serial: null,
      carton: null,
      order: null,
      factoryCode: null,
      model: 'LASER 1.6',
      size: null,
      color: 'POPSTAR PINK',
      gw_kg: 13,
    };
    const summary = buildSummaryText(timingMs, imageInfo, extracted, {}, [], {
      lineCount: 0,
      lines: [],
      rotationUsed: 90,
    });

    expect(summary).toContain(
      'Desglose OCR: 289.0 ms [rotación: 90°, reintentos: 0° en 140 ms, 90° en 149 ms]'
    );
    expect(summary).toContain('ESTRUCTURA CRUDA OCR (0 líneas agrupadas):');
    expect(summary).toContain('[]');
  });

  it('formats granular 4-part serviceInitDetails breakdown under Inicialización modelo/WASM', () => {
    const timingMs = {
      total: 6200.0,
      barcodes: 555.0,
      ocr: 5645.0,
      ocrProfile: {
        imageDecodeMs: 12.5,
        serviceInitMs: 5645.0,
        serviceInitDetails: {
          totalInitMs: 5645.0,
          wasmFetchOrReadMs: 2100.0,
          wasmSource: 'network' as const,
          wasmReassembleMs: 45.0,
          ortInitMs: 500.0,
          modelsLoadMs: 3000.0,
        },
      },
    };
    const imageInfo = { sizeBytes: 1500000, type: 'image/jpeg', name: 'label-rot90.jpg' };
    const extracted = {
      sku: '07-3743PK',
      upc: null,
      serial: null,
      carton: null,
      order: null,
      factoryCode: null,
      model: 'LASER 1.6',
      size: null,
      color: null,
      gw_kg: null,
    };

    const summary = buildSummaryText(timingMs, imageInfo, extracted, {}, []);

    expect(summary).toContain(
      '- Inicialización modelo/WASM: 5645.0 ms (espera bloqueante) [trabajo real: 5645.0 ms]'
    );
    expect(summary).toContain('* Chunks WASM: 2100.0 ms [red]');
    expect(summary).toContain('* Reensamblado binario: 45.0 ms');
    expect(summary).toContain('* Runtime ONNX: 500.0 ms');
    expect(summary).toContain('* Carga modelos PP-OCRv6: 3000.0 ms [red]');
  });

  it('formats warm run accounting with 0.0 ms blocking wait and positive real work', () => {
    const timingMs = {
      total: 463.5,
      barcodes: 95.0,
      ocr: 368.5,
      ocrProfile: {
        imageDecodeMs: 11.2,
        serviceInitMs: 0.0,
        serviceInitDetails: {
          totalInitMs: 1563.0,
          wasmFetchOrReadMs: 59.2,
          wasmSource: 'cache' as const,
          wasmReassembleMs: 0.0,
          ortInitMs: 39.3,
          modelsLoadMs: 1464.5,
          modelsSource: 'cache' as const,
        },
      },
    };
    const imageInfo = { sizeBytes: 1500000, type: 'image/jpeg' };
    const extracted = {
      sku: '07-3743PK',
      upc: null,
      serial: null,
      carton: null,
      order: null,
      factoryCode: null,
      model: 'LASER 1.6',
      size: null,
      color: null,
      gw_kg: null,
    };

    const summary = buildSummaryText(timingMs, imageInfo, extracted, {}, []);

    expect(summary).toContain(
      '- Inicialización modelo/WASM: 0.0 ms (espera bloqueante) [trabajo real: 1563.0 ms]'
    );
    expect(summary).toContain('* Chunks WASM: 59.2 ms [cache]');
    expect(summary).toContain('* Reensamblado binario: 0.0 ms');
    expect(summary).toContain('* Runtime ONNX: 39.3 ms');
    expect(summary).toContain('* Carga modelos PP-OCRv6: 1464.5 ms [cache]');
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
    expect(result.fieldSources.sku).toContain('Code39');
    expect(result.extractedFields.upc).toBe('845436091679');
    expect(result.fieldSources.upc).toContain('UPCA');
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
    const { loadReconstructedWasmBinary, WASM_CACHE_NAME, WASM_CACHE_KEY, getLastWasmLoadProfile } =
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
      expect(getLastWasmLoadProfile()?.wasmSource).toBe('network');

      // Second call: cached, should not fetch again
      vi.mocked(globalThis.fetch).mockClear();
      const cachedBuffer = await loadReconstructedWasmBinary();
      const cachedArr = new Uint8Array(cachedBuffer);
      expect(Array.from(cachedArr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(getLastWasmLoadProfile()?.wasmSource).toBe('cache');
    } finally {
      globalThis.fetch = origFetch;
      // @ts-expect-error clean up mock
      delete globalThis.caches;
    }
  });
});

describe('loadOcrModelBuffers', () => {
  it('fetches model buffers from local origin and caches them in Cache API', async () => {
    const {
      loadOcrModelBuffers,
      OCR_MODELS_CACHE_NAME,
      OCR_MODEL_ASSETS,
      getLastModelsLoadProfile,
    } = await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    const detData = new Uint8Array([10, 11, 12]);
    const recData = new Uint8Array([20, 21, 22]);
    const dictData = new Uint8Array([30, 31, 32]);

    const cachedStore = new Map<string, Response>();
    const mockCache = {
      match: vi.fn(async (key: string) => cachedStore.get(key)),
      put: vi.fn(async (key: string, res: Response) => {
        cachedStore.set(key, res);
      }),
    } as unknown as Cache;

    globalThis.caches = {
      open: vi.fn(async (name: string) => {
        expect(name).toBe(OCR_MODELS_CACHE_NAME);
        return mockCache;
      }),
    } as unknown as CacheStorage;

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('PP-OCRv6_tiny_det.ort')) {
        return new Response(detData.buffer);
      }
      if (urlStr.includes('PP-OCRv6_tiny_rec.ort')) {
        return new Response(recData.buffer);
      }
      if (urlStr.includes('ppocrv6_tiny_dict.txt')) {
        return new Response(dictData.buffer);
      }
      return new Response(null, { status: 404 });
    });

    try {
      // First call: network fetch
      const res1 = await loadOcrModelBuffers();
      expect(res1.profile.modelsSource).toBe('network');
      expect(Array.from(new Uint8Array(res1.buffers.detection))).toEqual([10, 11, 12]);
      expect(Array.from(new Uint8Array(res1.buffers.recognition))).toEqual([20, 21, 22]);
      expect(Array.from(new Uint8Array(res1.buffers.charactersDictionary))).toEqual([30, 31, 32]);
      expect(mockCache.put).toHaveBeenCalledTimes(3);
      expect(mockCache.put).toHaveBeenCalledWith(OCR_MODEL_ASSETS.detection, expect.any(Response));
      expect(getLastModelsLoadProfile()?.modelsSource).toBe('network');

      // Second call: cached
      vi.mocked(globalThis.fetch).mockClear();
      const res2 = await loadOcrModelBuffers();
      expect(res2.profile.modelsSource).toBe('cache');
      expect(Array.from(new Uint8Array(res2.buffers.detection))).toEqual([10, 11, 12]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(getLastModelsLoadProfile()?.modelsSource).toBe('cache');
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
 * REGLA ESTRICTA DE NO-INVENCIÓN Y FIXTURES REALES (Cambios de rumbo #9 / A3f):
 * Fixture capturado directamente del Galaxy S25 Ultra con la etiqueta de Jamis Citizen 2 Step-Thru.
 * El detector dividió los items de la fila del SKU en 5 fragmentos horizontales contiguos
 * dentro del mismo grupo de línea (grupo 6):
 *   - '03-396' (x: 253-768)
 *   - 'C'      (x: 725-792)
 *   - '1'      (x: 847-891)
 *   - '9.'     (x: 853-954)
 *   - '-GY'    (x: 931-1227)
 *
 * El SKU real de la caja es 03-3989-GY, pero el OCR únicamente detectó '396' y fragmentos parciales.
 * Reconstruir '03-3989GY' aquí exigiría INVENTAR el dígito '8' sin evidencia.
 * Según la regla central de PickD (02-investigacion.md §4.2, R5): sin evidencia, el campo
 * queda null. Devolver 03-3989GY acá sería un BUG CRÍTICO de alucinación silenciosa,
 * no un acierto.
 */
describe('A3d / A3f: Multi-line SKU reconstruction & strict non-invention contract', () => {
  it('strictly returns sku: null (never invents missing digits) on real Galaxy S25 Ultra 12-group fixture', () => {
    // 12 line groups as captured on device:
    const realGalaxyFixture: OcrItem[][] = [
      // Group 0: Screenshot status bar (compressed screenshot artifact)
      [
        {
          text: '07:24 可 四  ● 5G.4! 16',
          box: { x: 50, y: 37, width: 300, height: 25 },
          confidence: 0.9,
        },
      ],
      // Group 1: Brand
      [{ text: 'JAMIS', box: { x: 100, y: 150, width: 200, height: 40 }, confidence: 0.95 }],
      // Group 2: Model text with noise
      [
        {
          text: 'N2S] STEP-THRU',
          box: { x: 100, y: 220, width: 300, height: 35 },
          confidence: 0.92,
        },
      ],
      // Group 3: Frame size / order text with OCR noise
      [{ text: 'a12ETo06 1Or', box: { x: 100, y: 280, width: 250, height: 30 }, confidence: 0.85 }],
      // Group 4: Color header noise
      [{ text: 'CDLO aiar', box: { x: 100, y: 340, width: 200, height: 30 }, confidence: 0.88 }],
      // Group 5: Noise character
      [{ text: 'R', box: { x: 100, y: 400, width: 50, height: 30 }, confidence: 0.8 }],
      // Group 6: Real SKU horizontal line with fragmented items across x
      [
        { text: '03-396', box: { x: 253, y: 500, width: 515, height: 40 }, confidence: 0.95 },
        { text: 'C', box: { x: 725, y: 500, width: 67, height: 40 }, confidence: 0.9 },
        { text: '1', box: { x: 847, y: 500, width: 44, height: 40 }, confidence: 0.88 },
        { text: '9.', box: { x: 853, y: 500, width: 101, height: 40 }, confidence: 0.92 },
        { text: '-GY', box: { x: 931, y: 500, width: 296, height: 40 }, confidence: 0.96 },
      ],
      // Group 7: Spec line
      [{ text: 'MK YI', box: { x: 100, y: 560, width: 150, height: 30 }, confidence: 0.85 }],
      // Group 8: Spec line
      [{ text: 'T SX ARHS', box: { x: 100, y: 620, width: 200, height: 30 }, confidence: 0.86 }],
      // Group 9: Spec line
      [{ text: 'CNDLOI T', box: { x: 100, y: 680, width: 180, height: 30 }, confidence: 0.84 }],
      // Group 10: Spec line
      [{ text: 'RIRLHDu', box: { x: 100, y: 740, width: 150, height: 30 }, confidence: 0.82 }],
      // Group 11: Quantity line
      [
        {
          text: 'QTY E aEE FURTAAA',
          box: { x: 100, y: 800, width: 300, height: 30 },
          confidence: 0.85,
        },
      ],
    ];

    expect(realGalaxyFixture).toHaveLength(12);

    const extracted = extractFieldsFromOcrLines(realGalaxyFixture);

    // CRITICAL: Must be null because digits '89' cannot be honestly extracted from '396'
    expect(extracted.sku).toBeNull();

    // Model is correctly identified via noise-tolerant catalog matching
    expect(extracted.model).toBe('CITIZEN 2 STEP-THRU');
  });

  it('extracts sku: 03-3989GY accurately from the 13-group real fixture with clean 03-3989-GY line', () => {
    // 13 line groups from high-quality photo of the same box (Jamis Citizen 2 Step-Thru):
    const good13GroupFixture: OcrItem[][] = [
      // Group 0: Brand
      [{ text: 'JAMIS', box: { x: 100, y: 150, width: 200, height: 40 }, confidence: 0.99 }],
      // Group 1: Model
      [
        {
          text: 'CITIZEN 2 STEP-THRU',
          box: { x: 100, y: 220, width: 300, height: 35 },
          confidence: 0.98,
        },
      ],
      // Group 2: Frame size
      [{ text: 'SIZE: 16', box: { x: 100, y: 280, width: 120, height: 30 }, confidence: 0.97 }],
      // Group 3: Color
      [
        {
          text: 'COLOR: STORM GREY',
          box: { x: 100, y: 340, width: 220, height: 30 },
          confidence: 0.96,
        },
      ],
      // Group 4: Noise or category indicator
      [{ text: 'COMFORT', box: { x: 100, y: 400, width: 150, height: 30 }, confidence: 0.95 }],
      // Group 5: Clean complete SKU line detected with 0.997 confidence
      [
        {
          text: '03-3989-GY',
          box: { x: 250, y: 500, width: 520, height: 40 },
          confidence: 0.997,
        },
      ],
      // Group 6: Frame serial header
      [{ text: 'FRAME NO:', box: { x: 100, y: 560, width: 150, height: 30 }, confidence: 0.95 }],
      // Group 7: Frame serial number
      [{ text: 'U22Y00123', box: { x: 100, y: 620, width: 200, height: 30 }, confidence: 0.94 }],
      // Group 8: Gross weight
      [
        {
          text: 'G.W.: 15.20 KGS',
          box: { x: 100, y: 680, width: 180, height: 30 },
          confidence: 0.96,
        },
      ],
      // Group 9: Net weight
      [
        {
          text: 'N.W.: 13.50 KGS',
          box: { x: 100, y: 740, width: 180, height: 30 },
          confidence: 0.95,
        },
      ],
      // Group 10: Carton number
      [
        {
          text: 'CARTON NO: 12',
          box: { x: 100, y: 800, width: 160, height: 30 },
          confidence: 0.95,
        },
      ],
      // Group 11: PO number
      [
        {
          text: 'P.O. NO: 12345',
          box: { x: 100, y: 860, width: 160, height: 30 },
          confidence: 0.94,
        },
      ],
      // Group 12: Quantity line
      [{ text: 'QTY: 1 PC', box: { x: 100, y: 920, width: 120, height: 30 }, confidence: 0.95 }],
    ];

    expect(good13GroupFixture).toHaveLength(13);

    const extracted = extractFieldsFromOcrLines(good13GroupFixture);

    // Exact SKU extraction from clean line (texto plano)
    expect(extracted.sku).toBe('03-3989GY');
    expect(extracted.model).toBe('CITIZEN 2 STEP-THRU');
    expect(extracted.color).toBe('STORM GREY');
    expect(extracted.gw_kg).toBe(15.2);
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

describe('A3g: OCR rotation cascade & anchor scoring', () => {
  it('countOcrAnchors correctly identifies domain anchors and rejects orientation noise', () => {
    // Noise returned when reading a 90-degree rotated label vertically
    const noiseExtracted = {
      sku: null,
      upc: null,
      gtin: null,
      model: null,
      size: null,
      color: null,
      gw_kg: null,
      serial: null,
    };
    const noiseText = '| | / : - . 1 a e i';
    expect(countOcrAnchors(noiseExtracted, noiseText)).toBe(0);

    // Upright JAMIS LASER 1.6 label fields & text
    const laserExtracted = {
      sku: '07-3743PK',
      upc: '845438006710',
      gtin: '00845436006710',
      model: 'LASER 1.6',
      size: null,
      color: 'POPSTAR PINK',
      gw_kg: 13,
      serial: null,
    };
    const laserText =
      'JAMIS\nLASER 1.6\n07-3743-PK\nUPC: 845438006710\nCOLOR Popstar Pink\nQTY 1 SET\nG.W. 13 KG\nPORT NEW YORK';
    const anchors = countOcrAnchors(laserExtracted, laserText);
    // SKU (3) + UPC/GTIN (3) + model (1) + color (1) + JAMIS (1) + COLOR (1) + UPC (1) + QTY (1) + GW (1) + PORT (1) >= 14
    expect(anchors).toBeGreaterThanOrEqual(10);
  });

  it('skips rotation retries when 0° has anchors (preserves 2s baseline)', async () => {
    const { runClientOcr: actualRunClientOcr } =
      await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    const recognizePassMock = vi.fn().mockImplementation(async (rotation: number) => {
      if (rotation === 0) {
        return {
          lines: [
            [
              {
                text: 'JAMIS BICYCLES',
                box: { x: 10, y: 10, width: 200, height: 30 },
                confidence: 0.99,
              },
            ],
            [
              {
                text: 'MODEL: RENEGADE S1',
                box: { x: 10, y: 50, width: 220, height: 30 },
                confidence: 0.98,
              },
            ],
            [
              {
                text: 'SKU: 09-4807-CL',
                box: { x: 10, y: 90, width: 180, height: 30 },
                confidence: 0.99,
              },
            ],
          ],
          text: 'JAMIS BICYCLES\nMODEL: RENEGADE S1\nSKU: 09-4807-CL',
        };
      }
      return { lines: [], text: '' };
    });

    const dummyBlob = new Blob(['test'], { type: 'image/jpeg' });
    const res = await actualRunClientOcr(dummyBlob, { recognizePass: recognizePassMock });

    // CRITICAL: Must have stopped at rotation 0 without trying 90 or 270
    expect(recognizePassMock).toHaveBeenCalledTimes(1);
    expect(recognizePassMock).toHaveBeenCalledWith(0);
    expect(res.rotationUsed).toBe(0);
    expect(res.attempts).toHaveLength(1);
    expect(res.attempts?.[0]?.rotation).toBe(0);
    expect(res.extracted.sku).toBe('09-4807CL');
    expect(res.extracted.model).toBe('RENEGADE S1');
  });

  it('cascades to 90° when 0° has no anchors and extracts JAMIS LASER 1.6 fields accurately', async () => {
    const { runClientOcr: actualRunClientOcr } =
      await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    const jamisLaserUprightLines = [
      [{ text: 'JAMIS', box: { x: 50, y: 50, width: 200, height: 40 }, confidence: 0.99 }],
      [{ text: 'LASER 1.6', box: { x: 50, y: 100, width: 250, height: 40 }, confidence: 0.98 }],
      [
        {
          text: 'COLOR: Popstar Pink',
          box: { x: 50, y: 150, width: 280, height: 35 },
          confidence: 0.97,
        },
      ],
      [{ text: '07-3743-PK', box: { x: 50, y: 200, width: 300, height: 40 }, confidence: 0.99 }],
      [
        {
          text: 'UPC: 845438006710',
          box: { x: 50, y: 250, width: 280, height: 35 },
          confidence: 0.98,
        },
      ],
      [
        {
          text: 'GTIN: 00845436006710',
          box: { x: 50, y: 300, width: 320, height: 35 },
          confidence: 0.95,
        },
      ],
      [{ text: 'P/O: 2027-05', box: { x: 50, y: 350, width: 200, height: 30 }, confidence: 0.94 }],
      [
        {
          text: 'MK NO: 126070076',
          box: { x: 50, y: 400, width: 220, height: 30 },
          confidence: 0.94,
        },
      ],
      [{ text: 'C/NO: 09', box: { x: 50, y: 450, width: 150, height: 30 }, confidence: 0.95 }],
      [{ text: 'QTY: 1 SET', box: { x: 50, y: 500, width: 180, height: 30 }, confidence: 0.95 }],
      [
        {
          text: 'N.W.: 10.20 KG',
          box: { x: 50, y: 550, width: 200, height: 30 },
          confidence: 0.95,
        },
      ],
      [{ text: 'G.W.: 13 KG', box: { x: 50, y: 600, width: 180, height: 30 }, confidence: 0.96 }],
      [
        {
          text: 'PORT: NEW YORK',
          box: { x: 50, y: 650, width: 220, height: 30 },
          confidence: 0.94,
        },
      ],
    ];

    const recognizePassMock = vi.fn().mockImplementation(async (rotation: number) => {
      if (rotation === 0) {
        // Sideways gibberish / vertical artifacts with 0 anchors
        return {
          lines: [
            [{ text: '| | /', box: { x: 10, y: 20, width: 30, height: 300 }, confidence: 0.4 }],
            [{ text: ': - . 1', box: { x: 50, y: 40, width: 25, height: 280 }, confidence: 0.35 }],
          ],
          text: '| | / : - . 1',
        };
      }
      if (rotation === 90) {
        // Correct upright orientation
        return {
          lines: jamisLaserUprightLines,
          text: jamisLaserUprightLines.map((l) => l[0].text).join('\n'),
        };
      }
      return { lines: [], text: '' };
    });

    const dummyBlob = new Blob(['laser'], { type: 'image/jpeg' });
    const res = await actualRunClientOcr(dummyBlob, { recognizePass: recognizePassMock });

    // Should have tried 0 and 90, but NOT 270 because 90 succeeded with anchors
    expect(recognizePassMock).toHaveBeenCalledTimes(2);
    expect(recognizePassMock).toHaveBeenNthCalledWith(1, 0);
    expect(recognizePassMock).toHaveBeenNthCalledWith(2, 90);

    expect(res.rotationUsed).toBe(90);
    expect(res.attempts).toHaveLength(2);
    expect(res.attempts?.[0]?.anchorsFound).toBe(0);
    expect(res.attempts?.[1]?.anchorsFound).toBeGreaterThan(0);

    // Verify extracted fields on the 90° rotated image
    expect(res.extracted.sku).toBe('07-3743PK');
    // Direct UPC (845438006710) vs GTIN derived (845436006710) differ in digit 8 vs 6 -> Conflict!
    expect(res.extracted.upc).toContain('CONFLICTO');
    expect(res.extracted.upc).toContain('845438006710');
    expect(res.extracted.upc).toContain('845436006710');
    expect(res.extracted.model).toBe('LASER 1.6');
    expect(res.extracted.color).toBe('Popstar Pink');
    expect(res.extracted.gw_kg).toBe(13);
  });

  it('cascades to 270° when 0° and 90° both have no anchors', async () => {
    const { runClientOcr: actualRunClientOcr } =
      await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    const recognizePassMock = vi.fn().mockImplementation(async (rotation: number) => {
      if (rotation === 0 || rotation === 90) {
        return {
          lines: [
            [{ text: '... ///', box: { x: 10, y: 10, width: 50, height: 20 }, confidence: 0.3 }],
          ],
          text: '... ///',
        };
      }
      if (rotation === 270) {
        return {
          lines: [
            [
              {
                text: 'JAMIS BICYCLES',
                box: { x: 50, y: 50, width: 200, height: 40 },
                confidence: 0.99,
              },
            ],
            [
              {
                text: '07-3743-PK',
                box: { x: 50, y: 100, width: 200, height: 40 },
                confidence: 0.99,
              },
            ],
            [
              {
                text: 'QTY 1 SET',
                box: { x: 50, y: 150, width: 150, height: 30 },
                confidence: 0.95,
              },
            ],
          ],
          text: 'JAMIS BICYCLES\n07-3743-PK\nQTY 1 SET',
        };
      }
      return { lines: [], text: '' };
    });

    const dummyBlob = new Blob(['laser270'], { type: 'image/jpeg' });
    const res = await actualRunClientOcr(dummyBlob, { recognizePass: recognizePassMock });

    // Tried 0, 90, and 270
    expect(recognizePassMock).toHaveBeenCalledTimes(3);
    expect(recognizePassMock).toHaveBeenNthCalledWith(1, 0);
    expect(recognizePassMock).toHaveBeenNthCalledWith(2, 90);
    expect(recognizePassMock).toHaveBeenNthCalledWith(3, 270);

    expect(res.rotationUsed).toBe(270);
    expect(res.extracted.sku).toBe('07-3743PK');
    expect(res.attempts).toHaveLength(3);
  });

  it('BUG A & BUG B regression: Galaxy S25 Ultra real run returns gw_kg: null (never 10.2) and detects true UPC conflict with B454380C6710 (never 07-3743-PK)', async () => {
    const {
      groupLinesBySpatialProximity,
      extractFieldsFromOcrLines,
      isNetWeightLine,
      isValidUpcCandidate,
      normalizeOcrDigits,
    } = await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    // 1. Verify helper invariants
    expect(isNetWeightLine('N. W.: 10.20 KG')).toBe(true);
    expect(isNetWeightLine('N.W.: 10.20 KG')).toBe(true);
    expect(isNetWeightLine('NET: 10.20 KG')).toBe(true);
    expect(isNetWeightLine('G.W.113 KO')).toBe(false);
    expect(isNetWeightLine('G.W.: 13 KG')).toBe(false);

    // Canonical SKU exclusion from UPC candidates (BUG B)
    expect(isValidUpcCandidate('07-3743-PK')).toBe(false);
    expect(isValidUpcCandidate('07-3743PK')).toBe(false);
    expect(isValidUpcCandidate('03-3989GY')).toBe(false);
    expect(isValidUpcCandidate('IHLWNUWWVIA')).toBe(false);
    expect(isValidUpcCandidate('B454380C6710')).toBe(true);
    expect(normalizeOcrDigits('B454380C6710')).toBe('845438006710');

    // Fixture representing the real Galaxy S25 Ultra 90° rotated run:
    // Notice coordinates with y values that were previously merged and scrambled (1149, 705, 757, 338...)
    // and exact real OCR tokens: 'N. W.: 10.20 KG' and 'G.W.113 KO'
    const galaxyS25UltraItems: Array<{
      text: string;
      box: { x: number; y: number; width: number; height: number };
      confidence: number;
    }> = [
      { text: 'JAMIS', box: { x: 50, y: 338, width: 180, height: 40 }, confidence: 0.99 },
      { text: 'LASER 1.6', box: { x: 50, y: 395, width: 220, height: 38 }, confidence: 0.98 },
      { text: '07-3743-PK', box: { x: 50, y: 460, width: 260, height: 42 }, confidence: 0.99 },
      { text: 'COLOR:', box: { x: 50, y: 550, width: 120, height: 36 }, confidence: 0.97 },
      { text: 'Popstar PInk', box: { x: 180, y: 552, width: 200, height: 36 }, confidence: 0.96 },
      {
        text: 'UPC: IHLWNUWWVIA',
        box: { x: 50, y: 640, width: 260, height: 35 },
        confidence: 0.85,
      },
      { text: 'UPC:', box: { x: 50, y: 705, width: 80, height: 34 }, confidence: 0.95 },
      { text: 'B454380C6710', box: { x: 140, y: 706, width: 220, height: 34 }, confidence: 0.92 },
      { text: 'GTIN:', box: { x: 50, y: 757, width: 90, height: 34 }, confidence: 0.95 },
      { text: '00845436006710', box: { x: 150, y: 758, width: 250, height: 34 }, confidence: 0.97 },
      { text: 'P/O:', box: { x: 50, y: 820, width: 70, height: 32 }, confidence: 0.94 },
      { text: '2027-05', box: { x: 130, y: 821, width: 140, height: 32 }, confidence: 0.94 },
      { text: 'MK NO:', box: { x: 50, y: 875, width: 110, height: 32 }, confidence: 0.94 },
      { text: '126070076', box: { x: 170, y: 876, width: 160, height: 32 }, confidence: 0.94 },
      { text: 'C/NO: 09', box: { x: 50, y: 925, width: 140, height: 32 }, confidence: 0.95 },
      { text: 'QTY:', box: { x: 50, y: 975, width: 80, height: 32 }, confidence: 0.95 },
      { text: '1 SET', box: { x: 140, y: 976, width: 100, height: 32 }, confidence: 0.95 },
      { text: 'N. W.:', box: { x: 50, y: 1030, width: 90, height: 32 }, confidence: 0.95 },
      { text: '10.20 KG', box: { x: 150, y: 1031, width: 140, height: 32 }, confidence: 0.95 },
      { text: 'G.W.113 KO', box: { x: 50, y: 1090, width: 190, height: 34 }, confidence: 0.94 },
      { text: 'PORT: NEW YORK', box: { x: 50, y: 1149, width: 240, height: 34 }, confidence: 0.94 },
    ];

    // 1. Verify spatial line grouping separates lines properly and does not collapse into 1-2 giant lines
    const lines = groupLinesBySpatialProximity(galaxyS25UltraItems);
    expect(lines.length).toBeGreaterThanOrEqual(10);

    // 2. Extract fields and verify precision requirements:
    const extracted = extractFieldsFromOcrLines(lines);

    // BUG A check:
    // - Under Rule 4.2 / R5: gw_kg must NEVER take 10.2 from N. W.!
    // - From 'G.W.113 KO', 13 cannot be isolated without transforming/trimming characters, so gw_kg must be null!
    expect(extracted.gw_kg).not.toBe(10.2);
    expect(extracted.gw_kg).toBeNull();

    // Color must be 'Popstar PInk' clean without trailing UPC header concatenated
    expect(extracted.color).toBe('Popstar PInk');

    // BUG B check: Direct UPC candidate must be 'B454380C6710' (NOT '07-3743-PK' SKU).
    // GTIN derived is '845436006710' (digit 6 vs 8).
    // The arbiter must report true conflict between 'B454380C6710' and '845436006710'.
    expect(extracted.upc).toContain('CONFLICTO');
    expect(extracted.upc).toContain('B454380C6710');
    expect(extracted.upc).toContain('845436006710');
    expect(extracted.upc).not.toContain('07-3743-PK');
    expect(extracted.upcConflict).toBeDefined();
    expect(extracted.upcConflict?.direct).toBe('B454380C6710');
    expect(extracted.upcConflict?.fromGtin).toBe('845436006710');
  });

  it('BUG A: tolerates noisy unit KO / K0 / KQ when number is isolated without inventing', async () => {
    const { extractFieldsFromOcrLines } =
      await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    const linesKo = [
      [
        {
          text: 'N. W.: 10.20 KG',
          box: { x: 50, y: 100, width: 200, height: 30 },
          confidence: 0.95,
        },
      ],
      [{ text: 'G.W.: 13 KO', box: { x: 50, y: 140, width: 200, height: 30 }, confidence: 0.95 }],
    ];
    const extractedKo = extractFieldsFromOcrLines(linesKo);
    expect(extractedKo.gw_kg).toBe(13);

    const linesK0 = [
      [
        {
          text: 'N.W.: 11.00 KGS',
          box: { x: 50, y: 100, width: 200, height: 30 },
          confidence: 0.95,
        },
      ],
      [{ text: 'G.W. 13.5 K0', box: { x: 50, y: 140, width: 200, height: 30 }, confidence: 0.95 }],
    ];
    const extractedK0 = extractFieldsFromOcrLines(linesK0);
    expect(extractedK0.gw_kg).toBe(13.5);
  });

  it('BUG B: when direct UPC is filtered out as SKU, GTIN is used without false conflict', async () => {
    const { extractFieldsFromOcrLines } =
      await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    // Label where only SKU 07-3743-PK and GTIN 00845436006710 are present
    const lines = [
      [{ text: '07-3743-PK', box: { x: 50, y: 50, width: 200, height: 30 }, confidence: 0.99 }],
      [
        {
          text: 'GTIN: 00845436006710',
          box: { x: 50, y: 100, width: 300, height: 30 },
          confidence: 0.97,
        },
      ],
    ];

    const extracted = extractFieldsFromOcrLines(lines);
    // 07-3743-PK is recognized as SKU, NOT as UPC
    expect(extracted.sku).toBe('07-3743PK');
    // UPC uses GTIN-derived value directly without false conflict
    expect(extracted.upc).toBe('845436006710');
    expect(extracted.upcConflict).toBeNull();
  });

  it('mapBoxToRotation maps coordinates correctly between 0, 90, and 270 degrees', async () => {
    const { mapBoxToRotation } =
      await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    const originalBox = { x: 100, y: 200, width: 50, height: 30 };
    // Image 1000x2000
    const rot0 = mapBoxToRotation(originalBox, 0, 1000, 2000);
    expect(rot0).toEqual(originalBox);

    const rot90 = mapBoxToRotation(originalBox, 90, 1000, 2000);
    // 90°: newX = H - (y + h) = 2000 - (200 + 30) = 1770, newY = x = 100, newW = 30, newH = 50
    expect(rot90).toEqual({ x: 1770, y: 100, width: 30, height: 50 });

    const rot270 = mapBoxToRotation(originalBox, 270, 1000, 2000);
    // 270°: newX = y = 200, newY = W - (x + w) = 1000 - (100 + 50) = 850, newW = 30, newH = 50
    expect(rot270).toEqual({ x: 200, y: 850, width: 30, height: 50 });
  });
});

describe('CITIZEN 2 Galaxy S25 Ultra 90° rotated fixture & precision rules', () => {
  it('extracts SKU, talla, clean G.W. (15.6, never 15.8), and leaves color null on real CITIZEN 2 fixture', async () => {
    const { extractFieldsFromOcrLines, isNetWeightLine, parseSizeCandidate } =
      await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    // 1. Invariants on helper functions
    expect(isNetWeightLine('M.W:')).toBe(true);
    expect(isNetWeightLine('M. W:')).toBe(true);
    expect(isNetWeightLine('M.W: 15,8D KG')).toBe(true);
    expect(isNetWeightLine('N.W.: 10.20 KG')).toBe(true);
    expect(isNetWeightLine('G.W: 15.60 Kn')).toBe(false);

    expect(parseSizeCandidate('700G 17"')).toBe('17"');
    expect(parseSizeCandidate('17"')).toBe('17"');
    expect(parseSizeCandidate('8" * 16"')).toBe('8" * 16"');

    // 2. Real CITIZEN 2 90° rotated fixture items as captured on Galaxy S25 Ultra:
    // - Model: CITIZEN 2
    // - Talla: item 'SHZE:700G 17"' (x 362, y 337)
    // - Color: item 'cOLO:5oorm Grey' (x 365, y 400) -> 5oorm uncorrected, color must be null
    // - SKU: item '03-3979GY' (x 360, y 500)
    // - N.W.: item 'M.W:' (x 375, y 1167) + item '15,8D KG' (x 540, y 1167)
    // - G.W.: item 'G.W:' (x 377, y 1227) + item '15.60 Kn' (x 542, y 1235)
    const citizen2Fixture: OcrItem[][] = [
      [{ text: 'CITIZEN 2', box: { x: 360, y: 250, width: 200, height: 35 }, confidence: 0.98 }],
      [
        {
          text: 'SHZE:700G 17"',
          box: { x: 362, y: 337, width: 250, height: 35 },
          confidence: 0.95,
        },
      ],
      [
        {
          text: 'cOLO:5oorm Grey',
          box: { x: 365, y: 400, width: 230, height: 35 },
          confidence: 0.92,
        },
      ],
      [{ text: '03-3979GY', box: { x: 360, y: 500, width: 220, height: 40 }, confidence: 0.99 }],
      [
        { text: 'M.W:', box: { x: 375, y: 1167, width: 90, height: 32 }, confidence: 0.94 },
        { text: '15,8D KG', box: { x: 540, y: 1167, width: 140, height: 32 }, confidence: 0.91 },
      ],
      [
        { text: 'G.W:', box: { x: 377, y: 1227, width: 90, height: 32 }, confidence: 0.95 },
        { text: '15.60 Kn', box: { x: 542, y: 1235, width: 140, height: 32 }, confidence: 0.94 },
      ],
    ];

    const fields = extractFieldsFromOcrLines(citizen2Fixture);

    // SKU extracted exactly
    expect(fields.sku).toBe('03-3979GY');
    // Model resolved
    expect(fields.model).toBe('CITIZEN 2');
    // Talla extracted as 17" (inches pattern recognized, noisy SHZE anchor tolerated)
    expect(fields.size).toBe('17"');
    // Color: 5oorm is NOT corrected; color remains null (catalog supplies it)
    expect(fields.color).toBeNull();
    // G.W.: 15.6 extracted from isolated token with Kn unit, strictly isolated from M.W. 15.8
    expect(fields.gw_kg).toBe(15.6);
    expect(fields.gw_kg).not.toBe(15.8);
  });

  it('trap test: strictly rejects M.W. even if numeric value is clean and G.W. is missing', async () => {
    const { extractFieldsFromOcrLines } =
      await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    // Label with clean M.W. 15.80 KG, but NO G.W.
    const linesOnlyNet = [
      [
        { text: 'M.W:', box: { x: 375, y: 1167, width: 90, height: 32 }, confidence: 0.95 },
        { text: '15.80 KG', box: { x: 540, y: 1167, width: 140, height: 32 }, confidence: 0.95 },
      ],
    ];

    const fields = extractFieldsFromOcrLines(linesOnlyNet);
    // Must be null! Never steal 15.8 from M.W.!
    expect(fields.gw_kg).toBeNull();
  });

  it('talla extraction: isolates inch pattern across various noisy anchors and returns null on noise', async () => {
    const { extractFieldsFromOcrLines, parseSizeCandidate } =
      await vi.importActual<typeof import('../clientOcr')>('../clientOcr');

    expect(parseSizeCandidate('SHZE:700G 17"')).toBe('17"');
    expect(parseSizeCandidate('S1ZE: 15.5"')).toBe('15.5"');
    expect(parseSizeCandidate('SIZE: 8" * 16"')).toBe('8" * 16"');
    expect(parseSizeCandidate('SHZE: #&@$!')).toBeNull();

    const linesS1ze = [
      [{ text: 'S1ZE: 15.5"', box: { x: 50, y: 50, width: 180, height: 30 }, confidence: 0.95 }],
    ];
    expect(extractFieldsFromOcrLines(linesS1ze).size).toBe('15.5"');

    const linesUnparseable = [
      [{ text: 'SHZE: #&@$!', box: { x: 50, y: 50, width: 180, height: 30 }, confidence: 0.95 }],
    ];
    expect(extractFieldsFromOcrLines(linesUnparseable).size).toBeNull();
  });
});

describe('Rotated barcode retry in recognizeLabelClient cascade', () => {
  it('retries barcode reader on winning OCR rotation when initial 0° pass is empty', async () => {
    const { recognizeLabelClient } =
      await vi.importActual<typeof import('../recognizeLabelClient')>('../recognizeLabelClient');
    const { readBarcodesOffThread } = await import('../useBarcodeReader');
    const { runClientOcr } = await import('../clientOcr');

    // First call to readBarcodesOffThread (0°): 0 reads
    // Second call to readBarcodesOffThread (rotated 90°): 2 reads decoded!
    const rotatedBarcodes = [
      {
        format: 'Code39',
        text: '03-3979GY',
        hits: 2,
        box: { x: 100, y: 200, width: 350, height: 70 },
      },
      {
        format: 'UPCA',
        text: '845436091679',
        hits: 3,
        box: { x: 100, y: 300, width: 350, height: 70 },
      },
    ];

    vi.mocked(readBarcodesOffThread)
      .mockResolvedValueOnce([]) // 0° pass
      .mockResolvedValueOnce(rotatedBarcodes); // 90° pass

    vi.mocked(runClientOcr).mockResolvedValueOnce({
      lines: [
        [{ text: 'CITIZEN 2', box: { x: 360, y: 250, width: 200, height: 35 }, confidence: 0.98 }],
        [
          {
            text: 'SHZE:700G 17"',
            box: { x: 362, y: 337, width: 250, height: 35 },
            confidence: 0.95,
          },
        ],
      ],
      fullText: 'CITIZEN 2\nSHZE:700G 17"',
      extracted: {
        sku: '03-3979GY',
        upc: null,
        gtin: null,
        model: 'CITIZEN 2',
        size: '17"',
        color: null,
        gw_kg: 15.6,
        serial: null,
      },
      elapsedMs: 380,
      rotationUsed: 90,
      attempts: [
        { rotation: 0, elapsedMs: 40, anchorsFound: 0 },
        { rotation: 90, elapsedMs: 140, anchorsFound: 4 },
      ],
    });

    const dummyBlob = new Blob(['test-rot'], { type: 'image/jpeg' });
    const result = await recognizeLabelClient(dummyBlob, 'citizen2-rot90.jpg');

    // Verified that readBarcodesOffThread was called twice: first with undefined/0, second with { rotation: 90 }
    expect(readBarcodesOffThread).toHaveBeenCalledTimes(2);
    expect(readBarcodesOffThread).toHaveBeenNthCalledWith(
      1,
      dummyBlob,
      expect.objectContaining({ grids: [2], captureDiagnostics: true })
    );
    expect(readBarcodesOffThread).toHaveBeenNthCalledWith(2, dummyBlob, {
      rotation: 90,
      captureDiagnostics: true,
    });

    // Barcode readings take priority
    expect(result.barcodes.count).toBe(2);
    expect(result.barcodes.rotationUsed).toBe(90);
    expect(result.extractedFields.sku).toBe('03-3979GY');
    expect(result.fieldSources.sku).toContain('Code39');
    expect(result.extractedFields.upc).toBe('845436091679');
    expect(result.fieldSources.upc).toContain('UPCA');

    // OCR fills catalog fields
    expect(result.extractedFields.model).toBe('CITIZEN 2');
    expect(result.extractedFields.size).toBe('17"');
    expect(result.extractedFields.gw_kg).toBe(15.6);

    // Summary text includes rotation accounting for barcodes
    expect(result.summaryText).toContain('Desglose barras:');
    expect(result.summaryText).toContain('[rotación: 90°');
    expect(result.summaryText).toContain('03-3979GY');
    expect(result.summaryText).toContain('Code39');
  });

  it('reports discarded candidate diagnostics in summary text when barcodes fail validation', () => {
    const timingMs = {
      total: 500.0,
      barcodes: 120.0,
      barcodeRotationUsed: 90,
      barcodeRetryMs: 80.0,
      ocr: 380.0,
    };
    const imageInfo = { sizeBytes: 1500000, type: 'image/jpeg' };
    const extracted = {
      sku: '03-3979GY',
      upc: null,
      serial: null,
      carton: null,
      order: null,
      factoryCode: null,
      model: 'CITIZEN 2',
      size: '17"',
      color: null,
      gw_kg: 15.6,
    };
    const diagnostics = [
      {
        format: 'Code39',
        error: 'ChecksumError',
        box: { x: 300, y: 500, width: 400, height: 80 },
      },
    ];

    const summary = buildSummaryText(
      timingMs,
      imageInfo,
      extracted,
      { sku: 'ocr:pp-ocrv6' },
      [],
      { lineCount: 5 },
      diagnostics
    );

    expect(summary).toContain('Candidatos descartados (1):');
    expect(summary).toContain('[Code39] Error: ChecksumError en caja [400×80 px en (300, 500)]');
  });
});

describe('Sub-fase A3h (R11): BarcodeDetector nativo, recorte OCR, LapVar y salvaguardas', () => {
  it('getAnchorBarcodeRois extracts candidate ROIs around UPC, GTIN, ITEM, SKU anchors and merges overlapping boxes', async () => {
    const { getAnchorBarcodeRois } = await import('../barcodes');
    const mockLines: OcrItem[][] = [
      [
        {
          text: 'ITEM: 07-3743-PK',
          box: { x: 200, y: 300, width: 200, height: 30 },
          confidence: 0.99,
        },
      ],
      [
        {
          text: 'UPC: 845438006710',
          box: { x: 210, y: 700, width: 220, height: 30 },
          confidence: 0.98,
        },
      ],
      [
        {
          text: 'GTIN: 00845436006710',
          box: { x: 220, y: 740, width: 250, height: 30 },
          confidence: 0.97,
        },
      ],
      [
        {
          text: 'COLOR: Popstar Pink',
          box: { x: 200, y: 1100, width: 250, height: 30 },
          confidence: 0.95,
        },
      ],
    ];

    const rois = getAnchorBarcodeRois(mockLines, 1500, 2000);
    // Should produce 2 distinct merged ROIs: 1 for ITEM (y ~ 160-470), 1 for UPC+GTIN merged (y ~ 560-910)
    expect(rois.length).toBe(2);

    // ITEM ROI covers x and y around y=300
    const itemRoi = rois.find((r) => r.y <= 300 && r.y + r.height >= 330);
    expect(itemRoi).toBeDefined();
    expect(itemRoi!.width).toBeGreaterThanOrEqual(450);

    // UPC+GTIN ROI merged covers both anchors around y=700..770
    const upcRoi = rois.find((r) => r.y <= 700 && r.y + r.height >= 770);
    expect(upcRoi).toBeDefined();
  });

  it('triggers targeted barcode crop pass when initial pass is empty and OCR provides anchors', async () => {
    // Initial pass returns 0 barcodes, with LapVar 24.3 (macro blur)
    const initialBarcodes = Object.assign([], {
      diagnostics: [],
      laplacianVariance: 24.3,
      engineUsed: 'none' as const,
    });

    // Targeted pass decodes Code 128 using native BarcodeDetector
    const targetedBarcodes = Object.assign(
      [
        {
          text: '07-3743-PK',
          format: 'Code128',
          hits: 1,
          box: { x: 200, y: 250, width: 400, height: 100 },
          engine: 'native' as const,
        },
      ],
      {
        diagnostics: [],
        engineUsed: 'native' as const,
      }
    );

    const mockOcr = {
      lines: [
        [
          {
            text: 'ITEM: 07-3743-PK',
            box: { x: 200, y: 300, width: 200, height: 30 },
            confidence: 0.99,
          },
        ],
      ],
      fullText: 'ITEM: 07-3743-PK',
      extracted: {
        sku: '07-3743-PK',
        upc: null,
        gtin: null,
        model: null,
        size: null,
        color: null,
        gw_kg: null,
        serial: null,
      },
      elapsedMs: 200,
    };

    vi.mocked(readBarcodesOffThread)
      .mockResolvedValueOnce(initialBarcodes) // 1st: initial whole-image pass
      .mockResolvedValueOnce(targetedBarcodes); // 2nd: targeted OCR-guided crop pass

    vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcr);

    const dummyBlob = new Blob(['test-targeted'], { type: 'image/jpeg' });
    const result = await recognizeLabelClient(dummyBlob, 'blur-label.jpg');

    // Verified that readBarcodesOffThread was called twice: 1st initial, 2nd targeted
    expect(readBarcodesOffThread).toHaveBeenCalledTimes(2);
    expect(readBarcodesOffThread).toHaveBeenNthCalledWith(
      2,
      dummyBlob,
      expect.objectContaining({
        skipFullPass: true,
        targetedRois: expect.any(Array),
      })
    );

    // Decoded code is captured with motor: native
    expect(result.barcodes.count).toBe(1);
    expect(result.barcodes.reads[0].format).toBe('Code128');
    expect(result.barcodes.reads[0].engine).toBe('native');
    expect(result.fieldSources.sku).toBe('barcode:native [Code128]');

    // Summary text includes LapVar diagnosis and motor diagnosis
    expect(result.summaryText).toContain('Diagnóstico motor: barcode:native (hardware)');
    expect(result.summaryText).toContain('Intento dirigido (recortes OCR):');
    expect(result.summaryText).toContain(
      'Varianza Laplaciana (LapVar): 24.3 [Desenfoque severo / Macro - barrera óptica]'
    );
  });

  it('safeguards: Code 39 without checksum is marked as candidate when unconfirmed, and confirmed when matching OCR', async () => {
    // Unconfirmed Code 39
    const unconfirmedBarcode = Object.assign(
      [
        {
          text: '03-3979GY',
          format: 'Code39',
          hits: 1,
          box: { x: 100, y: 100, width: 300, height: 80 },
          engine: 'zxing' as const,
        },
      ],
      {
        laplacianVariance: 280.0,
        engineUsed: 'zxing' as const,
      }
    );

    const mockOcrNoSku = {
      lines: [],
      fullText: 'NO SKU HERE',
      extracted: {
        sku: null,
        upc: null,
        gtin: null,
        model: 'CITIZEN 2',
        size: null,
        color: null,
        gw_kg: null,
        serial: null,
      },
      elapsedMs: 150,
    };

    vi.mocked(readBarcodesOffThread).mockResolvedValueOnce(unconfirmedBarcode);
    vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcrNoSku);

    const dummyBlob = new Blob(['test-c39'], { type: 'image/jpeg' });
    const resultUnconfirmed = await recognizeLabelClient(dummyBlob, 'c39.jpg');

    // Unconfirmed Code 39 should be explicitly flagged in fieldSources
    expect(resultUnconfirmed.fieldSources.sku).toContain(
      'candidato barcode:zxing [Code39] (sin checksum, no confirmado'
    );
    expect(resultUnconfirmed.barcodes.reads[0].confirmed).toBe(false);
    expect(resultUnconfirmed.summaryText).toContain('[aviso: Code 39 sin checksum, no confirmado]');

    // Now confirmed Code 39 (matching OCR SKU)
    const mockOcrWithSku = {
      lines: [],
      fullText: 'SKU: 03-3979GY',
      extracted: {
        sku: '03-3979GY',
        upc: null,
        gtin: null,
        model: 'CITIZEN 2',
        size: null,
        color: null,
        gw_kg: null,
        serial: null,
      },
      elapsedMs: 150,
    };

    vi.mocked(readBarcodesOffThread).mockResolvedValueOnce(unconfirmedBarcode);
    vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcrWithSku);

    const resultConfirmed = await recognizeLabelClient(dummyBlob, 'c39-confirmed.jpg');
    expect(resultConfirmed.fieldSources.sku).toBe('barcode:zxing [Code39] (confirmado por OCR)');
    expect(resultConfirmed.barcodes.reads[0].confirmed).toBe(true);
  });

  it('safeguards: UPC-A mod-10 is marked as candidate when isolated, and confirmed when matching OCR GTIN/UPC', async () => {
    // Isolated UPC-A with valid mod-10 check digit (845436082769)
    const barcodeUpc = Object.assign(
      [
        {
          text: '845436082769',
          format: 'UPCA',
          hits: 1,
          box: { x: 100, y: 500, width: 300, height: 80 },
          engine: 'native' as const,
        },
      ],
      {
        laplacianVariance: 280.0,
        engineUsed: 'native' as const,
      }
    );

    const mockOcrNoUpc = {
      lines: [],
      fullText: 'OTHER TEXT',
      extracted: {
        sku: null,
        upc: null,
        gtin: null,
        model: null,
        size: null,
        color: null,
        gw_kg: null,
        serial: null,
      },
      elapsedMs: 150,
    };

    vi.mocked(readBarcodesOffThread).mockResolvedValueOnce(barcodeUpc);
    vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcrNoUpc);

    const dummyBlob = new Blob(['test-upc'], { type: 'image/jpeg' });
    const resultIsolated = await recognizeLabelClient(dummyBlob, 'upc-isolated.jpg');

    // Isolated UPC-A is flagged as candidate
    expect(resultIsolated.fieldSources.upc).toContain(
      'candidato barcode:native [UPCA] (checksum mod-10, no confirmado por OCR ni catálogo)'
    );
    expect(resultIsolated.barcodes.reads[0].confirmed).toBe(false);
    expect(resultIsolated.summaryText).toContain(
      '[aviso: checksum mod-10, no confirmado por OCR ni catálogo]'
    );

    // Confirmed UPC-A (matching OCR GTIN-14)
    const mockOcrWithGtin = {
      lines: [],
      fullText: 'GTIN: 00845436082769',
      extracted: {
        sku: null,
        upc: null,
        gtin: '00845436082769',
        model: null,
        size: null,
        color: null,
        gw_kg: null,
        serial: null,
      },
      elapsedMs: 150,
    };

    vi.mocked(readBarcodesOffThread).mockResolvedValueOnce(barcodeUpc);
    vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcrWithGtin);

    const resultConfirmed = await recognizeLabelClient(dummyBlob, 'upc-confirmed.jpg');
    expect(resultConfirmed.fieldSources.upc).toBe(
      'barcode:native [UPCA] (checksum verificado, confirmado por OCR (GTIN-14))'
    );
    expect(resultConfirmed.barcodes.reads[0].confirmed).toBe(true);
  });

  describe('Sub-fase A3j: Code 39 Mod-43, candidate conflict arbiter, and Hudson fixture', () => {
    it('validates Code 39 Mod-43 and sets verified barcode sources for SKU and UPC', async () => {
      const barcodeReads = [
        {
          format: 'Code39',
          text: '03-4869MNP',
          hits: 1,
          box: { x: 100, y: 100, width: 200, height: 50 },
          engine: 'native' as const,
        },
        {
          format: 'Code39',
          text: '845436098432D',
          hits: 1,
          box: { x: 100, y: 200, width: 200, height: 50 },
          engine: 'native' as const,
        },
      ] as BarcodeReadArray;
      barcodeReads.laplacianVariance = 86;
      barcodeReads.engineUsed = 'native';

      const mockOcr: ClientOcrResult = {
        lines: [
          [
            { text: 'M QDEL:', box: { x: 614, y: 1756, width: 150, height: 30 }, confidence: 0.95 },
            {
              text: 'HUDSON E1 Step-Over',
              box: { x: 780, y: 1756, width: 250, height: 30 },
              confidence: 0.95,
            },
          ],
          [
            {
              text: '03-4869MN',
              box: { x: 948, y: 1238, width: 200, height: 30 },
              confidence: 0.93,
            },
          ],
        ],
        fullText: 'M QDEL: HUDSON E1 Step-Over\n03-4869MN\nJAMIS',
        extracted: {
          sku: '03-4869MN',
          upc: null,
          gtin: null,
          model: 'HUDSON E1 STEP-OVER',
          size: null,
          color: null,
          gw_kg: null,
          serial: null,
        },
        elapsedMs: 250,
      };

      vi.mocked(readBarcodesOffThread).mockResolvedValueOnce(barcodeReads);
      vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcr);

      const dummyBlob = new Blob(['hudson-test'], { type: 'image/jpeg' });
      const result = await recognizeLabelClient(dummyBlob, 'hudson-test.jpg');

      // Both Code 39 Mod-43 checks stripped and verified
      expect(result.extractedFields.sku).toBe('03-4869MN');
      expect(result.fieldSources.sku).toBe('barcode:native [Code39] (checksum mod-43 verificado)');
      expect(result.extractedFields.upc).toBe('845436098432');
      expect(result.fieldSources.upc).toBe('barcode:native [Code39] (checksum verificado)');
      expect(result.extractedFields.model).toBe('HUDSON E1 STEP-OVER');
      expect(result.fieldSources.model).toBe('ocr:pp-ocrv6');
    });

    it('arbitration: unconfirmed candidate NEVER displaces clean OCR; marks conflict if they disagree', async () => {
      // Code 39 string WITHOUT valid mod-43 checksum
      const barcodeReads = [
        {
          format: 'Code39',
          text: '03-9999ZZ',
          hits: 1,
          box: { x: 100, y: 100, width: 200, height: 50 },
          engine: 'native' as const,
        },
      ] as BarcodeReadArray;
      barcodeReads.laplacianVariance = 86;
      barcodeReads.engineUsed = 'native';

      // OCR read clean SKU 03-4869MN
      const mockOcr: ClientOcrResult = {
        lines: [],
        fullText: 'SKU: 03-4869MN',
        extracted: {
          sku: '03-4869MN',
          upc: null,
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: null,
          serial: null,
        },
        elapsedMs: 200,
      };

      vi.mocked(readBarcodesOffThread).mockResolvedValueOnce(barcodeReads);
      vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcr);

      const dummyBlob = new Blob(['conflict-test'], { type: 'image/jpeg' });
      const result = await recognizeLabelClient(dummyBlob, 'conflict-test.jpg');

      // Unconfirmed candidate did NOT silently displace OCR
      expect(result.extractedFields.sku).toBe(
        'CONFLICTO: candidato barras (03-9999ZZ) ≠ OCR (03-4869MN)'
      );
      expect(result.fieldSources.sku).toBe('conflicto: candidato barras ≠ OCR');
    });

    it('extracts HUDSON E1 Step-Over from spatial OcrItem[][] with noisy M QDEL: anchor', () => {
      const lines: OcrItem[][] = [
        [
          { text: 'M QDEL:', box: { x: 614, y: 1756, width: 140, height: 35 }, confidence: 0.94 },
          {
            text: 'HUDSON E1 Step-Over',
            box: { x: 780, y: 1756, width: 320, height: 35 },
            confidence: 0.96,
          },
        ],
        [{ text: '03-4869MN', box: { x: 948, y: 1238, width: 220, height: 35 }, confidence: 0.93 }],
        [
          {
            text: 'G.W.: 24.60 KG',
            box: { x: 500, y: 2100, width: 200, height: 35 },
            confidence: 0.95,
          },
        ],
      ];

      const extracted = extractFieldsFromOcrLines(lines);
      expect(extracted.model).toBe('HUDSON E1 STEP-OVER');
      expect(extracted.sku).toBe('03-4869MN');
      expect(extracted.gw_kg).toBe(24.6);
    });
  });

  describe('Sub-fase A3k: Multi-etiqueta, candidatos múltiples y señales contextuales de caja', () => {
    it('detects multiple SKU candidates, models, sizes and computes structural anchors for dual-label fixture', () => {
      // Dual-label fixture based on real photo:
      // Top: handwritten note '23" Allegro A3 / 01-0448'
      // Bottom: printed carton label Jamis DXT A1 Step-Over, SKU 03-3858BL
      const dualLabelLines: OcrItem[][] = [
        // Renglón 1 (manuscrito): '23" Allegro A3'
        [
          { text: '23"', box: { x: 280, y: 110, width: 95, height: 45 }, confidence: 0.92 },
          { text: 'Allegro A3', box: { x: 390, y: 110, width: 260, height: 45 }, confidence: 0.94 },
        ],
        // Renglón 2 (manuscrito): '01-0448'
        [{ text: '01-0448', box: { x: 340, y: 170, width: 220, height: 40 }, confidence: 0.95 }],
        // Renglón 3 (impreso): Marca JAMIS
        [{ text: 'JAMIS', box: { x: 180, y: 550, width: 220, height: 50 }, confidence: 0.99 }],
        // Renglón 4 (impreso): MODEL: DXT A1 Step-Over
        [
          { text: 'MODEL:', box: { x: 180, y: 620, width: 140, height: 35 }, confidence: 0.98 },
          {
            text: 'DXT A1 Step-Over',
            box: { x: 330, y: 620, width: 320, height: 35 },
            confidence: 0.97,
          },
        ],
        // Renglón 5 (impreso): ITEM NO.: 03-3858BL
        [
          { text: 'ITEM NO.:', box: { x: 180, y: 680, width: 160, height: 35 }, confidence: 0.96 },
          { text: '03-3858BL', box: { x: 350, y: 680, width: 240, height: 35 }, confidence: 0.98 },
        ],
        // Renglón 6 (impreso): SIZE: 700Cx18"
        [
          { text: 'SIZE:', box: { x: 180, y: 740, width: 100, height: 35 }, confidence: 0.97 },
          { text: '700Cx18"', box: { x: 290, y: 740, width: 180, height: 35 }, confidence: 0.96 },
        ],
        // Renglón 7 (impreso): COLOR: Deep Blue
        [
          { text: 'COLOR:', box: { x: 180, y: 800, width: 130, height: 35 }, confidence: 0.97 },
          { text: 'Deep Blue', box: { x: 320, y: 800, width: 190, height: 35 }, confidence: 0.98 },
        ],
        // Renglón 8 (impreso): UPC: 845436086651
        [
          { text: 'UPC:', box: { x: 180, y: 860, width: 90, height: 35 }, confidence: 0.96 },
          {
            text: '845436086651',
            box: { x: 280, y: 860, width: 260, height: 35 },
            confidence: 0.99,
          },
        ],
        // Renglón 9 (impreso): GTIN: 00845436086651
        [
          { text: 'GTIN:', box: { x: 180, y: 920, width: 100, height: 35 }, confidence: 0.96 },
          {
            text: '00845436086651',
            box: { x: 290, y: 920, width: 300, height: 35 },
            confidence: 0.99,
          },
        ],
        // Renglón 10 (impreso): QTY: 1 PC
        [{ text: 'QTY: 1 PC', box: { x: 180, y: 980, width: 170, height: 35 }, confidence: 0.95 }],
        // Renglón 11 (impreso): N.W.: 12.80 KG
        [
          {
            text: 'N.W.: 12.80 KG',
            box: { x: 180, y: 1040, width: 220, height: 35 },
            confidence: 0.96,
          },
        ],
        // Renglón 12 (impreso): G.W.: 15.40 KG
        [
          {
            text: 'G.W.: 15.40 KG',
            box: { x: 180, y: 1100, width: 220, height: 35 },
            confidence: 0.97,
          },
        ],
        // Renglón 13 (impreso): PORT: NEW YORK
        [
          {
            text: 'PORT: NEW YORK',
            box: { x: 180, y: 1160, width: 250, height: 35 },
            confidence: 0.95,
          },
        ],
      ];

      const imageDimensions = { width: 870, height: 1224 };
      const extracted = extractFieldsFromOcrLines(dualLabelLines, imageDimensions);

      // 1. Both SKUs must be collected
      expect(extracted.skuCandidates).toBeDefined();
      expect(extracted.skuCandidates!.length).toBe(2);
      const skus = extracted.skuCandidates!.map((c) => c.sku);
      expect(skus).toContain('01-0448');
      expect(skus).toContain('03-3858BL');

      // The handwritten 01-0448 (y=170) is far from carton anchors (y>=550)
      const candHandwritten = extracted.skuCandidates!.find((c) => c.sku === '01-0448')!;
      expect(candHandwritten.surroundingAnchors).toHaveLength(0);

      // The printed 03-3858BL (y=680) is surrounded by multiple carton anchors
      const candPrinted = extracted.skuCandidates!.find((c) => c.sku === '03-3858BL')!;
      expect(candPrinted.surroundingAnchors.length).toBeGreaterThanOrEqual(4);
      expect(candPrinted.surroundingAnchors).toContain('MODEL');
      expect(candPrinted.surroundingAnchors).toContain('SIZE');

      // 2. Multiple model candidates collected
      expect(extracted.allCandidates?.models.length).toBe(2);
      const modelNames = extracted.allCandidates?.models.map((m) => m.value);
      expect(modelNames).toContain('ALLEGRO A3');
      expect(modelNames).toContain('DXT A1 STEP-OVER');

      // 3. Multiple size candidates collected
      expect(extracted.allCandidates?.sizes.length).toBe(2);
      const sizeValues = extracted.allCandidates?.sizes.map((s) => s.value);
      expect(sizeValues).toContain('23"');
      expect(sizeValues).toContain('700Cx18"');

      // 4. Label ROI computed covering the printed carton label
      expect(extracted.labelRegion).toBeDefined();
      expect(extracted.labelRegion!.y).toBeGreaterThanOrEqual(500);

      // 5. Summary text output contains dedicated SKU candidates and multi-candidate sections
      const summary = buildSummaryText(
        { total: 450, barcodes: 120, ocr: 330 },
        { sizeBytes: 88000, type: 'image/jpeg', name: 'dual-label.jpg' },
        {
          sku: extracted.sku,
          upc: extracted.upc,
          serial: null,
          carton: null,
          order: null,
          factoryCode: null,
          model: extracted.model,
          size: extracted.size,
          color: extracted.color,
          gw_kg: extracted.gw_kg,
        },
        {},
        [],
        {
          lineCount: dualLabelLines.length,
          lines: dualLabelLines,
          imageDimensions,
          extracted,
        },
        [],
        {
          engineUsed: 'none',
          laplacianVariance: 411.2,
          roiLaplacianVariance: 185.6,
          labelRoi: extracted.labelRegion ?? undefined,
        },
        extracted.skuCandidates
      );

      expect(summary).toContain('CANDIDATOS DE SKU DETECTADOS (2):');
      expect(summary).toContain('SKU: 01-0448');
      expect(summary).toContain('SKU: 03-3858BL');
      expect(summary).toContain('Anclas estructurales cercanas (0): ninguna');
      expect(summary).toContain('DETALLE DE CANDIDATOS POR CAMPO:');
      expect(summary).toContain('Modelo (2 candidatos):');
      expect(summary).toContain('"ALLEGRO A3"');
      expect(summary).toContain('"DXT A1 STEP-OVER"');
      expect(summary).toContain('ROI etiqueta');
      expect(summary).toContain('Señales contextuales de etiqueta:');
      expect(summary).toContain('Líneas agrupadas: 13');
    });
  });
});
