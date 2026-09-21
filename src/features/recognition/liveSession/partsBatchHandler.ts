/**
 * partsBatchHandler.ts
 *
 * Manejador de lotes de partes / repuestos (Sub-fase L-4 / Población C):
 *
 * Las cajas de partes (is_bike: false) a menudo contienen múltiples unidades
 * en un solo empaque (e.g. una caja con 10 chainstays o 15 tornillos).
 * El operador no debe verse obligado a tocar 10 veces para una sola caja física.
 *
 * Permite confirmar el bulto completo con un solo gesto o ajustar la cantidad si es parcial.
 */

import {
  type LiveSessionState,
  type ConfirmedBox,
  calculateSessionStats,
} from './liveSessionState';
import { normalizeSkuForCompare } from './groupReconciler';

export interface BatchPartsConfirmationResult {
  state: LiveSessionState;
  confirmedBox: ConfirmedBox | null;
  confirmedCount: number;
}

/**
 * Confirma un lote de repuestos/partes en un solo toque.
 */
export function batchConfirmPartsCarton(
  state: LiveSessionState,
  sku: string,
  quantityToConfirm?: number,
  targetOrderId?: string
): BatchPartsConfirmationResult {
  const normSku = normalizeSkuForCompare(sku);

  // Buscar el ítem de partes correspondiente
  const targetItem = state.items.find((item) => {
    const matchesSku = normalizeSkuForCompare(item.sku) === normSku;
    const matchesOrder = !targetOrderId || item.orderId === targetOrderId;
    return matchesSku && matchesOrder && !item.isBike;
  });

  if (!targetItem) {
    return {
      state,
      confirmedBox: null,
      confirmedCount: 0,
    };
  }

  // Si no se especifica cantidad, completar el remanente pendiente
  const pending = Math.max(1, targetItem.quantity - targetItem.verifiedQuantity);
  const qtyToApply = quantityToConfirm ?? pending;

  const newBox: ConfirmedBox = {
    id: `box-parts-${Date.now()}-${state.confirmedBoxes.length + 1}`,
    sku: targetItem.sku,
    serial: null,
    targetOrderId: targetItem.orderId,
    targetOrderNumber: targetItem.orderNumber,
    confirmedAt: Date.now(),
    sourceBarcode: `PARTS-BATCH-${sku}`,
    isDuplicateSerial: false,
    isAlien: false,
    quantityConfirmed: qtyToApply,
  };

  let applied = false;
  const nextItems = state.items.map((item) => {
    if (!applied && item.id === targetItem.id) {
      applied = true;
      return {
        ...item,
        verifiedQuantity: item.verifiedQuantity + qtyToApply,
      };
    }
    return item;
  });

  const nextConfirmed = [...state.confirmedBoxes, newBox];
  const nextStats = calculateSessionStats(nextItems, nextConfirmed, state.alienDetections.length);

  return {
    state: {
      ...state,
      items: nextItems,
      confirmedBoxes: nextConfirmed,
      activeProposal: null,
      stats: nextStats,
    },
    confirmedBox: newBox,
    confirmedCount: qtyToApply,
  };
}
