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
import type { PalletDimsEntry } from '../../../utils/palletDims';

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
  /** Escribe ya lo pendiente — al pulsar Photo, al completar. */
  flush: () => Promise<void>;
}

/** Lo leído y lo tecleado, marcado con la orden a la que pertenece. */
interface DimsState {
  listId: string | null;
  entries: PalletDimsEntry[];
  isFetched: boolean;
}

const EMPTY: PalletDimsEntry[] = [];

export function usePalletDims(listId: string | null): UsePalletDims {
  /**
   * El estado lleva dentro de qué orden es. Cambiar de orden **no** se limpia
   * con un efecto: se deriva. Si se limpiara, habría un render con las medidas
   * de la orden anterior antes de que el efecto corriera — y quien las mira
   * está en la orden nueva.
   */
  const [state, setState] = useState<DimsState>({ listId: null, entries: [], isFetched: false });
  const mine = state.listId === listId;
  const entries = mine ? state.entries : EMPTY;
  const isFetched = mine && state.isFetched;

  const entriesRef = useRef<PalletDimsEntry[]>([]);
  /** Ordinales tocados en este dispositivo y aún sin escribir. */
  const dirtyRef = useRef<Set<number>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listIdRef = useRef<string | null>(null);

  // Lo último escrito, para que `flush` lo lea desde un timeout o al desmontar
  // sin volver a crearse en cada cambio. Se pone al día después del render.
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    listIdRef.current = listId;
    dirtyRef.current = new Set();
    if (!listId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('picking_lists')
        .select('pallet_dims')
        .eq('id', listId)
        .single();
      if (cancelled) return;
      const fromDb = parseEntries(data?.pallet_dims);
      setState((prev) => ({
        listId,
        // Lo tecleado aquí mientras cargaba gana: la lectura sólo rellena.
        entries:
          prev.listId === listId
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
  }, [listId]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const id = listIdRef.current;
    const dirty = dirtyRef.current;
    if (!id || dirty.size === 0) return;
    const mine = entriesRef.current.filter((e) => dirty.has(e.pallet));
    dirtyRef.current = new Set();
    try {
      const { data } = await supabase
        .from('picking_lists')
        .select('pallet_dims')
        .eq('id', id)
        .single();
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
            (e.split != null && e.split > 1)
        )
        .sort((a, b) => a.pallet - b.pallet);
      await supabase
        .from('picking_lists')
        .update({ pallet_dims: merged as unknown as Json } as never)
        .eq('id', id);
      setState({ listId: id, entries: merged, isFetched: true });
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

  const setParts = useCallback(
    (pallet: number, value: number | null, units: number) => {
      dirtyRef.current.add(pallet);
      setState((prev) => {
        const found = prev.entries.find((e) => e.pallet === pallet);
        const next: PalletDimsEntry = { ...(found ?? emptyEntry(pallet, units)), parts: value };
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

  const setSplit = useCallback(
    (pallet: number, value: number | null, units: number) => {
      dirtyRef.current.add(pallet);
      setState((prev) => {
        const found = prev.entries.find((e) => e.pallet === pallet);
        const split = value != null && value > 1 ? Math.floor(value) : null;
        const next: PalletDimsEntry = { ...(found ?? emptyEntry(pallet, units)), split };
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

  // Salir de la pantalla no puede perder lo tecleado.
  useEffect(() => () => void flush(), [flush]);

  return { entries, isFetched, setAxis, setParts, setSplit, flush };
}
