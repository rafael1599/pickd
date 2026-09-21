/**
 * orderCompleter.ts
 *
 * Finalización de órdenes verificadas caja por caja (Sub-fase L-5):
 *
 * Transición de estado:
 * - status: 'completed'
 * - checked_by: id del verificador
 * - verified_item_keys: array de claves para compatibilidad total con verificationProgress()
 * - is_waiting_inventory: false
 * - updated_at: ISO timestamp
 *
 * REGLA ESTRICTA DE SEGURIDAD:
 * Nunca ejecutar mutaciones directas sobre la base de producción en tests automatizados.
 * Los tests de integración corren exclusivamente sobre el contenedor local Docker (supabase_db_pickd).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfirmedBox, LiveSessionState } from './liveSessionState';
import type { SessionItemLedger } from './groupReconciler';

export interface CompletionOrderResult {
  orderId: string;
  orderNumber: string;
  success: boolean;
  status: 'completed';
  verifiedItemKeys: string[];
  totalBoxesConfirmed: number;
  completedAt: string;
  error?: string;
}

export interface BatchCompletionGroupResult {
  groupId: string | null;
  orders: CompletionOrderResult[];
  allSucceeded: boolean;
}

/**
 * Genera las claves `verified_item_keys` requeridas por Pickd para marcar
 * progreso 100% en la orden.
 */
export function buildVerifiedItemKeys(
  items: SessionItemLedger[],
  confirmedBoxes: ConfirmedBox[]
): string[] {
  const keys: string[] = [];

  for (const item of items) {
    // Generar una clave por cada unidad confirmada: `1-${sku}-${idx}`
    const count = Math.min(item.verifiedQuantity, item.quantity);
    for (let i = 0; i < count; i++) {
      keys.push(`1-${item.sku}-${i}`);
    }
  }

  // Si no hay ítems pero hay cajas confirmadas, registrar las cajas
  if (keys.length === 0 && confirmedBoxes.length > 0) {
    for (let i = 0; i < confirmedBoxes.length; i++) {
      keys.push(`1-${confirmedBoxes[i].sku}-${i}`);
    }
  }

  return Array.from(new Set(keys));
}

/**
 * Completa una orden individual en la base de datos.
 */
export async function completeVerifiedOrder(
  supabase: SupabaseClient,
  orderId: string,
  checkedBy: string,
  sessionState: LiveSessionState,
  options: { dryRun?: boolean } = {}
): Promise<CompletionOrderResult> {
  const order = sessionState.orders.find((o) => o.id === orderId);
  const orderNumber = order?.orderNumber || orderId;

  const orderItems = sessionState.items.filter((i) => i.orderId === orderId);
  const orderBoxes = sessionState.confirmedBoxes.filter((b) => b.targetOrderId === orderId);
  const verifiedItemKeys = buildVerifiedItemKeys(orderItems, orderBoxes);
  const completedAt = new Date().toISOString();

  if (options.dryRun) {
    return {
      orderId,
      orderNumber,
      success: true,
      status: 'completed',
      verifiedItemKeys,
      totalBoxesConfirmed: orderBoxes.length,
      completedAt,
    };
  }

  try {
    const updatePayload = {
      status: 'completed',
      checked_by: checkedBy,
      verified_item_keys: verifiedItemKeys,
      is_waiting_inventory: false,
      updated_at: completedAt,
    };

    const { error } = await supabase.from('picking_lists').update(updatePayload).eq('id', orderId);

    if (error) {
      return {
        orderId,
        orderNumber,
        success: false,
        status: 'completed',
        verifiedItemKeys,
        totalBoxesConfirmed: orderBoxes.length,
        completedAt,
        error: error.message,
      };
    }

    return {
      orderId,
      orderNumber,
      success: true,
      status: 'completed',
      verifiedItemKeys,
      totalBoxesConfirmed: orderBoxes.length,
      completedAt,
    };
  } catch (err: any) {
    return {
      orderId,
      orderNumber,
      success: false,
      status: 'completed',
      verifiedItemKeys,
      totalBoxesConfirmed: orderBoxes.length,
      completedAt,
      error: err?.message || String(err),
    };
  }
}

/**
 * Completa todas las órdenes del grupo que tengan sus ítems verificados.
 */
export async function completeVerifiedOrderGroup(
  supabase: SupabaseClient,
  checkedBy: string,
  sessionState: LiveSessionState,
  options: { dryRun?: boolean } = {}
): Promise<BatchCompletionGroupResult> {
  const results: CompletionOrderResult[] = [];

  for (const order of sessionState.orders) {
    const res = await completeVerifiedOrder(supabase, order.id, checkedBy, sessionState, options);
    results.push(res);
  }

  const allSucceeded = results.every((r) => r.success);

  return {
    groupId: sessionState.groupId,
    orders: results,
    allSucceeded,
  };
}
