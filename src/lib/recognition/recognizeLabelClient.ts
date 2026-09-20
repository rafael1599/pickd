/**
 * Client-side label recognition engine (A3b-lib).
 *
 * Runs fully on-device in the browser with ZERO persistence.
 * Uses multi-pass zxing-wasm barcode reader + browser PP-OCRv6 OCR + deterministic fusion.
 */

import { type BarcodeRead } from './barcodes';
import { readBarcodesOffThread } from './useBarcodeReader';
import { interpretBarcode, type BarcodeMeaning } from './barcodeText';
import {
  runClientOcr,
  type ExtractedOcrFields,
  type OcrItem,
  type OcrServiceInitProfile,
} from './clientOcr';

export interface ClientRecognitionResult {
  timingMs: {
    total: number;
    barcodes: number;
    ocr: number;
    ocrProfile?: {
      imageDecodeMs: number;
      serviceInitMs: number;
      serviceInitDetails?: OcrServiceInitProfile;
    };
    ocrAttempts?: {
      rotation: number;
      elapsedMs: number;
      anchorsFound: number;
      canvasPrepMs?: number;
      recognizeMs?: number;
      groupingMs?: number;
      extractionMs?: number;
    }[];
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
  ocr?: {
    lineCount: number;
    lines?: OcrItem[][];
    fullText: string;
    extracted: ExtractedOcrFields;
    rotationUsed?: number;
    attempts?: {
      rotation: number;
      elapsedMs: number;
      anchorsFound: number;
      canvasPrepMs?: number;
      recognizeMs?: number;
      groupingMs?: number;
      extractionMs?: number;
    }[];
    imageDimensions?: {
      width: number;
      height: number;
    };
    error?: string;
  };
  extractedFields: {
    sku: string | null;
    upc: string | null;
    gtin?: string | null;
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
  timingMs: {
    total: number;
    barcodes: number;
    ocr: number;
    ocrProfile?: {
      imageDecodeMs: number;
      serviceInitMs: number;
      serviceInitDetails?: OcrServiceInitProfile;
    };
    ocrAttempts?: {
      rotation: number;
      elapsedMs: number;
      canvasPrepMs?: number;
      recognizeMs?: number;
      groupingMs?: number;
      extractionMs?: number;
      anchorsFound?: number;
    }[];
  },
  imageInfo: { sizeBytes: number; type: string; name?: string },
  extracted: ClientRecognitionResult['extractedFields'],
  fieldSources: Record<string, string>,
  barcodeReads: ClientRecognitionResult['barcodes']['reads'],
  ocrSummary?: {
    lineCount: number;
    lines?: OcrItem[][];
    rotationUsed?: number;
    imageDimensions?: { width: number; height: number };
    error?: string;
  }
): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Desconocido';
  const sizeMb = (imageInfo.sizeBytes / (1024 * 1024)).toFixed(2);

  let ocrTimingText = `Desglose OCR: ${timingMs.ocr.toFixed(1)} ms`;
  if (ocrSummary?.rotationUsed != null) {
    ocrTimingText += ` [rotación: ${ocrSummary.rotationUsed}°`;
    if (timingMs.ocrAttempts && timingMs.ocrAttempts.length > 1) {
      ocrTimingText += `, reintentos: ${timingMs.ocrAttempts
        .map((a) => `${a.rotation}° en ${a.elapsedMs.toFixed(0)} ms`)
        .join(', ')}`;
    }
    ocrTimingText += `]`;
  }
  if (ocrSummary?.error) {
    ocrTimingText += ` (Error: ${ocrSummary.error})`;
  }
  if (timingMs.ocrProfile) {
    ocrTimingText += `\n  - Decodificación imagen: ${timingMs.ocrProfile.imageDecodeMs.toFixed(1)} ms`;
    const d = timingMs.ocrProfile.serviceInitDetails;
    if (d) {
      const waitMs = timingMs.ocrProfile.serviceInitMs;
      ocrTimingText += `\n  - Inicialización modelo/WASM: ${waitMs.toFixed(1)} ms (espera bloqueante) [trabajo real: ${d.totalInitMs.toFixed(1)} ms]`;
      const wasmSrc = d.wasmSource === 'cache' ? 'cache' : 'red';
      const modelSrc = d.modelsSource === 'cache' ? 'cache' : 'red';
      ocrTimingText += `\n    * Chunks WASM: ${d.wasmFetchOrReadMs.toFixed(1)} ms [${wasmSrc}]`;
      ocrTimingText += `\n    * Reensamblado binario: ${d.wasmReassembleMs.toFixed(1)} ms`;
      ocrTimingText += `\n    * Runtime ONNX: ${d.ortInitMs.toFixed(1)} ms`;
      ocrTimingText += `\n    * Carga modelos PP-OCRv6: ${d.modelsLoadMs.toFixed(1)} ms [${modelSrc}]`;
    } else {
      ocrTimingText += `\n  - Inicialización modelo/WASM: ${timingMs.ocrProfile.serviceInitMs.toFixed(1)} ms`;
    }
  }
  if (timingMs.ocrAttempts && timingMs.ocrAttempts.length > 0) {
    for (const a of timingMs.ocrAttempts) {
      if (a.recognizeMs != null) {
        ocrTimingText += `\n  - Intento ${a.rotation}°: ${a.elapsedMs.toFixed(1)} ms (inferencia: ${a.recognizeMs.toFixed(1)} ms, canvas: ${(a.canvasPrepMs ?? 0).toFixed(1)} ms, anclas: ${a.anchorsFound ?? 0})`;
      }
    }
  }

  const lines: string[] = [
    '=== TEST DE RECONOCIMIENTO DE ETIQUETAS (CLIENTE) ===',
    `Tiempo total: ${timingMs.total.toFixed(1)} ms (${(timingMs.total / 1000).toFixed(2)} s)`,
    `Desglose barras: ${timingMs.barcodes.toFixed(1)} ms`,
    ocrTimingText,
    `Foto: ${sizeMb} MB (${imageInfo.type || 'imagen'}) ${imageInfo.name ? `[${imageInfo.name}]` : ''}${ocrSummary?.imageDimensions ? ` [${ocrSummary.imageDimensions.width}×${ocrSummary.imageDimensions.height} px, escala 1:1]` : ''}`,
    `Dispositivo: ${ua}`,
    '',
    'CAMPOS EXTRAÍDOS:',
    `- SKU: ${extracted.sku ? `${extracted.sku} [${fieldSources.sku ?? 'detectado'}]` : '—'}`,
    `- UPC: ${extracted.upc ? `${extracted.upc} [${fieldSources.upc ?? 'detectado'}]` : '—'}`,
    `- Serie / Frame: ${extracted.serial ? `${extracted.serial} [${fieldSources.serial ?? 'detectado'}]` : '—'}`,
    `- Cartón: ${extracted.carton ? `${extracted.carton} [${fieldSources.carton ?? 'detectado'}]` : '—'}`,
    `- Orden / PO: ${extracted.order ? `${extracted.order} [${fieldSources.order ?? 'detectado'}]` : '—'}`,
    `- Código fábrica: ${extracted.factoryCode ? `${extracted.factoryCode} [${fieldSources.factoryCode ?? 'detectado'}]` : '—'}`,
    `- Modelo: ${extracted.model ? `${extracted.model} [${fieldSources.model ?? 'detectado'}]` : '—'}`,
    `- Talla: ${extracted.size ? `${extracted.size} [${fieldSources.size ?? 'detectado'}]` : '—'}`,
    `- Color: ${extracted.color ? `${extracted.color} [${fieldSources.color ?? 'detectado'}]` : '—'}`,
    `- G.W.: ${extracted.gw_kg != null ? `${extracted.gw_kg} kg [${fieldSources.gw_kg ?? 'detectado'}]` : '—'}`,
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

  // Always include the raw OCR lines structure in copied summary text (A3e / A3g)
  lines.push('');
  lines.push(`ESTRUCTURA CRUDA OCR (${ocrSummary?.lines?.length ?? 0} líneas agrupadas):`);
  lines.push(JSON.stringify(ocrSummary?.lines ?? [], null, 2));

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

  // Barcode results have maximum priority if checksum or barcode format validates
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

  // 3. Client OCR pass (PP-OCRv6 tiny via onnxruntime-web WASM)
  let ocrMs = 0;
  let ocrData: ClientRecognitionResult['ocr'] | undefined = undefined;
  let ocrProfile: ClientRecognitionResult['timingMs']['ocrProfile'] = undefined;

  const tOcr0 = performance.now();
  try {
    const ocrRes = await runClientOcr(image);
    ocrMs = performance.now() - tOcr0;
    ocrProfile = ocrRes.profile;
    ocrData = {
      lineCount: ocrRes.lines.length,
      lines: ocrRes.lines,
      fullText: ocrRes.fullText,
      extracted: ocrRes.extracted,
      rotationUsed: ocrRes.rotationUsed,
      attempts: ocrRes.attempts,
      imageDimensions: ocrRes.imageDimensions,
    };

    // 4. Fusion logic: Barcodes have priority if validated; OCR fills catalog fields & fallback text
    if (ocrRes.extracted.model && !extracted.model) {
      extracted.model = ocrRes.extracted.model;
      fieldSources.model = 'ocr:pp-ocrv6';
    }
    if (ocrRes.extracted.size && !extracted.size) {
      extracted.size = ocrRes.extracted.size;
      fieldSources.size = 'ocr:pp-ocrv6';
    }
    if (ocrRes.extracted.color && !extracted.color) {
      extracted.color = ocrRes.extracted.color;
      fieldSources.color = 'ocr:pp-ocrv6';
    }
    if (ocrRes.extracted.gw_kg != null && extracted.gw_kg == null) {
      extracted.gw_kg = ocrRes.extracted.gw_kg;
      fieldSources.gw_kg = 'ocr:pp-ocrv6';
    }

    // Fallbacks for SKU, UPC, Serial if not detected by barcode
    if (!extracted.sku && ocrRes.extracted.sku) {
      extracted.sku = ocrRes.extracted.sku;
      fieldSources.sku = 'ocr:pp-ocrv6 (texto plano)';
    }
    if (!extracted.upc && ocrRes.extracted.upc) {
      extracted.upc = ocrRes.extracted.upc;
      if (ocrRes.extracted.upcConflict || ocrRes.extracted.upc.startsWith('CONFLICTO')) {
        fieldSources.upc = 'ocr:pp-ocrv6 (conflicto: UPC directo ≠ GTIN)';
      } else {
        fieldSources.upc = 'ocr:pp-ocrv6 (checksum verificado)';
      }
    }
    if (ocrRes.extracted.gtin && !extracted.gtin) {
      extracted.gtin = ocrRes.extracted.gtin;
      fieldSources.gtin = 'ocr:pp-ocrv6';
    }
    if (!extracted.serial && ocrRes.extracted.serial) {
      extracted.serial = ocrRes.extracted.serial;
      fieldSources.serial = 'ocr:pp-ocrv6 (texto plano)';
    }
  } catch (err: unknown) {
    ocrMs = performance.now() - tOcr0;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[recognizeLabelClient] OCR pass failed or not available:', msg);
    ocrData = {
      lineCount: 0,
      lines: [],
      fullText: '',
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
      error: msg,
    };
  }

  const totalMs = performance.now() - t0;
  const timingMs: ClientRecognitionResult['timingMs'] = {
    total: totalMs,
    barcodes: barcodesMs,
    ocr: ocrMs,
    ocrProfile,
    ocrAttempts: ocrData?.attempts,
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
    readsWithMeaning,
    ocrData
      ? {
          lineCount: ocrData.lineCount,
          lines: ocrData.lines,
          rotationUsed: ocrData.rotationUsed,
          imageDimensions: ocrData.imageDimensions,
          error: ocrData.error,
        }
      : undefined
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
    ocr: ocrData,
    extractedFields: extracted,
    fieldSources,
    summaryText,
  };
}
