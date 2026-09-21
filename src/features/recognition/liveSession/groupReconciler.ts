/**
 * groupReconciler.ts
 *
 * Conciliación multi-orden y clasificación tripartita de poblaciones (Sub-fase L-3):
 * - Población A (Bicicleta válida en grupo): SKU pertenece al order_group y tiene faltante por verificar.
 * - Población B (Caja ajena / Alien): SKU NO pertenece a ninguna orden del grupo. ALERTA ROJA.
 * - Población C (Partes / Repuestos, is_bike: false): SKU de partes con conteo por lote/caja.
 * - Caso Especial (Completado en grupo / Exceso): SKU pertenece al grupo pero ya completó su cuota.
 *
 * Regla de Oro:
 * La orden en pantalla nunca está sola en el 45.5% de los despachos históricos.
 * Se concilia contra el grupo entero para evitar falsas alarmas de cajas ajenas.
 */

import type { ProposedBoxCandidate } from './liveBarcodeScanner';

export type ReconciledPopulation =
  | 'A' // Bicicleta válida asignada a una orden del grupo
  | 'B' // Alien box: SKU confirmado que no pertenece a ninguna orden del grupo
  | 'C' // Partes/repuestos (is_bike: false)
  | 'COMPLETED_IN_GROUP' // Pertenece al grupo pero la cantidad ya está cubierta
  | 'UNIDENTIFIED' // Código leído pero SKU no resuelto (UPC desconocido o barras sin SKU)
  | 'CONFLICT'; // Conflicto explícito (UPC ambiguo o barras ≠ OCR)

export interface SessionItemLedger {
  id: string; // `${orderId}-${sku}-${idx}`
  orderId: string;
  orderNumber: string;
  sku: string;
  name?: string | null;
  quantity: number;
  verifiedQuantity: number;
  isBike: boolean;
  model?: string | null;
  size?: string | null;
  color?: string | null;
}

export interface ReconciliationResult {
  candidate: ProposedBoxCandidate;
  population: ReconciledPopulation;
  matchedItem: SessionItemLedger | null;
  targetOrderId: string | null;
  targetOrderNumber: string | null;
  isDuplicateSerial: boolean;
  isExcess: boolean;
  statusMessage: string;
}

/**
 * Normaliza SKU para comparación robusta (sin guiones extra o espacios).
 */
export function normalizeSkuForCompare(sku: string): string {
  return sku.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

/**
 * Concilia un candidato contra el ledger unificado de órdenes del grupo.
 */
export function reconcileCandidate(
  candidate: ProposedBoxCandidate,
  items: SessionItemLedger[],
  knownSerials: Set<string>
): ReconciliationResult {
  // 1. Verificación de serial duplicado (Dedupe Warning)
  const isDuplicateSerial =
    Boolean(candidate.serial) && knownSerials.has(candidate.serial!.toUpperCase());

  // 2. Conflicto explícito (UPC multi-SKU o discrepancia Barras ≠ OCR)
  if (candidate.conflict) {
    return {
      candidate,
      population: 'CONFLICT',
      matchedItem: null,
      targetOrderId: null,
      targetOrderNumber: null,
      isDuplicateSerial,
      isExcess: false,
      statusMessage: `⚠️ CONFLICTO DE IDENTIDAD: ${candidate.conflict}`,
    };
  }

  // 3. Código no identificado (sin SKU resuelto)
  // REGLA DE ORO (Bug Rafael Galaxy S25 Ultra):
  // NUNCA disparar Población B (Caja Ajena) sin un SKU resuelto.
  if (!candidate.sku) {
    const codeDesc = candidate.upc ? `UPC ${candidate.upc}` : candidate.rawBarcode;
    return {
      candidate,
      population: 'UNIDENTIFIED',
      matchedItem: null,
      targetOrderId: null,
      targetOrderNumber: null,
      isDuplicateSerial,
      isExcess: false,
      statusMessage: `ℹ️ Código leído (${codeDesc}) pero SKU no identificado en catálogo. Acerque la cámara o verifique la etiqueta.`,
    };
  }

  const normCandidateSku = normalizeSkuForCompare(candidate.sku);

  // 4. Buscar coincidencias en el ledger de ítems
  const matchingItems = items.filter(
    (item) => normalizeSkuForCompare(item.sku) === normCandidateSku
  );

  // Si no existe en ninguna orden del grupo -> POBLACIÓN B (ALIEN BOX)
  if (matchingItems.length === 0) {
    return {
      candidate,
      population: 'B',
      matchedItem: null,
      targetOrderId: null,
      targetOrderNumber: null,
      isDuplicateSerial,
      isExcess: false,
      statusMessage: `⚠️ ALERTA CAJA AJENA: SKU ${candidate.sku} no pertenece a ninguna orden del grupo.`,
    };
  }

  // 3. Revisar si es población C (Partes / Accesorios, is_bike === false)
  const isBike = matchingItems.some((item) => item.isBike);
  if (!isBike) {
    // Buscar el primer ítem de partes con cantidad pendiente
    const pendingPart =
      matchingItems.find((item) => item.verifiedQuantity < item.quantity) || matchingItems[0];
    const isCompleted = matchingItems.every((item) => item.verifiedQuantity >= item.quantity);

    return {
      candidate,
      population: 'C',
      matchedItem: pendingPart,
      targetOrderId: pendingPart.orderId,
      targetOrderNumber: pendingPart.orderNumber,
      isDuplicateSerial,
      isExcess: isCompleted,
      statusMessage: isCompleted
        ? `Lote de partes ${candidate.sku} ya completado en orden #${pendingPart.orderNumber}.`
        : `Caja de partes detectada: ${candidate.sku} (Orden #${pendingPart.orderNumber}).`,
    };
  }

  // 4. Población A (Bicicletas): buscar la primera orden con faltante
  const openItem = matchingItems.find((item) => item.verifiedQuantity < item.quantity);

  if (openItem) {
    return {
      candidate,
      population: 'A',
      matchedItem: openItem,
      targetOrderId: openItem.orderId,
      targetOrderNumber: openItem.orderNumber,
      isDuplicateSerial,
      isExcess: false,
      statusMessage: isDuplicateSerial
        ? `⚠️ Posible duplicado: serial ya contado, pero SKU ${candidate.sku} asignable a #${openItem.orderNumber}.`
        : `Bici válida: ${candidate.sku} asignada a orden #${openItem.orderNumber}.`,
    };
  }

  // Si todas las bicis de este SKU ya están satisfechas en todo el grupo -> COMPLETED_IN_GROUP
  const anchorItem = matchingItems[0];
  return {
    candidate,
    population: 'COMPLETED_IN_GROUP',
    matchedItem: anchorItem,
    targetOrderId: anchorItem.orderId,
    targetOrderNumber: anchorItem.orderNumber,
    isDuplicateSerial,
    isExcess: true,
    statusMessage: `ℹ️ SKU ${candidate.sku} ya tiene todas sus unidades cubiertas en el grupo.`,
  };
}
