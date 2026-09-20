/**
 * Client-side label recognition engine (A3b-lib / A3h).
 *
 * Runs fully on-device in the browser with ZERO persistence.
 * Uses native BarcodeDetector (hardware) + multi-pass zxing-wasm fallback +
 * PP-OCRv6 OCR + OCR-guided targeted ROI cropping + deterministic fusion with
 * false positive safeguards (R11).
 */

import {
  getAnchorBarcodeRois,
  mergeReads,
  type BarcodeCandidateDiagnostic,
  type BarcodeRead,
  type BarcodeReadArray,
} from './barcodes';
import { readBarcodesOffThread } from './useBarcodeReader';
import { interpretBarcode, type BarcodeMeaning } from './barcodeText';
import {
  normalizeOcrDigits,
  runClientOcr,
  type ExtractedOcrFields,
  type OcrItem,
  type OcrServiceInitProfile,
} from './clientOcr';
import { classifyLapVar } from './imageFilters';

export interface ClientRecognitionResult {
  timingMs: {
    total: number;
    barcodes: number;
    barcodeInitialMs?: number;
    barcodeTargetedMs?: number;
    barcodeRotationUsed?: number;
    barcodeRetryMs?: number;
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
    engineUsed?: 'native' | 'zxing' | 'both' | 'none';
    laplacianVariance?: number;
    targetedRegionsCount?: number;
    rotationUsed?: number;
    reads: Array<{
      format: string;
      text: string;
      hits: number;
      box: { x: number; y: number; width: number; height: number };
      engine?: 'native' | 'zxing';
      meaning: BarcodeMeaning;
      confirmed?: boolean;
      confirmationReason?: string;
    }>;
    diagnostics?: Array<{
      format: string;
      error: string;
      box: { x: number; y: number; width: number; height: number };
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
    barcodeInitialMs?: number;
    barcodeTargetedMs?: number;
    barcodeRotationUsed?: number;
    barcodeRetryMs?: number;
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
  },
  barcodeDiagnostics?: BarcodeCandidateDiagnostic[],
  barcodeSummary?: {
    engineUsed?: 'native' | 'zxing' | 'both' | 'none';
    laplacianVariance?: number;
    targetedRegionsCount?: number;
  }
): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Desconocido';
  const sizeMb = (imageInfo.sizeBytes / (1024 * 1024)).toFixed(2);

  let barcodeTimingText = `Desglose barras: ${timingMs.barcodes.toFixed(1)} ms`;
  if (timingMs.barcodeRotationUsed != null && timingMs.barcodeRotationUsed !== 0) {
    barcodeTimingText += ` [rotación: ${timingMs.barcodeRotationUsed}°${timingMs.barcodeRetryMs ? `, reintento en ${timingMs.barcodeRetryMs.toFixed(0)} ms` : ''}]`;
  }

  // Diagnostic breakdown (A3h / R11 §5)
  const engineText =
    barcodeSummary?.engineUsed === 'both'
      ? 'barcode:native (hardware) + barcode:zxing (fallback WASM)'
      : barcodeSummary?.engineUsed === 'native'
        ? 'barcode:native (hardware)'
        : 'barcode:zxing (WASM)';

  barcodeTimingText += `\n  - Diagnóstico motor: ${engineText}`;
  if (timingMs.barcodeInitialMs != null) {
    barcodeTimingText += `\n  - Pasada inicial (completa): ${timingMs.barcodeInitialMs.toFixed(1)} ms`;
  }
  if (
    timingMs.barcodeTargetedMs != null ||
    (barcodeSummary?.targetedRegionsCount != null && barcodeSummary.targetedRegionsCount > 0)
  ) {
    const tMs = (timingMs.barcodeTargetedMs ?? 0).toFixed(1);
    const nReg = barcodeSummary?.targetedRegionsCount ?? 0;
    barcodeTimingText += `\n  - Intento dirigido (recortes OCR): ${tMs} ms (${nReg} ${nReg === 1 ? 'región' : 'regiones'} [Lanczos 3x + CLAHE + Unsharp])`;
  }
  if (timingMs.barcodeRetryMs != null && timingMs.barcodeRetryMs > 0) {
    barcodeTimingText += `\n  - Reintento rotación (${timingMs.barcodeRotationUsed ?? 90}°): ${timingMs.barcodeRetryMs.toFixed(1)} ms`;
  }
  if (barcodeSummary?.laplacianVariance != null) {
    barcodeTimingText += `\n  - Varianza Laplaciana (LapVar): ${classifyLapVar(barcodeSummary.laplacianVariance)}`;
  }

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
    barcodeTimingText,
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
    if (barcodeDiagnostics && barcodeDiagnostics.length > 0) {
      lines.push('  (Ningún código de barras válido detectado)');
      lines.push(`  Candidatos descartados (${barcodeDiagnostics.length}):`);
      barcodeDiagnostics.forEach((d) => {
        lines.push(
          `    - [${d.format}] Error: ${d.error || 'Inválido'} en caja [${d.box.width}×${d.box.height} px en (${d.box.x}, ${d.box.y})]`
        );
      });
    } else {
      lines.push('  (Ningún código de barras detectado)');
    }
  } else {
    barcodeReads.forEach((b, idx) => {
      let note = '';
      if (b.format === 'Code39' && !b.confirmed) {
        note = ' [aviso: Code 39 sin checksum, no confirmado]';
      } else if (b.format.startsWith('UPC') && !b.confirmed) {
        note = ' [aviso: checksum mod-10, no confirmado por OCR ni catálogo]';
      }
      lines.push(
        `  ${idx + 1}. [${b.format}] ${b.text} (motor: barcode:${b.engine ?? 'zxing'}, hits: ${b.hits})${note}`
      );
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
 * 1. Initial barcode pass (whole image, native BarcodeDetector first, zxing fallback).
 * 2. Client OCR pass (PP-OCRv6 tiny).
 * 3. OCR-guided targeted barcode crop pass (Lanczos 3x + CLAHE + Unsharp Masking).
 * 4. Rotated retry pass (if unrotated gave 0 reads and OCR found rotation != 0).
 * 5. False positive safeguards (Code 128 direct, Code 39 unconfirmed unless cross-checked, UPC-A candidate unless cross-checked).
 */
export async function recognizeLabelClient(
  image: Blob,
  fileName?: string
): Promise<ClientRecognitionResult> {
  const t0 = performance.now();

  // 1. Barcode reading pass 1: Initial pass on whole image
  const tBarcodes0 = performance.now();
  let rawBarcodeReads = (await readBarcodesOffThread(image, {
    grids: [2],
    captureDiagnostics: true,
  })) as BarcodeReadArray;
  const barcodeInitialMs = performance.now() - tBarcodes0;
  let barcodesMs = barcodeInitialMs;
  let barcodeTargetedMs = 0;
  let targetedRegionsCount = 0;
  let barcodeRotationUsed = 0;
  let barcodeRetryMs = 0;
  const laplacianVariance = rawBarcodeReads.laplacianVariance ?? 0;
  let engineUsed = rawBarcodeReads.engineUsed ?? 'none';

  // 2. Client OCR pass (PP-OCRv6 tiny via onnxruntime-web WASM)
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

    // 2.5. OCR-guided targeted barcode crop pass (A3h / R11 §2.4)
    // Find anchor regions near UPC:, GTIN:, ITEM:, SKU:
    const imageW = ocrRes.imageDimensions?.width ?? 1500;
    const imageH = ocrRes.imageDimensions?.height ?? 2000;
    const anchorRois = getAnchorBarcodeRois(ocrRes.lines, imageW, imageH);
    targetedRegionsCount = anchorRois.length;

    if (anchorRois.length > 0) {
      const tTargeted0 = performance.now();
      try {
        const targetedReads = (await readBarcodesOffThread(image, {
          targetedRois: anchorRois,
          skipFullPass: true,
          captureDiagnostics: true,
        })) as BarcodeReadArray;
        barcodeTargetedMs = performance.now() - tTargeted0;
        barcodesMs += barcodeTargetedMs;

        if (targetedReads && targetedReads.length > 0) {
          // Merge targeted reads into rawBarcodeReads
          const combined = [...rawBarcodeReads, ...targetedReads];
          const merged = mergeReads(combined) as BarcodeReadArray;
          if (targetedReads.diagnostics) {
            merged.diagnostics = [
              ...(rawBarcodeReads.diagnostics ?? []),
              ...targetedReads.diagnostics,
            ];
          } else {
            merged.diagnostics = rawBarcodeReads.diagnostics;
          }
          merged.laplacianVariance = laplacianVariance;
          rawBarcodeReads = merged;
          if (targetedReads.some((r) => r.engine === 'native')) {
            engineUsed = engineUsed === 'zxing' ? 'both' : 'native';
          }
        }
      } catch (tErr) {
        console.warn('[recognizeLabelClient] Targeted barcode crop error:', tErr);
      }
    }

    // 2.6. Barcode re-scan on rotated image (A3g):
    // If barcodes gave 0 reads on unrotated image and OCR found a winning rotation != 0,
    // retry barcode decoding with image oriented at that winning angle (e.g. 90° or 270°).
    if (rawBarcodeReads.length === 0 && ocrRes.rotationUsed && ocrRes.rotationUsed !== 0) {
      const tBarcodeRetry0 = performance.now();
      try {
        const retryReads = (await readBarcodesOffThread(image, {
          rotation: ocrRes.rotationUsed as 90 | 270,
          captureDiagnostics: true,
        })) as BarcodeReadArray;
        barcodeRetryMs = performance.now() - tBarcodeRetry0;
        barcodesMs += barcodeRetryMs;
        barcodeRotationUsed = ocrRes.rotationUsed;

        if (retryReads && retryReads.length > 0) {
          rawBarcodeReads = retryReads;
          rawBarcodeReads.laplacianVariance = laplacianVariance;
          if (retryReads.some((r) => r.engine === 'native')) {
            engineUsed = engineUsed === 'zxing' ? 'both' : 'native';
          }
        } else if (retryReads.diagnostics && retryReads.diagnostics.length > 0) {
          rawBarcodeReads.diagnostics = retryReads.diagnostics;
          barcodeRotationUsed = ocrRes.rotationUsed;
        }
      } catch (bErr) {
        console.warn('[recognizeLabelClient] Barcode rotation retry error:', bErr);
      }
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

  // 3. Interpret barcodes and apply False Positive Safeguards (A3h / R11 §6)
  const readsWithMeaning = rawBarcodeReads.map((r: BarcodeRead) => {
    const meaning = interpretBarcode(r.text, r.format);
    return {
      format: r.format,
      text: r.text,
      hits: r.hits,
      box: r.box,
      engine: r.engine ?? 'zxing',
      meaning,
      confirmed: false,
      confirmationReason: undefined as string | undefined,
    };
  });

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

  let unconfirmedSkuCandidate: { sku: string; engine: string; format: string } | null = null;
  let unconfirmedUpcCandidate: { upc: string; engine: string; format: string } | null = null;

  // Safeguards evaluation per R11 / A3j:
  for (const item of readsWithMeaning) {
    const { format, meaning, engine } = item;

    // 1. Code 128: undetectable error rate < 6e-4 -> accepted direct
    if (format === 'Code128' || format === 'QRCode') {
      if (meaning.kind === 'stock-number' && !extracted.sku) {
        extracted.sku = meaning.sku;
        fieldSources.sku = `barcode:${engine} [${format}]`;
        item.confirmed = true;
        item.confirmationReason = 'Code 128 paridad matemática (<6e-4)';
      } else if (meaning.kind === 'upc' && !extracted.upc) {
        extracted.upc = meaning.upc;
        fieldSources.upc = `barcode:${engine} [${format}] (checksum verificado)`;
        item.confirmed = true;
        item.confirmationReason = 'Code 128 checksum ponderado mod-103';
      }
    }

    // 2. Code 39: check optional Mod-43 checksum (A3j)
    else if (format === 'Code39') {
      const isMod43 = !!meaning.mod43Verified;

      if (isMod43) {
        // Code 39 with verified mod-43 check digit: treated as VERIFIED (not unconfirmed)
        item.confirmed = true;
        item.confirmationReason = 'Code 39 checksum mod-43 verificado';

        if (meaning.kind === 'stock-number' && !extracted.sku) {
          extracted.sku = meaning.sku;
          fieldSources.sku = `barcode:${engine} [Code39] (checksum mod-43 verificado)`;
        } else if (meaning.kind === 'upc' && !extracted.upc) {
          extracted.upc = meaning.upc;
          fieldSources.upc = `barcode:${engine} [Code39] (checksum verificado)`;
          item.confirmationReason = 'Code 39 mod-43 y UPC mod-10 verificados';
        }
      } else {
        // Code 39 without checksum: candidate requiring confirmation
        let confirmedBy: string | null = null;
        if (rawBarcodeReads.some((r) => r.format === 'QRCode' && r.text.includes(item.text))) {
          confirmedBy = 'QR';
        } else if (
          ocrData?.extracted?.sku &&
          ocrData.extracted.sku.replace(/[^A-Z0-9]/gi, '') === item.text.replace(/[^A-Z0-9]/gi, '')
        ) {
          confirmedBy = 'OCR';
        } else if (
          ocrData?.extracted?.serial &&
          ocrData.extracted.serial.replace(/[^A-Z0-9]/gi, '') ===
            item.text.replace(/[^A-Z0-9]/gi, '')
        ) {
          confirmedBy = 'OCR (serie)';
        }

        if (meaning.kind === 'stock-number') {
          if (confirmedBy) {
            extracted.sku = meaning.sku;
            fieldSources.sku = `barcode:${engine} [Code39] (confirmado por ${confirmedBy})`;
            item.confirmed = true;
            item.confirmationReason = `Confirmado por ${confirmedBy}`;
          } else {
            item.confirmed = false;
            item.confirmationReason = 'Code 39 sin checksum: no confirmado por QR, OCR ni catálogo';
            if (!unconfirmedSkuCandidate) {
              unconfirmedSkuCandidate = { sku: meaning.sku, engine, format };
            }
          }
        }
      }
    }

    // 3. UPC-A / EAN-13: Checksum mod-10 passes 1 in 10 multi-digit errors.
    // Must be cross-confirmed by OCR or catalog to be marked confirmed
    else if (meaning.kind === 'upc' && !extracted.upc) {
      let confirmedBy: string | null = null;
      const barcodeUpcNorm = normalizeOcrDigits(meaning.upc);

      if (ocrData?.extracted?.upc && normalizeOcrDigits(ocrData.extracted.upc) === barcodeUpcNorm) {
        confirmedBy = 'OCR (UPC directo)';
      } else if (
        ocrData?.extracted?.gtin &&
        normalizeOcrDigits(ocrData.extracted.gtin).endsWith(barcodeUpcNorm)
      ) {
        confirmedBy = 'OCR (GTIN-14)';
      }

      if (confirmedBy) {
        extracted.upc = meaning.upc;
        fieldSources.upc = `barcode:${engine} [${format}] (checksum verificado, confirmado por ${confirmedBy})`;
        item.confirmed = true;
        item.confirmationReason = `Checksum mod-10 verificado, confirmado por ${confirmedBy}`;
      } else {
        item.confirmed = false;
        item.confirmationReason =
          'Checksum mod-10 verificado, pendiente de confirmación por OCR o catálogo';
        if (!unconfirmedUpcCandidate) {
          unconfirmedUpcCandidate = { upc: meaning.upc, engine, format };
        }
      }
    }

    // Factory QR
    if (meaning.kind === 'factory-qr') {
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

  // 4. Fusion logic: Barcodes have priority if validated; OCR fills catalog fields & fallback text.
  // Under R10 Section 4 Case B: An unconfirmed candidate NEVER silently displaces an OCR reading.
  if (ocrData?.extracted) {
    const ocrExtracted = ocrData.extracted;
    if (ocrExtracted.model && !extracted.model) {
      extracted.model = ocrExtracted.model;
      fieldSources.model = 'ocr:pp-ocrv6';
    }
    if (ocrExtracted.size && !extracted.size) {
      extracted.size = ocrExtracted.size;
      fieldSources.size = 'ocr:pp-ocrv6';
    }
    if (ocrExtracted.color && !extracted.color) {
      extracted.color = ocrExtracted.color;
      fieldSources.color = 'ocr:pp-ocrv6';
    }
    if (ocrExtracted.gw_kg != null && extracted.gw_kg == null) {
      extracted.gw_kg = ocrExtracted.gw_kg;
      fieldSources.gw_kg = 'ocr:pp-ocrv6';
    }

    // SKU arbitration:
    if (!extracted.sku) {
      if (unconfirmedSkuCandidate && ocrExtracted.sku) {
        const candNorm = unconfirmedSkuCandidate.sku.replace(/[^A-Z0-9]/gi, '');
        const ocrNorm = ocrExtracted.sku.replace(/[^A-Z0-9]/gi, '');
        if (candNorm === ocrNorm) {
          extracted.sku = unconfirmedSkuCandidate.sku;
          fieldSources.sku = `barcode:${unconfirmedSkuCandidate.engine} [${unconfirmedSkuCandidate.format}] (confirmado por OCR)`;
        } else {
          // Discrepancy! Under R10 Section 4 Case B, never silently displace. Mark conflict and report both!
          extracted.sku = `CONFLICTO: candidato barras (${unconfirmedSkuCandidate.sku}) ≠ OCR (${ocrExtracted.sku})`;
          fieldSources.sku = 'conflicto: candidato barras ≠ OCR';
        }
      } else if (ocrExtracted.sku) {
        extracted.sku = ocrExtracted.sku;
        fieldSources.sku = 'ocr:pp-ocrv6 (texto plano)';
      } else if (unconfirmedSkuCandidate) {
        extracted.sku = unconfirmedSkuCandidate.sku;
        fieldSources.sku = `candidato barcode:${unconfirmedSkuCandidate.engine} [${unconfirmedSkuCandidate.format}] (sin checksum, no confirmado por QR/OCR/catálogo)`;
      }
    }

    // UPC arbitration:
    if (!extracted.upc) {
      if (unconfirmedUpcCandidate && ocrExtracted.upc) {
        const candDigits = normalizeOcrDigits(unconfirmedUpcCandidate.upc);
        const ocrDigits = normalizeOcrDigits(ocrExtracted.upc);
        if (candDigits === ocrDigits) {
          extracted.upc = unconfirmedUpcCandidate.upc;
          fieldSources.upc = `barcode:${unconfirmedUpcCandidate.engine} [${unconfirmedUpcCandidate.format}] (checksum verificado, confirmado por OCR)`;
        } else {
          extracted.upc = `CONFLICTO: candidato barras (${unconfirmedUpcCandidate.upc}) ≠ OCR (${ocrExtracted.upc})`;
          fieldSources.upc = 'conflicto: candidato barras ≠ OCR';
        }
      } else if (ocrExtracted.upc) {
        extracted.upc = ocrExtracted.upc;
        if (ocrExtracted.upcConflict || ocrExtracted.upc.startsWith('CONFLICTO')) {
          fieldSources.upc = 'ocr:pp-ocrv6 (conflicto: UPC directo ≠ GTIN)';
        } else {
          fieldSources.upc = 'ocr:pp-ocrv6 (checksum verificado)';
        }
      } else if (unconfirmedUpcCandidate) {
        extracted.upc = unconfirmedUpcCandidate.upc;
        fieldSources.upc = `candidato barcode:${unconfirmedUpcCandidate.engine} [${unconfirmedUpcCandidate.format}] (checksum mod-10, no confirmado por OCR ni catálogo)`;
      }
    }

    if (ocrExtracted.gtin && !extracted.gtin) {
      extracted.gtin = ocrExtracted.gtin;
      fieldSources.gtin = 'ocr:pp-ocrv6';
    }
    if (!extracted.serial && ocrExtracted.serial) {
      extracted.serial = ocrExtracted.serial;
      fieldSources.serial = 'ocr:pp-ocrv6 (texto plano)';
    }
  } else {
    // When no OCR data was provided, populate unconfirmed candidates if fields are empty
    if (!extracted.sku && unconfirmedSkuCandidate) {
      extracted.sku = unconfirmedSkuCandidate.sku;
      fieldSources.sku = `candidato barcode:${unconfirmedSkuCandidate.engine} [${unconfirmedSkuCandidate.format}] (sin checksum, no confirmado por QR/OCR/catálogo)`;
    }
    if (!extracted.upc && unconfirmedUpcCandidate) {
      extracted.upc = unconfirmedUpcCandidate.upc;
      fieldSources.upc = `candidato barcode:${unconfirmedUpcCandidate.engine} [${unconfirmedUpcCandidate.format}] (checksum mod-10, no confirmado por OCR ni catálogo)`;
    }
  }

  const totalMs = performance.now() - t0;
  const timingMs: ClientRecognitionResult['timingMs'] = {
    total: totalMs,
    barcodes: barcodesMs,
    barcodeInitialMs,
    barcodeTargetedMs: barcodeTargetedMs > 0 ? barcodeTargetedMs : undefined,
    barcodeRotationUsed: barcodeRotationUsed !== 0 ? barcodeRotationUsed : undefined,
    barcodeRetryMs: barcodeRetryMs > 0 ? barcodeRetryMs : undefined,
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
      : undefined,
    rawBarcodeReads.diagnostics,
    {
      engineUsed,
      laplacianVariance,
      targetedRegionsCount,
    }
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
      engineUsed,
      laplacianVariance,
      targetedRegionsCount,
      rotationUsed: barcodeRotationUsed !== 0 ? barcodeRotationUsed : undefined,
      reads: readsWithMeaning,
      diagnostics: rawBarcodeReads.diagnostics,
    },
    ocr: ocrData,
    extractedFields: extracted,
    fieldSources,
    summaryText,
  };
}
