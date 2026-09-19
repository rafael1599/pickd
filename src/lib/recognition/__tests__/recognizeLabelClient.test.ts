import { describe, it, expect } from 'vitest';
import { buildSummaryText } from '../recognizeLabelClient';

describe('buildSummaryText', () => {
  it('formats full plain text summary correctly for clipboard', () => {
    const timingMs = { total: 142.5, barcodes: 95.2 };
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

    const summary = buildSummaryText(timingMs, imageInfo, extracted, fieldSources, barcodes);

    expect(summary).toContain('=== TEST DE RECONOCIMIENTO DE ETIQUETAS (CLIENTE) ===');
    expect(summary).toContain('142.5 ms');
    expect(summary).toContain('photo-14.jpg');
    expect(summary).toContain('09-4807CL');
    expect(summary).toContain('845436091679');
    expect(summary).toContain('WMEI00094');
    expect(summary).toContain('R161');
    expect(summary).toContain('RENEGADE S1 FRAMEKIT');
    expect(summary).toContain('CÓDIGOS DETECTADOS (2):');
    expect(summary).toContain('[Code39] 09-4807CL (hits: 2)');
    expect(summary).toContain(
      '[QRCode] 0123JC-7RS1-G541,WMEI00094,1,SET,R161,A23JC-938,0009 (hits: 3)'
    );
  });

  it('handles empty barcodes gracefully', () => {
    const timingMs = { total: 45.0, barcodes: 45.0 };
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
    const summary = buildSummaryText(timingMs, imageInfo, extracted, {}, []);
    expect(summary).toContain('CÓDIGOS DETECTADOS (0):');
    expect(summary).toContain('Ningún código de barras detectado');
  });
});
