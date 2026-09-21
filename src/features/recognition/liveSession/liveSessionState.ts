/**
 * liveSessionState.ts
 *
 * Máquina de estado y modelo de datos para la Sesión de Verificación en Vivo
 * caja por caja (Sub-fase L-2).
 *
 * Principios:
 * 1. Estado inmutable y funciones puras para fácil testing y uso en React reducer / Zustand.
 * 2. Un toque = una caja: cada confirmación produce un registro atómico en `confirmedBoxes`.
 * 3. Trazabilidad completa por orden de origen dentro del `order_group`.
 * 4. Control de duplicados no bloqueante con advertencia.
 */

import type { ProposedBoxCandidate } from './liveBarcodeScanner';
import {
  type SessionItemLedger,
  type ReconciliationResult,
  reconcileCandidate,
  normalizeSkuForCompare,
} from './groupReconciler';
import { isBikeSku } from '../../../utils/bikeDetection';

export interface OrderContext {
  id: string;
  orderNumber: string;
  status: string;
  totalUnits: number;
  isShipped: boolean;
  customerName?: string | null;
}

export interface ConfirmedBox {
  id: string;
  sku: string;
  serial: string | null;
  targetOrderId: string;
  targetOrderNumber: string;
  confirmedAt: number;
  sourceBarcode: string;
  isDuplicateSerial: boolean;
  isAlien: boolean;
  quantityConfirmed: number;
  /**
   * La puso una mano, no la cámara. La proporción entre unas y otras es la
   * medida de si el reconocimiento sirve, y se pierde si las dos se ven igual.
   */
  isManual?: boolean;
}

export interface AlienDetection {
  sku: string;
  rawBarcode: string;
  detectedAt: number;
  reason: string;
}

export interface LiveSessionStats {
  totalBikesRequired: number;
  totalBikesConfirmed: number;
  totalPartsRequired: number;
  totalPartsConfirmed: number;
  alienCount: number;
  progressPercent: number;
  isGroupFullyVerified: boolean;
}

export interface LiveSessionState {
  status: 'idle' | 'ready' | 'active' | 'completed' | 'error';
  errorMessage: string | null;
  groupId: string | null;
  orders: OrderContext[];
  items: SessionItemLedger[];
  confirmedBoxes: ConfirmedBox[];
  activeProposal: ReconciliationResult | null;
  alienDetections: AlienDetection[];
  knownSerials: string[];
  stats: LiveSessionStats;
}

/**
 * Calcula estadísticas agregadas de la sesión.
 */
export function calculateSessionStats(
  items: SessionItemLedger[],
  _confirmedBoxes: ConfirmedBox[],
  alienCount: number
): LiveSessionStats {
  let totalBikesRequired = 0;
  let totalBikesConfirmed = 0;
  let totalPartsRequired = 0;
  let totalPartsConfirmed = 0;

  for (const item of items) {
    if (item.isBike) {
      totalBikesRequired += item.quantity;
      totalBikesConfirmed += item.verifiedQuantity;
    } else {
      totalPartsRequired += item.quantity;
      totalPartsConfirmed += item.verifiedQuantity;
    }
  }

  const totalRequired = totalBikesRequired + totalPartsRequired;
  const totalConfirmed = totalBikesConfirmed + totalPartsConfirmed;

  const progressPercent =
    totalRequired === 0 ? 100 : Math.min(100, Math.round((totalConfirmed / totalRequired) * 100));

  const isGroupFullyVerified =
    totalBikesRequired > 0
      ? totalBikesConfirmed >= totalBikesRequired && totalPartsConfirmed >= totalPartsRequired
      : totalConfirmed >= totalRequired;

  return {
    totalBikesRequired,
    totalBikesConfirmed,
    totalPartsRequired,
    totalPartsConfirmed,
    alienCount,
    progressPercent,
    isGroupFullyVerified,
  };
}

/**
 * Estado inicial vacío.
 */
export function createInitialLiveSessionState(): LiveSessionState {
  return {
    status: 'idle',
    errorMessage: null,
    groupId: null,
    orders: [],
    items: [],
    confirmedBoxes: [],
    activeProposal: null,
    alienDetections: [],
    knownSerials: [],
    stats: {
      totalBikesRequired: 0,
      totalBikesConfirmed: 0,
      totalPartsRequired: 0,
      totalPartsConfirmed: 0,
      alienCount: 0,
      progressPercent: 0,
      isGroupFullyVerified: false,
    },
  };
}

/**
 * Inicializa la sesión a partir de una o varias órdenes (grupo).
 */
export function initSessionFromOrders(
  rawOrders: Array<{
    id: string;
    order_number: string;
    status?: string;
    is_shipped?: boolean;
    customer?: { name: string } | null;
    items: Array<{
      sku: string;
      qty?: number;
      quantity?: number;
      name?: string;
      model?: string | null;
      size?: string | null;
      color?: string | null;
      sku_metadata?: { is_bike?: boolean | null; weight_lbs?: number | null } | null;
      [key: string]: any;
    }>;
  }>,
  groupId: string | null = null
): LiveSessionState {
  const orders: OrderContext[] = [];
  const items: SessionItemLedger[] = [];

  for (const o of rawOrders) {
    let orderUnits = 0;
    const orderItems = Array.isArray(o.items) ? o.items : [];

    for (let idx = 0; idx < orderItems.length; idx++) {
      const item = orderItems[idx];
      const qty = Number(item.quantity ?? item.qty ?? 1);
      orderUnits += qty;

      const isBike = isBikeSku(item.sku, item.sku_metadata);

      items.push({
        id: `${o.id}-${item.sku}-${idx}`,
        orderId: o.id,
        orderNumber: o.order_number,
        sku: item.sku,
        name: item.name ?? null,
        quantity: qty,
        verifiedQuantity: 0,
        isBike,
        model: item.model ?? null,
        size: item.size ?? null,
        color: item.color ?? null,
      });
    }

    orders.push({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status || 'ready_to_double_check',
      totalUnits: orderUnits,
      isShipped: Boolean(o.is_shipped),
      customerName: o.customer?.name ?? null,
    });
  }

  const stats = calculateSessionStats(items, [], 0);

  return {
    status: 'ready',
    errorMessage: null,
    groupId,
    orders,
    items,
    confirmedBoxes: [],
    activeProposal: null,
    alienDetections: [],
    knownSerials: [],
    stats,
  };
}

/**
 * Propone un candidato detectado por la cámara y lo concilia en el estado.
 */
export function setCandidateProposal(
  state: LiveSessionState,
  candidate: ProposedBoxCandidate
): LiveSessionState {
  const reconciliation = reconcileCandidate(candidate, state.items, new Set(state.knownSerials));

  return {
    ...state,
    status: 'active',
    activeProposal: reconciliation,
  };
}

/**
 * Descarta o limpia la propuesta activa del visor.
 */
export function clearActiveProposal(state: LiveSessionState): LiveSessionState {
  return {
    ...state,
    activeProposal: null,
  };
}

/**
 * Confirma la caja propuesta por el operador:
 * "Un toque = una caja".
 * Incrementa la cantidad verificada en el ítem correspondiente de la orden.
 */
export function confirmActiveBox(state: LiveSessionState): {
  state: LiveSessionState;
  confirmedBox: ConfirmedBox | null;
} {
  const proposal = state.activeProposal;
  if (
    !proposal ||
    !proposal.candidate.sku ||
    proposal.population === 'UNIDENTIFIED' ||
    proposal.population === 'CONFLICT'
  ) {
    return { state, confirmedBox: null };
  }

  // Si es alien (Población B), se registra como alien detection
  if (proposal.population === 'B') {
    const alien: AlienDetection = {
      sku: proposal.candidate.sku,
      rawBarcode: proposal.candidate.rawBarcode,
      detectedAt: Date.now(),
      reason: 'No pertenece a ninguna orden del grupo',
    };
    const nextAliens = [...state.alienDetections, alien];
    const nextStats = calculateSessionStats(state.items, state.confirmedBoxes, nextAliens.length);
    return {
      state: {
        ...state,
        alienDetections: nextAliens,
        activeProposal: null,
        stats: nextStats,
      },
      confirmedBox: null,
    };
  }

  const targetOrderId = proposal.targetOrderId || state.orders[0]?.id || '';
  const targetOrderNumber = proposal.targetOrderNumber || state.orders[0]?.orderNumber || '';

  const newBox: ConfirmedBox = {
    id: `box-${Date.now()}-${state.confirmedBoxes.length + 1}`,
    sku: proposal.candidate.sku,
    serial: proposal.candidate.serial || null,
    targetOrderId,
    targetOrderNumber,
    confirmedAt: Date.now(),
    sourceBarcode: proposal.candidate.rawBarcode,
    isDuplicateSerial: proposal.isDuplicateSerial,
    isAlien: false,
    quantityConfirmed: 1,
  };

  const normTargetSku = normalizeSkuForCompare(proposal.candidate.sku);

  // Actualizar el primer ítem que necesite verificación de este SKU
  let updatedLedger = false;
  const nextItems = state.items.map((item) => {
    if (
      !updatedLedger &&
      item.orderId === targetOrderId &&
      normalizeSkuForCompare(item.sku) === normTargetSku &&
      item.verifiedQuantity < item.quantity
    ) {
      updatedLedger = true;
      return {
        ...item,
        verifiedQuantity: item.verifiedQuantity + 1,
      };
    }
    return item;
  });

  // Si todos estaban cubiertos pero el operador forzó confirmación
  const finalItems = updatedLedger
    ? nextItems
    : state.items.map((item) => {
        if (
          !updatedLedger &&
          item.orderId === targetOrderId &&
          normalizeSkuForCompare(item.sku) === normTargetSku
        ) {
          updatedLedger = true;
          return {
            ...item,
            verifiedQuantity: item.verifiedQuantity + 1,
          };
        }
        return item;
      });

  const nextConfirmed = [...state.confirmedBoxes, newBox];
  const nextSerials = proposal.candidate.serial
    ? [...state.knownSerials, proposal.candidate.serial.toUpperCase()]
    : state.knownSerials;

  const nextStats = calculateSessionStats(finalItems, nextConfirmed, state.alienDetections.length);

  return {
    state: {
      ...state,
      items: finalItems,
      confirmedBoxes: nextConfirmed,
      knownSerials: nextSerials,
      activeProposal: null,
      stats: nextStats,
    },
    confirmedBox: newBox,
  };
}

/**
 * Confirma a mano una unidad de un ítem del checklist.
 *
 * La cámara no siempre puede: etiqueta rota, caja apilada con la etiqueta
 * contra la pared, OCR que no acierta con esa tipografía. Sin esta salida la
 * orden no se termina y el operador vuelve a la tablilla con todo el barrido
 * perdido. Con ella, el peor caso de pickd es ser tan rápido como la tablilla,
 * nunca más lento — y eso saca a la calidad del reconocimiento del camino
 * crítico del MVP.
 *
 * No permite pasar de lo que la orden pide: confirmar de más a mano es
 * justamente como se marca cargada una bici que sigue en el piso.
 */
export function manuallyConfirmItem(
  state: LiveSessionState,
  itemId: string
): { state: LiveSessionState; confirmedBox: ConfirmedBox | null } {
  const item = state.items.find((i) => i.id === itemId);
  if (!item || item.verifiedQuantity >= item.quantity) {
    return { state, confirmedBox: null };
  }

  const newBox: ConfirmedBox = {
    id: `box-manual-${Date.now()}-${state.confirmedBoxes.length + 1}`,
    sku: item.sku,
    // La cámara no leyó nada, así que no hay serial que atribuirle a esta caja.
    serial: null,
    targetOrderId: item.orderId,
    targetOrderNumber: item.orderNumber,
    confirmedAt: Date.now(),
    sourceBarcode: 'MANUAL',
    isDuplicateSerial: false,
    isAlien: false,
    quantityConfirmed: 1,
    isManual: true,
  };

  const nextItems = state.items.map((i) =>
    i.id === itemId ? { ...i, verifiedQuantity: i.verifiedQuantity + 1 } : i
  );
  const nextConfirmed = [...state.confirmedBoxes, newBox];

  return {
    state: {
      ...state,
      items: nextItems,
      confirmedBoxes: nextConfirmed,
      // Una confirmación manual cancela lo que la cámara estuviera proponiendo:
      // el operador ya resolvió esa caja por otra vía.
      activeProposal: null,
      stats: calculateSessionStats(nextItems, nextConfirmed, state.alienDetections.length),
    },
    confirmedBox: newBox,
  };
}

/**
 * Deshace la última confirmación de caja (operación de reversión ergonómica).
 */
export function undoLastConfirmation(state: LiveSessionState): LiveSessionState {
  if (state.confirmedBoxes.length === 0) return state;

  const lastBox = state.confirmedBoxes[state.confirmedBoxes.length - 1];
  const nextConfirmed = state.confirmedBoxes.slice(0, -1);

  const normBoxSku = normalizeSkuForCompare(lastBox.sku);

  // Decrementar verifiedQuantity en el ítem correspondiente
  let decremented = false;
  // Buscar en reversa para restar del último ítem incrementado
  const nextItems = [...state.items]
    .reverse()
    .map((item) => {
      if (
        !decremented &&
        item.orderId === lastBox.targetOrderId &&
        normalizeSkuForCompare(item.sku) === normBoxSku &&
        item.verifiedQuantity > 0
      ) {
        decremented = true;
        return {
          ...item,
          verifiedQuantity: item.verifiedQuantity - lastBox.quantityConfirmed,
        };
      }
      return item;
    })
    .reverse();

  const nextSerials = lastBox.serial
    ? state.knownSerials.filter((s) => s !== lastBox.serial!.toUpperCase())
    : state.knownSerials;

  const nextStats = calculateSessionStats(nextItems, nextConfirmed, state.alienDetections.length);

  return {
    ...state,
    items: nextItems,
    confirmedBoxes: nextConfirmed,
    knownSerials: nextSerials,
    stats: nextStats,
  };
}
