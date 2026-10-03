/**
 * La línea de tiempo de un envío (idea-245, F0): qué se escribe en
 * `pallet_events` por cada marca y cada edición de tarima. Puro: el cliente que
 * inserta vive en `api/palletEvents.ts`.
 *
 * F0 sólo guarda. Nada lee todavía estos eventos para decidir una tarima; lo
 * hará `palletTimeline` en F1 (`docs/prds/pallet-box-inference.md` §6.3).
 */
import type { PalletDimsEntry } from '../../../utils/palletDims';

export type PalletEventKind = 'check' | 'uncheck' | 'edit' | 'front' | 'answer';

/**
 * `pick` = antes de Ready to DC: el orden de las marcas del picker es el orden
 * de carga (Rafael, 3 oct 2026). `check` = después: quien verifica marca para
 * guiarse y eso no mueve ninguna caja.
 */
export type PalletEventPhase = 'pick' | 'check';

export interface PalletEventRow {
  id: string;
  client_at: string;
  device: string | null;
  list_id: string | null;
  kind: PalletEventKind;
  phase: PalletEventPhase | null;
  sku: string | null;
  location: string | null;
  cart_pallet: number | null;
  pallet: number | null;
  payload: Record<string, unknown>;
  /** Sólo frentes: la hora de la cámara (§6.7). */
  taken_at?: string | null;
}

/** Lo que el evento necesita de una línea del carrito. */
export interface MarkLine {
  sku: string;
  location?: string | null;
  source_list_id?: string | null;
}

export interface EventContext {
  newId: () => string;
  now: () => string;
  device: string | null;
  /** La lista abierta: la de una línea sin `source_list_id`. */
  listId: string | null;
}

/** La llave del carrito: `${pallet}-${sku}-${location}`. */
export const markKey = (pallet: number | string, line: MarkLine) =>
  `${pallet}-${line.sku}-${line.location}`;

const palletNumber = (value: number | string): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) ? n : null;
};

/** Una marca o desmarca hecha con el dedo, línea por línea. */
export function markEvent(
  line: MarkLine,
  cartPallet: number | string,
  checking: boolean,
  phase: PalletEventPhase | null,
  ctx: EventContext
): PalletEventRow {
  return {
    id: ctx.newId(),
    client_at: ctx.now(),
    device: ctx.device,
    list_id: line.source_list_id || ctx.listId,
    kind: checking ? 'check' : 'uncheck',
    phase,
    sku: line.sku,
    location: line.location ?? null,
    cart_pallet: palletNumber(cartPallet),
    pallet: null,
    payload: {},
  };
}

/**
 * Select all / Clear: lo que cambió entre dos conjuntos de llaves, con
 * `bulk: true` — el orden de un gesto masivo no es el orden de carga. Una llave
 * cuyo SKU y ubicación no están en el carrito no se puede atribuir y se salta.
 */
export function bulkMarkEvents(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  lines: readonly MarkLine[],
  phase: PalletEventPhase | null,
  ctx: EventContext
): PalletEventRow[] {
  const byTail = new Map(lines.map((l) => [`${l.sku}-${l.location}`, l]));
  const out: PalletEventRow[] = [];
  const emit = (key: string, checking: boolean) => {
    const dash = key.indexOf('-');
    if (dash < 0) return;
    const line = byTail.get(key.slice(dash + 1));
    if (!line) return;
    out.push({
      ...markEvent(line, key.slice(0, dash), checking, phase, ctx),
      payload: { bulk: true },
    });
  };
  for (const key of after) if (!before.has(key)) emit(key, true);
  for (const key of before) if (!after.has(key)) emit(key, false);
  return out;
}

/** Los campos de una tarima que dicen qué lleva (no la cinta: medir no es armar). */
const CONTENT_FIELDS = ['items', 'bikes', 'split', 'parts'] as const;

/**
 * Una edición guardada de `pallet_dims`: un evento por campo de contenido que
 * cambió en una tarima tocada en este dispositivo. Se calcula al escribir, con
 * lo que había en la base justo antes, así un valor tecleado y borrado sin
 * guardar no deja rastro.
 */
export function editEvents(
  before: readonly PalletDimsEntry[],
  after: readonly PalletDimsEntry[],
  touched: ReadonlySet<number>,
  ctx: EventContext
): PalletEventRow[] {
  const out: PalletEventRow[] = [];
  for (const pallet of [...touched].sort((a, b) => a - b)) {
    const was = before.find((e) => e.pallet === pallet);
    const now = after.find((e) => e.pallet === pallet);
    for (const field of CONTENT_FIELDS) {
      const from = was?.[field] ?? null;
      const to = now?.[field] ?? null;
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      out.push({
        id: ctx.newId(),
        client_at: ctx.now(),
        device: ctx.device,
        list_id: ctx.listId,
        kind: 'edit',
        phase: null,
        sku: null,
        location: null,
        cart_pallet: null,
        pallet,
        payload: { field, from, to },
      });
    }
  }
  return out;
}

/** Una foto que fue frente: la tarima que se le dio y lo que se vio (sólo SKUs). */
export function frontEvent(
  front: {
    photoId: string;
    takenAt: number;
    pallet: number | null;
    frontCase: string;
    applied: boolean;
    seen: { sku: string; count: number }[];
  },
  ctx: EventContext
): PalletEventRow {
  return {
    id: ctx.newId(),
    client_at: ctx.now(),
    device: ctx.device,
    list_id: ctx.listId,
    kind: 'front',
    phase: null,
    sku: null,
    location: null,
    cart_pallet: null,
    pallet: front.pallet,
    payload: {
      photo_id: front.photoId,
      case: front.frontCase,
      applied: front.applied,
      seen: front.seen,
    },
    taken_at: new Date(front.takenAt).toISOString(),
  };
}

/**
 * Lo que el picker contesta a un frente: ✓ / ✗ a una caja que no se veía
 * (`present`), la tarima que elige en un empate (`chose`) o aplicar uno que
 * se quedó sin aplicar (`apply`).
 */
export function answerEvent(
  answer: {
    photoId: string;
    pallet: number;
    sku?: string;
    location?: string | null;
    present?: boolean;
    chose?: boolean;
    apply?: boolean;
  },
  ctx: EventContext
): PalletEventRow {
  const { photoId, pallet, sku, location, ...rest } = answer;
  return {
    id: ctx.newId(),
    client_at: ctx.now(),
    device: ctx.device,
    list_id: ctx.listId,
    kind: 'answer',
    phase: null,
    sku: sku ?? null,
    location: location ?? null,
    cart_pallet: null,
    pallet,
    payload: { photo_id: photoId, ...rest },
  };
}
