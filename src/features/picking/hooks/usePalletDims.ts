/**
 * Las medidas del pallet: se teclean aquí, se leen en Ship.
 *
 * Viven en `picking_lists.pallet_dims`, en la fila que Double Check tiene
 * abierta — que en una combinada es el ancla, la misma regla que ya sigue el
 * override de `pallets_qty`. No es estado local a propósito: se teclea en el
 * teléfono del piso y se lee en la estación de envío, que es otro aparato.
 *
 * ## Dos reglas que este hook existe para no romper
 *
 * - **Sólo se escribe lo que cambió en ESTE dispositivo** (`dirtyRef`). Una
 *   hidratación desde la base entra en el mismo estado, y espejarla de vuelta
 *   fue el bug que vació las marcas de una orden parkeada (`verified_item_keys`,
 *   25 ago 2026). Al vaciar se relee la fila y se fusiona: lo que tocó otro se
 *   respeta, lo tocado aquí manda.
 * - **Nunca por tecla.** Se vacía al salir del campo, con un debounce de red
 *   detrás, y a la fuerza al completar. Escribir en cada eco de realtime costó
 *   120 PATCH en 62 s (bug-026).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Json } from '../../../lib/database.types';
import type { PalletDimsEntry, PalletItemPick } from '../../../utils/palletDims';
import { eventContext, recordPalletEvents } from '../api/palletEvents';
import { editEvents } from '../utils/palletEvents';

/** Cuánto se espera antes de escribir cuando nadie ha salido del campo. */
const FLUSH_DELAY_MS = 800;

type Axis = 'length_in' | 'width_in' | 'height_in';

const emptyEntry = (pallet: number, units: number): PalletDimsEntry => ({
  pallet,
  length_in: null,
  width_in: null,
  height_in: null,
  units,
});

const parseEntries = (raw: unknown): PalletDimsEntry[] =>
  Array.isArray(raw)
    ? (raw as PalletDimsEntry[]).filter(
        (e) => e && typeof e === 'object' && typeof e.pallet === 'number'
      )
    : [];

export interface UsePalletDims {
  /** Las medidas guardadas, por ordinal de pallet. */
  entries: PalletDimsEntry[];
  /** Ya se leyó la fila: hasta entonces «no hay medidas» no significa nada. */
  isFetched: boolean;
  /** Teclea un eje de un pallet. `null` borra ese eje. */
  setAxis: (pallet: number, axis: Axis, value: number | null, units: number) => void;
  /**
   * Cuántas unidades de parte viajan en este bulto. `null` devuelve la fila al
   * reparto por defecto. **No toca la huella de la medida** (`units`,
   * `measured_at`): repartir cajas no es medir, y re-sellarla borraría el aviso
   * ámbar de una medida tomada con otro número de cajas.
   */
  setParts: (pallet: number, value: number | null, units: number) => void;
  /**
   * En cuántas tarimas quedó el bulto de niño (`pallet` es su ordinal). `null`
   * o 1 = una. Como `setParts`, no toca la huella de la medida.
   */
  setSplit: (pallet: number, value: number | null, units: number) => void;
  /**
   * Cuántas bicis lleva de verdad este pallet, cuando el piso lo dice. `null`
   * vuelve al reparto calculado. El resto se reacomoda solo, en orden de
   * recogida (`applyBikeCounts` en los grandes, `splitLines` en los de niño).
   * Como `setParts`, no toca la huella de la medida.
   */
  setBikes: (pallet: number, value: number | null, units: number) => void;
  /**
   * Una tarima que arma el picker a mano: qué líneas lleva. `null` la deshace
   * y sus bicis vuelven al reparto (`planPallets`).
   */
  setItems: (pallet: number, items: PalletItemPick[] | null) => void;
  /** Escribe ya lo pendiente — al pulsar Photo, al completar. */
  flush: () => Promise<void>;
}

/** Lo leído y lo tecleado, marcado con la orden o envío al que pertenece. */
interface DimsState {
  id: string | null;
  entries: PalletDimsEntry[];
  isFetched: boolean;
}

const EMPTY: PalletDimsEntry[] = [];

/**
 * Las tarimas armadas a mano que deja sin efecto una cifra de bicis tecleada.
 *
 * El número tecleado es lo más nuevo que dijo el piso, y vale lo más nuevo
 * (idea-245, §6.3). Pero una tarima armada a mano manda sobre las cifras, así
 * que con las tarimas armadas teclear no hacía nada: #881828, 5 oct 2026, 12 y
 * 7 a mano y un 9 tecleado en la segunda que no movió ninguna bici (Rafael: «si
 * funciona el lápiz pero cuando cambio directamente la cantidad desde el campo
 * no se agrega automáticamente»). Ahora una cifra que contradice lo armado
 * suelta **todas** las tarimas armadas de la carga —las bicis que cambian de
 * tarima salen de alguna otra— y el motor reparte con las cifras. Si la cifra
 * coincide con lo que la tarima ya lleva a mano, no suelta nada.
 */
export function builtToRelease(
  entries: readonly PalletDimsEntry[],
  pallet: number,
  value: number | null
): number[] {
  const built = entries.filter((e) => Array.isArray(e.items) && e.items.length > 0);
  if (built.length === 0 || value == null) return [];
  const own = built.find((e) => e.pallet === pallet);
  const ownQty = own?.items?.reduce((t, i) => t + (Number(i?.qty) || 0), 0);
  if (own && ownQty === value) return [];
  return built.map((e) => e.pallet);
}

export function usePalletDims(listId: string | null, shipmentId?: string | null): UsePalletDims {
  const targetId = shipmentId || listId;
  const isShipment = Boolean(shipmentId);

  /**
   * El estado lleva dentro de qué orden o envío es. Cambiar de objetivo **no** se limpia
   * con un efecto: se deriva. Si se limpiara, habría un render con las medidas
   * del anterior antes de que el efecto corriera — y quien las mira
   * está en el nuevo.
   */
  const [state, setState] = useState<DimsState>({ id: null, entries: [], isFetched: false });
  const mine = state.id === targetId;
  const entries = mine ? state.entries : EMPTY;
  const isFetched = mine && state.isFetched;

  const entriesRef = useRef<PalletDimsEntry[]>([]);
  /** Ordinales tocados en este dispositivo y aún sin escribir. */
  const dirtyRef = useRef<Set<number>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetIdRef = useRef<string | null>(null);
  const isShipmentRef = useRef<boolean>(isShipment);
  const listIdRef = useRef<string | null>(listId);

  useEffect(() => {
    isShipmentRef.current = isShipment;
    listIdRef.current = listId;
  }, [isShipment, listId]);

  // Lo último escrito, para que `flush` lo lea desde un timeout o al desmontar
  // sin volver a crearse en cada cambio. Se pone al día después del render.
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    targetIdRef.current = targetId;
    dirtyRef.current = new Set();
    if (!targetId) return;
    let cancelled = false;
    (async () => {
      const query = isShipment
        ? supabase.from('shipments').select('pallet_dims').eq('id', targetId).single()
        : supabase.from('picking_lists').select('pallet_dims').eq('id', targetId).single();

      const { data } = await query;
      if (cancelled) return;
      const fromDb = parseEntries(data?.pallet_dims);
      setState((prev) => ({
        id: targetId,
        // Lo tecleado aquí mientras cargaba gana: la lectura sólo rellena.
        entries:
          prev.id === targetId
            ? fromDb
                .filter((e) => !dirtyRef.current.has(e.pallet))
                .concat(prev.entries.filter((e) => dirtyRef.current.has(e.pallet)))
            : fromDb,
        isFetched: true,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId, isShipment]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const id = targetIdRef.current;
    const isShip = isShipmentRef.current;
    const dirty = dirtyRef.current;
    if (!id || dirty.size === 0) return;
    const mine = entriesRef.current.filter((e) => dirty.has(e.pallet));
    dirtyRef.current = new Set();
    try {
      const query = isShip
        ? supabase.from('shipments').select('pallet_dims').eq('id', id).single()
        : supabase.from('picking_lists').select('pallet_dims').eq('id', id).single();
      const { data } = await query;
      const fromDb = parseEntries(data?.pallet_dims);
      // Para un ordinal tocado aquí gana lo local **campo a campo**: si otro
      // aparato escribió algo que este nunca leyó —el reparto de partes desde
      // Ship mientras Double Check tenía la fila abierta— sobrevive en vez de
      // desaparecer bajo una copia vieja.
      const merged = fromDb
        .filter((e) => !dirty.has(e.pallet))
        .concat(
          mine.map((local) => ({ ...fromDb.find((e) => e.pallet === local.pallet), ...local }))
        )
        // Una entrada sin nada tecleado no dice nada: borrarlo todo es una
        // decisión del operador y se respeta borrando la fila entera.
        .filter(
          (e) =>
            e.length_in != null ||
            e.width_in != null ||
            e.height_in != null ||
            e.parts != null ||
            e.bikes != null ||
            (Array.isArray(e.items) && e.items.length > 0) ||
            (e.split != null && e.split > 1)
        )
        .sort((a, b) => a.pallet - b.pallet);

      if (isShip) {
        await supabase
          .from('shipments')
          .update({ pallet_dims: merged as unknown as Json } as never)
          .eq('id', id);
      } else {
        await supabase
          .from('picking_lists')
          .update({ pallet_dims: merged as unknown as Json } as never)
          .eq('id', id);
      }
      setState({ id, entries: merged, isFetched: true });
      // What this device just saved into a pallet — its boxes, bike count,
      // kids split, parts — goes into the shipment's timeline (idea-245 F0),
      // diffed against what the row held right before. The tape is not an edit
      // of what a pallet carries.
      recordPalletEvents(editEvents(fromDb, merged, dirty, eventContext(listIdRef.current)));
    } catch (err) {
      // Lo tecleado sigue en pantalla y vuelve a marcarse sucio: el siguiente
      // intento lo reescribe en vez de perderlo en silencio.
      for (const pallet of dirty) dirtyRef.current.add(pallet);
      console.error('Pallet dims save failed:', err);
    }
  }, []);

  const setAxis = useCallback(
    (pallet: number, axis: Axis, value: number | null, units: number) => {
      dirtyRef.current.add(pallet);
      setState((prev) => {
        const found = prev.entries.find((e) => e.pallet === pallet);
        const base = found ?? emptyEntry(pallet, units);
        const next: PalletDimsEntry = {
          ...base,
          [axis]: value,
          // Medir es afirmar que ESTE pallet mide esto: la huella se resella con
          // lo que hay ahora, o la medida nacería vencida.
          units,
          measured_at: new Date().toISOString(),
        };
        return {
          ...prev,
          entries: found
            ? prev.entries.map((e) => (e.pallet === pallet ? next : e))
            : [...prev.entries, next].sort((a, b) => a.pallet - b.pallet),
        };
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
    },
    [flush]
  );

  /**
   * Cambia campos de un ordinal sin tocar la huella de la medida (`units`,
   * `measured_at`) — la usan partes, tarimas de niño y bicis, que reparten
   * cajas y no miden nada.
   */
  const patchEntry = useCallback(
    (pallet: number, units: number, fields: Partial<PalletDimsEntry>) => {
      dirtyRef.current.add(pallet);
      setState((prev) => {
        const found = prev.entries.find((e) => e.pallet === pallet);
        const next: PalletDimsEntry = {
          ...(found ?? emptyEntry(pallet, units)),
          ...fields,
          edited_at: new Date().toISOString(),
        };
        return {
          ...prev,
          entries: found
            ? prev.entries.map((e) => (e.pallet === pallet ? next : e))
            : [...prev.entries, next].sort((a, b) => a.pallet - b.pallet),
        };
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
    },
    [flush]
  );

  const setParts = useCallback(
    (pallet: number, value: number | null, units: number) =>
      patchEntry(pallet, units, { parts: value }),
    [patchEntry]
  );

  const setSplit = useCallback(
    (pallet: number, value: number | null, units: number) =>
      patchEntry(pallet, units, { split: value != null && value > 1 ? Math.floor(value) : null }),
    [patchEntry]
  );

  const setBikes = useCallback(
    (pallet: number, value: number | null, units: number) => {
      const release = builtToRelease(entriesRef.current, pallet, value);
      for (const other of release) {
        if (other !== pallet) patchEntry(other, 0, { items: null });
      }
      patchEntry(
        pallet,
        units,
        release.includes(pallet) ? { bikes: value, items: null } : { bikes: value }
      );
    },
    [patchEntry]
  );

  const setItems = useCallback(
    (pallet: number, items: PalletItemPick[] | null) =>
      patchEntry(pallet, items?.reduce((sum, i) => sum + i.qty, 0) ?? 0, {
        items: items && items.length > 0 ? items : null,
      }),
    [patchEntry]
  );

  // Salir de la pantalla no puede perder lo tecleado.
  useEffect(() => () => void flush(), [flush]);

  return { entries, isFetched, setAxis, setParts, setSplit, setBikes, setItems, flush };
}
