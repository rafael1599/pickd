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

export interface RawBarcodeDetection {
  rawValue: string;
  format: string;
  timestamp: number;
}

export interface ProposedBoxCandidate {
  sku: string;
  rawBarcode: string;
  format: string;
  serial?: string | null;
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

import { asStockNumber, checkCode39Mod43 } from '../../../lib/recognition/barcodeText';

/**
 * Normaliza y valida si un valor leído de código de barras corresponde a un SKU o serial.
 * Formatos estándar Jamis:
 * - Code 39: "03-3989GY", "03-3989GYP" (con checksum mod43)
 * - UPC/EAN: 12-13 dígitos (e.g. "845436098432")
 * - QR Jamis de manufactura: "A23JC-744-0003"
 */
export function extractCandidateFromBarcode(rawValue: string): { sku?: string; serial?: string } {
  const trimmed = rawValue.trim();

  // 1. Si es un Code 39 con Mod-43 válido, verificar primero
  const mod43 = checkCode39Mod43(trimmed);
  if (mod43?.valid) {
    const stock = asStockNumber(mod43.payload);
    if (stock) {
      return { sku: stock };
    }
  }

  // 2. Formato canónico Jamis SKU directo (e.g. 03-3989GY, 06-4573-GY, 01-0448)
  const stock = asStockNumber(trimmed);
  if (stock) {
    return { sku: stock };
  }

  const skuMatch = trimmed.match(/\b(\d{2}-\d{4}-?[A-Z0-9]{2,3})\b/i);
  if (skuMatch) {
    return { sku: skuMatch[1].toUpperCase() };
  }

  // 3. Serial Jamis (e.g. "U226U03779", "M22E009702", "G220303752", "WRDH01637")
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

  constructor(config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG) {
    this.config = config;
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
  public pushFrame(detection: RawBarcodeDetection): ProposedBoxCandidate | null {
    const now = detection.timestamp;

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
      const sku = parsed.sku || detection.rawValue;

      const candidate: ProposedBoxCandidate = {
        sku,
        rawBarcode: detection.rawValue,
        format: detection.format,
        serial: parsed.serial || null,
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
