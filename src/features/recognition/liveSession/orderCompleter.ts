/**
 * orderCompleter.ts
 *
 * Guarda el progreso de verificación caja por caja (Sub-fase L-5) **para esta
 * vista de /live-check**, sin completar la orden:
 *
 * Escribe:
 * - checked_by: id del verificador
 * - verified_item_keys: array de claves para compatibilidad total con verificationProgress()
 * - updated_at: ISO timestamp
 * - status: `ready_to_double_check` → `double_checking` (el mismo paso que hace
 *   `lockForCheck` al abrir Double Check — sin esto, `verified_item_keys`
 *   queda escrito pero `verificationProgress()` lo ignora a propósito
 *   mientras la orden siga en la cola). Cualquier otro status (`double_checking`
 *   ya, `active`, `needs_correction`, …) se deja intacto.
 *
 * Deliberadamente NO escribe `is_waiting_inventory` ni pasa la orden a
 * `completed`. Completar la orden es una decisión de Double Check / Ship, no
 * de este escaneo — confundir "ya verifiqué las cajas que vi" con "esta orden
 * ya salió del estante" fue el bug que esta separación existe para evitar
 * (Rafael, 22 sep 2026).
 *
 * REGLA ESTRICTA DE SEGURIDAD:
 * Nunca ejecutar mutaciones directas sobre la base de producción en tests automatizados.
 * Los tests de integración corren exclusivamente sobre el contenedor local Docker (supabase_db_pickd).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfirmedBox, LiveSessionState } from './liveSessionState';
import type { SessionItemLedger } from './groupReconciler';

export interface VerifyOrderResult {
  orderId: string;
  orderNumber: string;
  success: boolean;
  verifiedItemKeys: string[];
  totalBoxesConfirmed: number;
  verifiedAt: string;
  error?: string;
}

export interface BatchVerifyGroupResult {
  groupId: string | null;
  orders: VerifyOrderResult[];
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
 * Guarda el progreso de verificación de una orden individual. No completa la
 * orden ni toca su `status`.
 */
export async function markOrderVerified(
  supabase: SupabaseClient,
  orderId: string,
  checkedBy: string,
  sessionState: LiveSessionState,
  options: { dryRun?: boolean } = {}
): Promise<VerifyOrderResult> {
  const order = sessionState.orders.find((o) => o.id === orderId);
  const orderNumber = order?.orderNumber || orderId;

  const orderItems = sessionState.items.filter((i) => i.orderId === orderId);
  const orderBoxes = sessionState.confirmedBoxes.filter((b) => b.targetOrderId === orderId);
  const verifiedItemKeys = buildVerifiedItemKeys(orderItems, orderBoxes);
  const verifiedAt = new Date().toISOString();

  if (options.dryRun) {
    return {
      orderId,
      orderNumber,
      success: true,
      verifiedItemKeys,
      totalBoxesConfirmed: orderBoxes.length,
      verifiedAt,
    };
  }

  try {
    const updatePayload: Record<string, unknown> = {
      checked_by: checkedBy,
      verified_item_keys: verifiedItemKeys,
      updated_at: verifiedAt,
    };

    // Igual que `lockForCheck` en Double Check: abrir una orden para
    // verificarla la saca de la cola (`ready_to_double_check`) hacia
    // `double_checking`, o `verified_item_keys` quedaría escrito pero
    // `verificationProgress()` lo ignoraría (esa combinación vale 0 a
    // propósito — ver `verificationProgress.ts`). Ningún otro status se toca.
    if (order?.status === 'ready_to_double_check') {
      updatePayload.status = 'double_checking';
    }

    const { error } = await supabase.from('picking_lists').update(updatePayload).eq('id', orderId);

    if (error) {
      return {
        orderId,
        orderNumber,
        success: false,
        verifiedItemKeys,
        totalBoxesConfirmed: orderBoxes.length,
        verifiedAt,
        error: error.message,
      };
    }

    return {
      orderId,
      orderNumber,
      success: true,
      verifiedItemKeys,
      totalBoxesConfirmed: orderBoxes.length,
      verifiedAt,
    };
  } catch (err: any) {
    return {
      orderId,
      orderNumber,
      success: false,
      verifiedItemKeys,
      totalBoxesConfirmed: orderBoxes.length,
      verifiedAt,
      error: err?.message || String(err),
    };
  }
}

/**
 * Guarda el progreso de verificación de todas las órdenes del grupo.
 */
export async function markOrderGroupVerified(
  supabase: SupabaseClient,
  checkedBy: string,
  sessionState: LiveSessionState,
  options: { dryRun?: boolean } = {}
): Promise<BatchVerifyGroupResult> {
  const results: VerifyOrderResult[] = [];

  for (const order of sessionState.orders) {
    const res = await markOrderVerified(supabase, order.id, checkedBy, sessionState, options);
    results.push(res);
  }

  const allSucceeded = results.every((r) => r.success);

  return {
    groupId: sessionState.groupId,
    orders: results,
    allSucceeded,
  };
}
