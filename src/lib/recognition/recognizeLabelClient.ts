/**
 * Client-side label recognition engine (A3b-lib).
 *
 * Runs fully on-device in the browser with ZERO persistence.
 * Uses multi-pass zxing-wasm barcode reader + barcodeText semantic interpreter.
 */

import { type BarcodeRead } from './barcodes';
import { readBarcodesOffThread } from './useBarcodeReader';
import { interpretBarcode, type BarcodeMeaning } from './barcodeText';

export interface ClientRecognitionResult {
  timingMs: {
    total: number;
    barcodes: number;
  };
  device: {
    userAgent: string;
    platform: string;
    hardwareConcurrency?: number;
  };
  image: {
    sizeBytes: number;
    type: string;
    name?: string;
  };
  barcodes: {
    count: number;
    reads: Array<{
      format: string;
      text: string;
      hits: number;
      box: { x: number; y: number; width: number; height: number };
      meaning: BarcodeMeaning;
    }>;
  };
  extractedFields: {
    sku: string | null;
    upc: string | null;
    serial: string | null;
    carton: string | null;
    order: string | null;
    factoryCode: string | null;
    model: string | null;
    size: string | null;
    color: string | null;
    gw_kg: number | null;
  };
  fieldSources: Record<string, string>;
  summaryText: string;
}

export function buildSummaryText(
  timingMs: { total: number; barcodes: number },
  imageInfo: { sizeBytes: number; type: string; name?: string },
  extracted: ClientRecognitionResult['extractedFields'],
  fieldSources: Record<string, string>,
  barcodeReads: ClientRecognitionResult['barcodes']['reads']
): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Desconocido';
  const sizeMb = (imageInfo.sizeBytes / (1024 * 1024)).toFixed(2);
  const lines: string[] = [
    '=== TEST DE RECONOCIMIENTO DE ETIQUETAS (CLIENTE) ===',
    `Tiempo total: ${timingMs.total.toFixed(1)} ms (${(timingMs.total / 1000).toFixed(2)} s)`,
    `Desglose barras: ${timingMs.barcodes.toFixed(1)} ms`,
    `Foto: ${sizeMb} MB (${imageInfo.type || 'imagen'}) ${imageInfo.name ? `[${imageInfo.name}]` : ''}`,
    `Dispositivo: ${ua}`,
    '',
    'CAMPOS EXTRAÍDOS:',
    `- SKU: ${extracted.sku ? `${extracted.sku} [${fieldSources.sku ?? 'detectado'}]` : '—'}`,
    `- UPC: ${extracted.upc ? `${extracted.upc} [${fieldSources.upc ?? 'detectado'}]` : '—'}`,
    `- Serie / Frame: ${extracted.serial ? `${extracted.serial} [${fieldSources.serial ?? 'detectado'}]` : '—'}`,
    `- Cartón: ${extracted.carton ? `${extracted.carton} [${fieldSources.carton ?? 'detectado'}]` : '—'}`,
    `- Orden / PO: ${extracted.order ? `${extracted.order} [${fieldSources.order ?? 'detectado'}]` : '—'}`,
    `- Código fábrica: ${extracted.factoryCode ? `${extracted.factoryCode} [${fieldSources.factoryCode ?? 'detectado'}]` : '—'}`,
    `- Modelo: ${extracted.model ?? '—'}`,
    `- Talla: ${extracted.size ?? '—'}`,
    `- Color: ${extracted.color ?? '—'}`,
    `- G.W.: ${extracted.gw_kg != null ? `${extracted.gw_kg} kg` : '—'}`,
    '',
    `CÓDIGOS DETECTADOS (${barcodeReads.length}):`,
  ];

  if (barcodeReads.length === 0) {
    lines.push('  (Ningún código de barras detectado)');
  } else {
    barcodeReads.forEach((b, idx) => {
      lines.push(`  ${idx + 1}. [${b.format}] ${b.text} (hits: ${b.hits})`);
    });
  }
  lines.push('====================================================');
  return lines.join('\n');
}

/**
 * Execute client-side recognition on an image file/blob.
 * Measures timing with high-resolution timer.
 * Completely offline and self-contained; ZERO persistence.
 */
export async function recognizeLabelClient(
  image: Blob,
  fileName?: string
): Promise<ClientRecognitionResult> {
  const t0 = performance.now();

  // 1. Barcode reading pass (Worker off-thread, tile passes 2x2 and 3x3)
  const tBarcodes0 = performance.now();
  const rawBarcodeReads: BarcodeRead[] = await readBarcodesOffThread(image);
  const barcodesMs = performance.now() - tBarcodes0;

  // 2. Interpret barcodes
  const readsWithMeaning = rawBarcodeReads.map((r) => ({
    format: r.format,
    text: r.text,
    hits: r.hits,
    box: r.box,
    meaning: interpretBarcode(r.text, r.format),
  }));

  const extracted: ClientRecognitionResult['extractedFields'] = {
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

  const fieldSources: Record<string, string> = {};

  for (const item of readsWithMeaning) {
    const { format, meaning } = item;
    if (meaning.kind === 'upc' && !extracted.upc) {
      extracted.upc = meaning.upc;
      fieldSources.upc = `barcode:${format} (checksum verificado)`;
    } else if (meaning.kind === 'stock-number' && !extracted.sku) {
      extracted.sku = meaning.sku;
      fieldSources.sku = `barcode:${format}`;
    } else if (meaning.kind === 'factory-qr') {
      if (meaning.qr.frame && !extracted.serial) {
        extracted.serial = meaning.qr.frame;
        fieldSources.serial = `factory_qr:${format}`;
      }
      if (meaning.qr.carton && !extracted.carton) {
        extracted.carton = meaning.qr.carton;
        fieldSources.carton = `factory_qr:${format}`;
      }
      if (meaning.qr.order && !extracted.order) {
        extracted.order = meaning.qr.order;
        fieldSources.order = `factory_qr:${format}`;
      }
      if (meaning.qr.factoryCode && !extracted.factoryCode) {
        extracted.factoryCode = meaning.qr.factoryCode;
        fieldSources.factoryCode = `factory_qr:${format}`;
      }
    }
  }

  const totalMs = performance.now() - t0;
  const timingMs = {
    total: totalMs,
    barcodes: barcodesMs,
  };

  const imageInfo = {
    sizeBytes: image.size,
    type: image.type,
    name: fileName,
  };

  const summaryText = buildSummaryText(
    timingMs,
    imageInfo,
    extracted,
    fieldSources,
    readsWithMeaning
  );

  return {
    timingMs,
    device: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      platform: typeof navigator !== 'undefined' ? navigator.platform : '',
      hardwareConcurrency:
        typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
    },
    image: imageInfo,
    barcodes: {
      count: readsWithMeaning.length,
      reads: readsWithMeaning,
    },
    extractedFields: extracted,
    fieldSources,
    summaryText,
  };
}
