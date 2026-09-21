/**
 * liveBarcodeScanner.ts
 *
 * Motor de captura y consenso temporal multi-frame para la verificación en vivo
 * caja por caja (Fase F2 / MVP de Orden).
 *
 * Principio rector:
 * 1. BarcodeDetector nativo por hardware (12-16 ms en Chrome Android).
 * 2. Consenso temporal de N cuadros sucesivos (R11 Bloque 2) para eliminar transitorios y reflejos.
 * 3. Detección off-thread para no bloquear el hilo de render de React.
 */

import { asStockNumber, checkCode39Mod43 } from '../../../lib/recognition/barcodeText';
import {
  isUpcOrGtin,
  normalizeToUpcA,
  SessionUpcCatalog,
  arbitrateCandidates,
} from './upcCatalogResolver';

export interface RawBarcodeDetection {
  rawValue: string;
  format: string;
  timestamp: number;
}

export interface ProposedBoxCandidate {
  sku: string | null;
  rawBarcode: string;
  format: string;
  serial?: string | null;
  upc?: string | null;
  gtin?: string | null;
  conflict?: string | null;
  resolvedVia?: 'code39' | 'barcode_sku' | 'catalog_upc' | 'ocr_text' | 'concordance' | 'none';
  consecutiveFrames: number;
  confidence: number; // 0.0 to 1.0
  firstDetectedAt: number;
  lastDetectedAt: number;
}

export interface ConsensusConfig {
  requiredFrames: number; // Por defecto 2 o 3 cuadros consecutivos
  windowMs: number; // Ventana temporal máxima (600 ms)
}

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  requiredFrames: 2,
  windowMs: 600,
};

export interface ExtractedBarcodeData {
  sku?: string;
  serial?: string;
  upc?: string;
  gtin?: string;
}

/**
 * Normaliza y valida si un valor leído de código de barras corresponde a un SKU, serial o UPC/GTIN.
 *
 * REGLA DE ORO (Bug Rafael S25 Ultra):
 * NUNCA tratar un número de 12, 13 o 14 dígitos como SKU.
 * En etiquetas Tipo B, las barras son UPC/GTIN.
 */
export function extractCandidateFromBarcode(rawValue: string): ExtractedBarcodeData {
  const trimmed = rawValue.trim();
  if (!trimmed) return {};

  // 1. UPC / EAN / GTIN (12, 13 o 14 dígitos estrictamente numéricos)
  if (isUpcOrGtin(trimmed)) {
    const upc = normalizeToUpcA(trimmed) || trimmed;
    const gtin = trimmed.length === 14 ? trimmed : undefined;
    return { upc, gtin };
  }

  // 2. Si es un Code 39 con Mod-43 válido, verificar primero
  const mod43 = checkCode39Mod43(trimmed);
  if (mod43?.valid) {
    const stock = asStockNumber(mod43.payload);
    if (stock) {
      return { sku: stock };
    }
  }

  // 3. Formato canónico Jamis SKU directo (e.g. 03-3989GY, 06-4573-GY, 01-0448, 03-4005-MN)
  const stock = asStockNumber(trimmed);
  if (stock) {
    return { sku: stock };
  }

  // Patrón canónico de SKU Jamis con guion (e.g. 01-044817, 03-3989GY, 06-4573-GY)
  const skuMatch = trimmed.match(/\b(\d{2}-\d{4}-?[A-Z0-9]{0,3})\b/i);
  if (skuMatch) {
    return { sku: skuMatch[1].toUpperCase() };
  }

  // 4. Serial Jamis (e.g. "U226U03779", "M22E009702", "G220303752", "WRDH01637")
  const serialMatch = trimmed.match(/\b([A-Z][A-Z0-9]{8,13})\b/i);
  if (serialMatch) {
    return { serial: serialMatch[1].toUpperCase() };
  }

  return {};
}

/**
 * Acumulador temporal para consenso multi-frame.
 */
export class TemporalConsensusFilter {
  private config: ConsensusConfig;
  private recentDetections: RawBarcodeDetection[] = [];
  private activeCandidate: ProposedBoxCandidate | null = null;
  private catalogResolver: SessionUpcCatalog | null = null;

  constructor(
    config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG,
    catalogResolver?: SessionUpcCatalog
  ) {
    this.config = config;
    this.catalogResolver = catalogResolver || null;
  }

  public setCatalogResolver(catalogResolver: SessionUpcCatalog): void {
    this.catalogResolver = catalogResolver;
  }

  public reset(): void {
    this.recentDetections = [];
    this.activeCandidate = null;
  }

  /**
   * Procesa una detección cruda de un cuadro.
   * Si alcanza el número de cuadros requeridos con el mismo valor dentro de la ventana,
   * emite el `ProposedBoxCandidate`. Si no, retorna null.
   */
  public pushFrame(
    detection: RawBarcodeDetection,
    options?: { catalogResolver?: SessionUpcCatalog; ocrSku?: string | null }
  ): ProposedBoxCandidate | null {
    const now = detection.timestamp;
    const resolver = options?.catalogResolver || this.catalogResolver;

    // Limpiar detecciones viejas fuera de la ventana
    this.recentDetections = this.recentDetections.filter(
      (d) => now - d.timestamp <= this.config.windowMs
    );
    this.recentDetections.push(detection);

    // Contar ocurrencias del mismo rawValue
    const matching = this.recentDetections.filter((d) => d.rawValue === detection.rawValue);
    const count = matching.length;

    if (count >= this.config.requiredFrames) {
      const parsed = extractCandidateFromBarcode(detection.rawValue);

      const barcodeSku: string | null = parsed.sku || null;
      let catalogSku: string | null = null;
      let conflictMsg: string | null = null;
      let upc: string | null = parsed.upc || null;
      const gtin: string | null = parsed.gtin || null;

      // Si es un UPC/GTIN o no tiene SKU directo en barras, intentar resolver vía catálogo
      if (!barcodeSku && (upc || isUpcOrGtin(detection.rawValue))) {
        const rawCode = upc || detection.rawValue;
        if (resolver) {
          const res = resolver.resolve(rawCode);
          if (res.status === 'resolved' && res.sku) {
            catalogSku = res.sku;
            upc = res.upc;
          } else if (res.status === 'conflict') {
            conflictMsg = `UPC ${res.upc} ambiguo: asignado a múltiples SKUs (${res.conflictingSkus?.join(', ')})`;
            upc = res.upc;
          }
        }
      }

      // Arbitraje entre canal determinista (barras/catálogo) y OCR (si está presente)
      const arbitration = arbitrateCandidates({
        barcodeSku,
        catalogSku,
        ocrSku: options?.ocrSku,
        upc,
      });

      let finalSku: string | null = arbitration.sku;
      let resolvedVia: ProposedBoxCandidate['resolvedVia'] = arbitration.source;

      if (arbitration.status === 'conflict') {
        finalSku = null;
        conflictMsg = arbitration.conflictDetail || 'Conflicto entre canales de lectura';
        resolvedVia = 'none';
      } else if (conflictMsg) {
        finalSku = null;
        resolvedVia = 'none';
      }

      const candidate: ProposedBoxCandidate = {
        sku: finalSku,
        rawBarcode: detection.rawValue,
        format: detection.format,
        serial: parsed.serial || null,
        upc,
        gtin,
        conflict: conflictMsg,
        resolvedVia,
        consecutiveFrames: count,
        confidence: Math.min(1.0, 0.7 + count * 0.1),
        firstDetectedAt: matching[0].timestamp,
        lastDetectedAt: now,
      };

      this.activeCandidate = candidate;
      return candidate;
    }

    return null;
  }

  public getActiveCandidate(): ProposedBoxCandidate | null {
    return this.activeCandidate;
  }
}
