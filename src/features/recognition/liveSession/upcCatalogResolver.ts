/**
 * upcCatalogResolver.ts
 *
 * Catálogo en memoria y resolución de códigos UPC/GTIN a SKU para la sesión en vivo.
 *
 * Principios:
 * 1. NUNCA tratar un número de 12, 13 o 14 dígitos como SKU.
 * 2. En etiquetas Tipo B (y formatos sin Code 39), las barras SOLO contienen UPC/GTIN.
 *    La identidad sale de la resolución determinista UPC -> SKU por catálogo.
 * 3. Manejo explícito de:
 *    - UPC no registrado (queda como 'no identificada', NO como 'caja ajena').
 *    - UPC ambiguo con múltiples SKUs (marca conflicto y muestra opciones).
 * 4. Arbitraje con el canal de OCR: si barras/catálogo y OCR difieren, se reporta conflicto.
 */

import { toUpcA } from '../../../lib/recognition/barcodeText';
import { normalizeSkuOnRegister } from '../../../utils/skuNormalize';

/**
 * Catálogo estático de UPCs Jamis verificados en banco y operaciones.
 * Sirve como semilla determinista de alta velocidad (0 ms) sin requerir red.
 */
export const KNOWN_UPC_CATALOG: Record<string, string> = {
  // Caso exacto reportado por Rafael en Galaxy S25 Ultra:
  // CITIZEN 1 STEP-THRU, SIZE 700C*16, Sugar Mint
  '845436088143': '03-4005-MN',

  // Banco de verificación y producción:
  '845436088099': '03-4000BL', // CITIZEN 1 23 Deep Blue
  '845436089331': '06-4638BK', // EARTH CRUISER 3 Gloss Black
  '845436092959': '03-4270BK', // RENEGADE A1 LTD Black Pearl
  '845436086774': '03-3868BL', // DXT A3 Blue Smoke
  '845436091679': '09-4807CL', // RENEGADE S1 FRAMEKIT Charcoal
  '845436091594': '03-4149BR', // RENEGADE S2 Copper Tone
  '845436089485': '09-4796CL', // RENEGADE S1 FRAMEKIT Charcoal 56
  '845436086545': '03-3845BL', // SEQUEL S2 Riptide
  '845436087757': '03-3970BL', // CITIZEN 3 ST Navy Pearl
  '845436086583': '03-3849BK', // SEQUEL S3
  '845436091631': '03-4153BR', // RENEGADE S2
  '845436082769': '07-3692BL', // LASER 1.6 Deep Blue
  '845436092157': '03-3919GN', // CODA S1 FEMME Misty Green
  '845436086644': '03-3855GY', // DXT A1 Monterey Grey
  '845436086651': '03-3858BL', // DXT A1 Deep Blue
  '845436098432': '03-4869MN', // HUDSON E1
  '845438006710': '07-3743PK', // LASER 20
};

/**
 * Determina si una cadena es estrictamente un UPC-A, EAN-13 o GTIN-14 (12–14 dígitos numéricos).
 */
export function isUpcOrGtin(text: string): boolean {
  const trimmed = text.trim();
  return /^\d{12,14}$/.test(trimmed);
}

/**
 * Normaliza cualquier GTIN-14, EAN-13 o UPC-A a su forma UPC-12 estándar de Jamis.
 * Ej: '00845436088143' -> '845436088143'.
 */
export function normalizeToUpcA(text: string): string | null {
  const trimmed = text.trim();
  const upc = toUpcA(trimmed);
  if (upc) return upc;

  // Si toUpcA rechaza por checksum pero tiene formato directo de 14 dígitos con ceros:
  if (trimmed.length === 14 && trimmed.startsWith('00') && /^\d{14}$/.test(trimmed)) {
    return trimmed.slice(2);
  }
  if (trimmed.length === 13 && trimmed.startsWith('0') && /^\d{13}$/.test(trimmed)) {
    return trimmed.slice(1);
  }
  if (trimmed.length === 12 && /^\d{12}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export interface UpcResolutionResult {
  status: 'resolved' | 'conflict' | 'not_found';
  sku: string | null;
  upc: string | null;
  conflictingSkus?: string[];
  source?: 'known_catalog' | 'session_cache' | 'sku_metadata';
}

/**
 * Catálogo dinámico en memoria con ciclo de vida por sesión de escaneo.
 */
export class SessionUpcCatalog {
  private upcToSkus = new Map<string, Set<string>>();
  private skuToUpcs = new Map<string, Set<string>>();

  constructor() {
    // Inicializar con el catálogo estático conocido
    for (const [upc, sku] of Object.entries(KNOWN_UPC_CATALOG)) {
      this.register(upc, sku);
    }
  }

  public register(upc: string, sku: string): void {
    const cleanUpc = normalizeToUpcA(upc) || upc.replace(/\D/g, '');
    const cleanSku = normalizeSkuOnRegister(sku);
    if (!cleanUpc || !cleanSku) return;

    if (!this.upcToSkus.has(cleanUpc)) {
      this.upcToSkus.set(cleanUpc, new Set());
    }
    this.upcToSkus.get(cleanUpc)!.add(cleanSku);

    if (!this.skuToUpcs.has(cleanSku)) {
      this.skuToUpcs.set(cleanSku, new Set());
    }
    this.skuToUpcs.get(cleanSku)!.add(cleanUpc);
  }

  /**
   * Precarga en memoria los UPCs de todos los SKUs de las órdenes de la sesión
   * mediante una única consulta SQL de solo lectura al inicio.
   */
  public async preloadFromDatabase(supabaseClient: any, skus: string[]): Promise<void> {
    if (!skus || skus.length === 0 || !supabaseClient) return;

    try {
      const cleanKeys = skus.map((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean);

      if (cleanKeys.length === 0) return;

      const { data, error } = await supabaseClient
        .from('sku_metadata')
        .select('sku, upc, sku_key')
        .in('sku_key', cleanKeys)
        .not('upc', 'is', null);

      if (!error && data && Array.isArray(data)) {
        for (const row of data) {
          if (row.upc && row.sku) {
            this.register(row.upc, row.sku);
          }
        }
      }
    } catch (err) {
      console.warn('[SessionUpcCatalog] Error precargando UPCs de la base de datos:', err);
    }
  }

  /**
   * Resuelve un código de barras leído (UPC-A o GTIN-14) a un SKU de la orden.
   */
  public resolve(rawBarcode: string): UpcResolutionResult {
    const upc = normalizeToUpcA(rawBarcode);
    if (!upc) {
      return { status: 'not_found', sku: null, upc: null };
    }

    const matches = this.upcToSkus.get(upc);
    if (!matches || matches.size === 0) {
      return { status: 'not_found', sku: null, upc };
    }

    const skus = Array.from(matches);
    if (skus.length === 1) {
      return {
        status: 'resolved',
        sku: skus[0],
        upc,
        source: 'session_cache',
      };
    }

    // Múltiples SKUs para el mismo UPC: Conflicto explícito, jamás resolver en silencio
    return {
      status: 'conflict',
      sku: null,
      upc,
      conflictingSkus: skus,
    };
  }

  public getUpcForSku(sku: string): string | null {
    const cleanSku = normalizeSkuOnRegister(sku);
    const upcs = this.skuToUpcs.get(cleanSku);
    if (upcs && upcs.size > 0) {
      return Array.from(upcs)[0];
    }
    return null;
  }
}

/**
 * Arbitraje entre el canal de código de barras / catálogo y el canal de texto OCR.
 *
 * Reglas de arbitraje:
 * - Si solo hay SKU de barras/catálogo: se acepta.
 * - Si solo hay SKU de OCR: se acepta con confianza de texto.
 * - Si ambos canales entregan un SKU:
 *   - Si coinciden (normalizados): se confirma con alta confianza.
 *   - Si difieren: CONFLICTO EXPLICITO. Jamás se resuelve en silencio ni gana uno arbitrariamente.
 */
export interface SkuArbitrationResult {
  status: 'resolved' | 'conflict' | 'unresolved';
  sku: string | null;
  upc: string | null;
  source: 'barcode_sku' | 'catalog_upc' | 'ocr_text' | 'concordance' | 'none';
  conflictDetail?: string;
}

export function arbitrateCandidates(params: {
  barcodeSku?: string | null;
  catalogSku?: string | null;
  ocrSku?: string | null;
  upc?: string | null;
}): SkuArbitrationResult {
  const { barcodeSku, catalogSku, ocrSku, upc } = params;

  // Canal primario determinista (código de barras directo o resuelto por UPC en catálogo)
  const primaryDeterministicSku = barcodeSku || catalogSku || null;
  const primarySource: 'barcode_sku' | 'catalog_upc' | 'none' = barcodeSku
    ? 'barcode_sku'
    : catalogSku
      ? 'catalog_upc'
      : 'none';

  // Caso 1: Ambos canales (determinista y OCR) detectaron un SKU
  if (primaryDeterministicSku && ocrSku) {
    const normPrimary = primaryDeterministicSku.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const normOcr = ocrSku.replace(/[^A-Z0-9]/gi, '').toUpperCase();

    if (normPrimary === normOcr) {
      return {
        status: 'resolved',
        sku: primaryDeterministicSku,
        upc: upc || null,
        source: 'concordance',
      };
    }

    // DISCREPANCIA DIRECTA: R10 Sección 4 Caso B
    return {
      status: 'conflict',
      sku: null,
      upc: upc || null,
      source: 'none',
      conflictDetail: `Conflicto entre canales: Barras/Catálogo (${primaryDeterministicSku}) ≠ OCR (${ocrSku})`,
    };
  }

  // Caso 2: Solo canal primario determinista (barras o catálogo)
  if (primaryDeterministicSku) {
    return {
      status: 'resolved',
      sku: primaryDeterministicSku,
      upc: upc || null,
      source: primarySource,
    };
  }

  // Caso 3: Solo canal de OCR
  if (ocrSku) {
    return {
      status: 'resolved',
      sku: ocrSku,
      upc: upc || null,
      source: 'ocr_text',
    };
  }

  // Caso 4: Ningún canal resolvió el SKU
  return {
    status: 'unresolved',
    sku: null,
    upc: upc || null,
    source: 'none',
  };
}
