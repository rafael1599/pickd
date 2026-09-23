/**
 * Multi-Box Client Recognition Engine (Sub-fase O-2).
 *
 * Receives an image of one or more carton boxes (e.g. front of a pallet),
 * isolates each box/label into a discrete 2D spatial region using `labelSegmenter`,
 * and executes independent multimodal recognition (Barcode + PP-OCRv6 + Catalog)
 * for each box.
 *
 * Architectural Principles (Point 3 / O-2 Review):
 * - Un valor que viene del CATÁLOGO y un valor que viene de la FOTO no son el
 *   mismo dato y NUNCA deben colapsarse en el mismo campo.
 * - Cada campo preserva su procedencia explícita (`photoValue`, `catalogValue`, `source`).
 * - Cuando ambos existan y difieran (ej. catálogo=23", foto=14"), eso es una
 *   señal independiente de DISCREPANCIA (alerta), nunca un empate a resolver en silencio.
 */

import {
  extractFieldsFromOcrLines,
  groupLinesBySpatialProximity,
  runClientOcr,
  type ExtractedOcrFields,
  type OcrBox,
  type OcrItem,
  type ClientOcrResult,
} from './clientOcr';
import { segmentLabels2D, type LabelCluster } from './labelSegmenter';
import type { BarcodeRead } from './barcodes';
import { readBarcodesOffThread } from './useBarcodeReader';
import { checkCode39Mod43, interpretBarcode, parseJamisFactoryQr } from './barcodeText';
import {
  lookupCatalogSku,
  compareField,
  type CatalogLookupResult,
} from '../../features/recognition/catalogLookup';

export type FieldProvenanceStatus =
  | 'match'
  | 'discrepancy'
  | 'photo_only'
  | 'catalog_only'
  | 'unresolved';

export interface FieldWithProvenance<T = string> {
  photoValue: T | null;
  catalogValue: T | null;
  source: string;
  status: FieldProvenanceStatus;
  discrepancyDetail?: string;
}

export interface DetectedBoxResult {
  boxIndex: number; // 1-indexed (1..N)
  id: string; // 'box-1', 'box-2'
  bbox: OcrBox;
  itemCount: number;
  anchors: string[];
  anchorsCount: number;

  sku: FieldWithProvenance<string>;
  model: FieldWithProvenance<string>;
  size: FieldWithProvenance<string>;
  color: FieldWithProvenance<string>;

  upc: { value: string | null; source: string };
  gtin: { value: string | null; source: string };
  gw_kg: { value: number | null; source: string };
  serial: { value: string | null; source: string };
  carton: { value: string | null; source: string };
  po: { value: string | null; source: string };

  barcodeCount: number;
  barcodes: BarcodeRead[];
  catalogStatus: 'found' | 'not_found' | 'error' | 'skipped';
  catalogData?: CatalogLookupResult['data'];
  rawCluster: LabelCluster;
  extractedOcr: ExtractedOcrFields;
}

export interface MultiBoxClientResult {
  totalBoxes: number;
  boxes: DetectedBoxResult[];
  discrepanciesCount: number;
  timingMs: {
    total: number;
    barcodes: number;
    ocr: number;
    segmentation: number;
    catalog: number;
  };
  image: {
    name: string;
    sizeBytes: number;
    type: string;
    width?: number;
    height?: number;
    /**
     * The rotation the OCR cascade settled on. Every `bbox` below is in *that*
     * frame, not in the photo's — a reader that wants to draw on the photo has
     * to undo it first (`overlayBoxes.ts`). It is 0 for an upright photo, which
     * is every pallet shot taken standing in front of the load.
     */
    rotationUsed?: number;
  };
  summaryText: string;
}

export interface RecognizeMultiBoxOptions {
  onProgress?: (step: string) => void;
  minItemsPerBox?: number;
  /**
   * Fires as each label finishes, before the whole photo is done.
   *
   * The catalogue is asked one label at a time, so the last one can be a second
   * or two behind the first. Somebody standing in front of the pallet gets to
   * watch them light up instead of watching a spinner — and a label that lights
   * up is already an answer, even if the one below it is still being read.
   */
  onBox?: (box: DetectedBoxResult, totalExpected: number) => void;
}

/**
 * Checks if a barcode box is spatially associated with a label cluster.
 */
export function isBarcodeAssociatedWithCluster(
  barcodeBox: OcrBox,
  clusterBbox: OcrBox,
  margin = 75
): boolean {
  const bCenterX = barcodeBox.x + barcodeBox.width / 2;
  const bCenterY = barcodeBox.y + barcodeBox.height / 2;

  return (
    bCenterX >= clusterBbox.x - margin &&
    bCenterX <= clusterBbox.x + clusterBbox.width + margin &&
    bCenterY >= clusterBbox.y - margin &&
    bCenterY <= clusterBbox.y + clusterBbox.height + margin
  );
}

/**
 * Formats full plain-text summary of all detected boxes for clipboard copying.
 */
export function buildMultiBoxSummaryText(
  result: Omit<MultiBoxClientResult, 'summaryText'>
): string {
  const lines: string[] = [];
  const dimStr =
    result.image.width && result.image.height
      ? ` (${result.image.width}×${result.image.height} px, ${(result.image.sizeBytes / 1024).toFixed(0)} KB)`
      : ` (${(result.image.sizeBytes / 1024).toFixed(0)} KB)`;

  lines.push('====================================================');
  lines.push(
    `=== RECONOCIMIENTO MULTI-CAJA (${result.totalBoxes} ${result.totalBoxes === 1 ? 'CAJA DETECTADA' : 'CAJAS DETECTADAS'}) ===`
  );
  lines.push('====================================================');
  lines.push(`Foto: ${result.image.name}${dimStr}`);
  lines.push(
    `Tiempo total: ${(result.timingMs.total / 1000).toFixed(2)}s (barras: ${result.timingMs.barcodes.toFixed(0)}ms, OCR: ${result.timingMs.ocr.toFixed(0)}ms, segmentación: ${result.timingMs.segmentation.toFixed(0)}ms, catálogo: ${result.timingMs.catalog.toFixed(0)}ms)`
  );
  lines.push('');

  const allDiscrepancies: Array<{ boxIndex: number; field: string; detail: string }> = [];

  for (const box of result.boxes) {
    lines.push('----------------------------------------------------');
    lines.push(
      `CAJA ${box.boxIndex} DE ${result.totalBoxes} [BBox: x=${box.bbox.x}, y=${box.bbox.y}, w=${box.bbox.width}, h=${box.bbox.height} | Anclas: ${box.anchors.length > 0 ? box.anchors.join(', ') : 'ninguna'} (${box.anchorsCount})]`
    );
    lines.push('----------------------------------------------------');

    // SKU
    if (box.sku.photoValue) {
      lines.push(`SKU: ${box.sku.photoValue} [${box.sku.source}]`);
    } else {
      lines.push('SKU: (no detectado en foto)');
    }

    // Model
    const modelTag = formatProvenanceTag(box.model);
    lines.push(`Modelo: ${box.model.photoValue ?? box.model.catalogValue ?? '—'} ${modelTag}`);
    if (box.model.status === 'discrepancy' && box.model.discrepancyDetail) {
      allDiscrepancies.push({
        boxIndex: box.boxIndex,
        field: 'Modelo',
        detail: box.model.discrepancyDetail,
      });
    }

    // Size
    const sizeTag = formatProvenanceTag(box.size);
    lines.push(`Talla: ${box.size.photoValue ?? box.size.catalogValue ?? '—'} ${sizeTag}`);
    if (box.size.status === 'discrepancy' && box.size.discrepancyDetail) {
      allDiscrepancies.push({
        boxIndex: box.boxIndex,
        field: 'Talla',
        detail: box.size.discrepancyDetail,
      });
    }

    // Color
    const colorTag = formatProvenanceTag(box.color);
    lines.push(`Color: ${box.color.photoValue ?? box.color.catalogValue ?? '—'} ${colorTag}`);
    if (box.color.status === 'discrepancy' && box.color.discrepancyDetail) {
      allDiscrepancies.push({
        boxIndex: box.boxIndex,
        field: 'Color',
        detail: box.color.discrepancyDetail,
      });
    }

    // UPC / GTIN
    if (box.upc.value) {
      lines.push(`UPC: ${box.upc.value} [${box.upc.source}]`);
    }
    if (box.gtin.value) {
      lines.push(`GTIN: ${box.gtin.value} [${box.gtin.source}]`);
    }

    // Serial
    if (box.serial.value) {
      lines.push(`Serie / Frame: ${box.serial.value} [${box.serial.source}]`);
    }

    // Gross Weight
    if (box.gw_kg.value != null) {
      lines.push(`Peso Bruto (G.W.): ${box.gw_kg.value} KG [${box.gw_kg.source}]`);
    }

    // Carton & PO
    if (box.carton.value) {
      lines.push(`Cartón (C/NO): ${box.carton.value} [${box.carton.source}]`);
    }
    if (box.po.value) {
      lines.push(`P/O: ${box.po.value} [${box.po.source}]`);
    }

    // Catalog Status & Stock
    if (box.catalogStatus === 'found' && box.catalogData) {
      const stockStr = box.catalogData.inStock
        ? `En stock (${box.catalogData.totalStock} unidades)`
        : 'Sin stock (0 unidades)';
      const locStr =
        box.catalogData.stockLocations.length > 0
          ? ` — ${box.catalogData.stockLocations.map((l) => `${l.location} (${l.quantity})`).join(', ')}`
          : '';
      lines.push(`Catálogo PickD: ${stockStr}${locStr}`);
    } else if (box.catalogStatus === 'not_found' && box.sku.photoValue) {
      lines.push('Catálogo PickD: SKU no registrado en catálogo PickD');
    }

    lines.push('');
  }

  // Discrepancies Summary Block
  if (allDiscrepancies.length > 0) {
    lines.push('====================================================');
    lines.push('⚠️ DISCREPANCIAS DETECTADAS (FOTO VS CATÁLOGO)');
    lines.push('====================================================');
    for (const d of allDiscrepancies) {
      lines.push(`- Caja ${d.boxIndex}, ${d.field}: ${d.detail}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatProvenanceTag(field: FieldWithProvenance<string>): string {
  if (field.status === 'match') {
    return '[COINCIDE CON FOTO]';
  }
  if (field.status === 'discrepancy') {
    return `[DISCREPANCIA: catálogo="${field.catalogValue}", foto="${field.photoValue}"]`;
  }
  if (field.status === 'photo_only') {
    return '[FOTO ONLY]';
  }
  if (field.status === 'catalog_only') {
    return '[SUGERENCIA CATÁLOGO]';
  }
  return '';
}

/**
 * Main recognition entry point for multi-box carton scenes.
 *
 * Runs OCR and Barcode readers, isolates 2D clusters, reconciles barcodes with
 * spatial clusters, extracts attributes with explicit provenance, and queries catalog.
 */
export async function recognizeMultiBoxClient(
  imageBlob: Blob,
  fileName: string,
  options?: RecognizeMultiBoxOptions
): Promise<MultiBoxClientResult> {
  const t0 = performance.now();

  options?.onProgress?.('Escaneando códigos de barra y ejecutando OCR...');

  // 1. Run barcodes and OCR in parallel
  const tBarcode0 = performance.now();
  const [barcodeReadsRes, ocrResultRes] = await Promise.allSettled([
    readBarcodesOffThread(imageBlob),
    runClientOcr(imageBlob),
  ]);
  const barcodesMs = performance.now() - tBarcode0;

  const rawBarcodeReads: BarcodeRead[] =
    barcodeReadsRes.status === 'fulfilled' ? barcodeReadsRes.value : [];
  const ocrData: ClientOcrResult | null =
    ocrResultRes.status === 'fulfilled' ? ocrResultRes.value : null;

  const ocrMs = ocrData?.elapsedMs ?? 0;

  // 2. Flatten all valid OCR items
  const allOcrItems: OcrItem[] = ocrData?.lines ? ocrData.lines.flat() : [];

  // 3. Segment into 2D Spatial Clusters
  const tSeg0 = performance.now();
  options?.onProgress?.('Segmentando etiquetas espaciales en 2D...');
  const clusters = segmentLabels2D(allOcrItems, {
    minItemsPerCluster: options?.minItemsPerBox ?? 1,
  });
  const segmentationMs = performance.now() - tSeg0;

  // Filter out tiny noise clusters without carton anchors and without SKU
  const validClusters = clusters.filter((c) => {
    // Keep cluster if it has a canonical SKU, or >= 2 carton items with at least 1 anchor, or >= 4 items
    return c.hasSkuPattern || (c.items.length >= 2 && c.anchorsCount >= 1) || c.items.length >= 4;
  });

  // Fallback: If no valid clusters passed filter, but some items existed, keep all raw clusters
  const clustersToProcess = validClusters.length > 0 ? validClusters : clusters;

  // 4. Associate barcodes to clusters
  const clusterBarcodes: Map<string, BarcodeRead[]> = new Map();
  for (const c of clustersToProcess) {
    clusterBarcodes.set(c.id, []);
  }

  const unassignedBarcodes: BarcodeRead[] = [];
  for (const b of rawBarcodeReads) {
    let matchedCluster: LabelCluster | null = null;
    for (const c of clustersToProcess) {
      if (isBarcodeAssociatedWithCluster(b.box, c.bbox)) {
        matchedCluster = c;
        break;
      }
    }

    if (matchedCluster) {
      clusterBarcodes.get(matchedCluster.id)!.push(b);
    } else {
      unassignedBarcodes.push(b);
    }
  }

  // 5. Process each cluster independently through atomic recognition engine
  options?.onProgress?.('Extrayendo atributos independientes por caja...');
  const tCat0 = performance.now();
  const detectedBoxes: DetectedBoxResult[] = [];

  for (let idx = 0; idx < clustersToProcess.length; idx++) {
    const cluster = clustersToProcess[idx];
    const boxIndex = idx + 1;
    const boxBarcodes = clusterBarcodes.get(cluster.id) ?? [];

    // Group lines within cluster bounding box and extract OCR fields
    const clusterLines = groupLinesBySpatialProximity(cluster.items);
    const extractedOcr = extractFieldsFromOcrLines(clusterLines, {
      width: cluster.bbox.width,
      height: cluster.bbox.height,
    });

    // Barcode interpretation for this cluster
    let barcodeSku: string | null = null;
    let barcodeSkuSource = '';
    let barcodeUpc: string | null = null;
    let barcodeUpcSource = '';
    let factoryQrFrame: string | null = null;
    let factoryQrCarton: string | null = null;
    let factoryQrOrder: string | null = null;

    for (const b of boxBarcodes) {
      const meaning = interpretBarcode(b.text, b.format);
      const engine = b.engine ?? 'zxing';

      if (b.format === 'QRCode') {
        const qr = parseJamisFactoryQr(b.text);
        if (qr) {
          if (qr.frame) factoryQrFrame = qr.frame;
          if (qr.carton) factoryQrCarton = qr.carton;
          if (qr.order) factoryQrOrder = qr.order;
        }
      }

      if (meaning.kind === 'stock-number' && !barcodeSku) {
        if (b.format === 'Code128') {
          barcodeSku = meaning.sku;
          barcodeSkuSource = `barcode:${engine} [Code128]`;
        } else if (b.format === 'Code39') {
          const mod43 = checkCode39Mod43(b.text);
          if (mod43?.valid) {
            barcodeSku = mod43.payload;
            barcodeSkuSource = `barcode:${engine} [Code39] (checksum mod-43 verificado)`;
          } else {
            barcodeSku = meaning.sku;
            barcodeSkuSource = `barcode:${engine} [Code39]`;
          }
        }
      } else if (meaning.kind === 'upc' && !barcodeUpc) {
        barcodeUpc = meaning.upc;
        barcodeUpcSource = `barcode:${engine} [${b.format}]`;
      }
    }

    // Resolved photo values
    const finalPhotoSku = barcodeSku ?? extractedOcr.sku;
    const skuSource = barcodeSku ? barcodeSkuSource : extractedOcr.sku ? 'ocr:pp-ocrv6' : 'ninguno';

    const photoModel = extractedOcr.model;
    const modelSource = photoModel ? 'ocr:pp-ocrv6' : 'ninguno';

    const photoSize = extractedOcr.size;
    const sizeSource = photoSize ? 'ocr:pp-ocrv6' : 'ninguno';

    const photoColor = extractedOcr.color;
    const colorSource = photoColor ? 'ocr:pp-ocrv6' : 'ninguno';

    const photoSerial = factoryQrFrame ?? extractedOcr.serial;
    const serialSource = factoryQrFrame
      ? 'factory_qr:QRCode'
      : extractedOcr.serial
        ? 'ocr:pp-ocrv6'
        : 'ninguno';

    const photoUpc = barcodeUpc ?? extractedOcr.upc;
    const upcSource = barcodeUpc ? barcodeUpcSource : extractedOcr.upc ? 'ocr:pp-ocrv6' : 'ninguno';

    const photoGtin = extractedOcr.gtin;
    const gtinSource = photoGtin ? 'ocr:pp-ocrv6' : 'ninguno';

    const photoGw = extractedOcr.gw_kg;
    const gwSource = photoGw != null ? 'ocr:pp-ocrv6' : 'ninguno';

    const photoCarton = factoryQrCarton ?? null;
    const cartonSource = factoryQrCarton ? 'factory_qr:QRCode' : 'ninguno';

    const photoPo = factoryQrOrder ?? null;
    const poSource = factoryQrOrder ? 'factory_qr:QRCode' : 'ninguno';

    // Query Catalog if SKU is present
    let catalogResult: CatalogLookupResult | null = null;
    if (finalPhotoSku) {
      try {
        catalogResult = await lookupCatalogSku(finalPhotoSku, {
          model: photoModel,
          size: photoSize,
          color: photoColor,
        });
      } catch {
        catalogResult = null;
      }
    }

    const catData = catalogResult?.data;
    const catStatus = catalogResult ? catalogResult.status : finalPhotoSku ? 'error' : 'skipped';

    // Build FieldWithProvenance for each attribute
    const toProvenanceStatus = (
      status: 'match' | 'discrepancy' | 'catalog_only' | 'ocr_only'
    ): FieldProvenanceStatus => {
      if (status === 'ocr_only') return 'photo_only';
      return status;
    };

    const modelComp = compareField(catData?.model ?? null, photoModel);
    const modelField: FieldWithProvenance<string> = {
      photoValue: photoModel,
      catalogValue: catData?.model ?? null,
      source: modelSource,
      status: toProvenanceStatus(modelComp.status),
      discrepancyDetail:
        modelComp.status === 'discrepancy'
          ? `Catálogo dice "${catData?.model}", foto dice "${photoModel}"`
          : undefined,
    };

    const sizeComp = compareField(catData?.size ?? null, photoSize);
    const sizeField: FieldWithProvenance<string> = {
      photoValue: photoSize,
      catalogValue: catData?.size ?? null,
      source: sizeSource,
      status: toProvenanceStatus(sizeComp.status),
      discrepancyDetail:
        sizeComp.status === 'discrepancy'
          ? `Catálogo dice "${catData?.size}", foto dice "${photoSize}"`
          : undefined,
    };

    const colorComp = compareField(catData?.color ?? null, photoColor);
    const colorField: FieldWithProvenance<string> = {
      photoValue: photoColor,
      catalogValue: catData?.color ?? null,
      source: colorSource,
      status: toProvenanceStatus(colorComp.status),
      discrepancyDetail:
        colorComp.status === 'discrepancy'
          ? `Catálogo dice "${catData?.color}", foto dice "${photoColor}"`
          : undefined,
    };

    const skuField: FieldWithProvenance<string> = {
      photoValue: finalPhotoSku,
      catalogValue: catData?.sku ?? null,
      source: skuSource,
      status:
        finalPhotoSku && catData?.sku
          ? finalPhotoSku.replace(/[^A-Z0-9]/gi, '') === catData.sku.replace(/[^A-Z0-9]/gi, '')
            ? 'match'
            : 'discrepancy'
          : finalPhotoSku
            ? 'photo_only'
            : 'unresolved',
    };

    detectedBoxes.push({
      boxIndex,
      id: `box-${boxIndex}`,
      bbox: cluster.bbox,
      itemCount: cluster.items.length,
      anchors: cluster.anchors,
      anchorsCount: cluster.anchorsCount,
      sku: skuField,
      model: modelField,
      size: sizeField,
      color: colorField,
      upc: { value: photoUpc, source: upcSource },
      gtin: { value: photoGtin, source: gtinSource },
      gw_kg: { value: photoGw, source: gwSource },
      serial: { value: photoSerial, source: serialSource },
      carton: { value: photoCarton, source: cartonSource },
      po: { value: photoPo, source: poSource },
      barcodeCount: boxBarcodes.length,
      barcodes: boxBarcodes,
      catalogStatus: catStatus,
      catalogData: catData ?? undefined,
      rawCluster: cluster,
      extractedOcr,
    });

    options?.onBox?.(detectedBoxes[detectedBoxes.length - 1], clustersToProcess.length);
  }

  const catalogMs = performance.now() - tCat0;
  const totalMs = performance.now() - t0;

  const discrepanciesCount = detectedBoxes.reduce((acc, box) => {
    let count = 0;
    if (box.model.status === 'discrepancy') count++;
    if (box.size.status === 'discrepancy') count++;
    if (box.color.status === 'discrepancy') count++;
    if (box.sku.status === 'discrepancy') count++;
    return acc + count;
  }, 0);

  const imageDimensions = ocrData?.imageDimensions;

  const partialResult = {
    totalBoxes: detectedBoxes.length,
    boxes: detectedBoxes,
    discrepanciesCount,
    timingMs: {
      total: totalMs,
      barcodes: barcodesMs,
      ocr: ocrMs,
      segmentation: segmentationMs,
      catalog: catalogMs,
    },
    image: {
      name: fileName,
      sizeBytes: imageBlob.size,
      type: imageBlob.type,
      width: imageDimensions?.width,
      height: imageDimensions?.height,
      rotationUsed: ocrData?.rotationUsed,
    },
  };

  const summaryText = buildMultiBoxSummaryText(partialResult);

  return {
    ...partialResult,
    summaryText,
  };
}
