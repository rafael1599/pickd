import { describe, it, expect, vi } from 'vitest';
import { buildSummaryText, recognizeLabelClient } from '../recognizeLabelClient';
import { extractFieldsFromOcrLines, type OcrItem, runClientOcr } from '../clientOcr';
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
