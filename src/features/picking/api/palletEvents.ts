/**
 * Escribe la línea de tiempo de un envío en `pallet_events` (idea-245, F0).
 *
 * **Nunca lanza ni espera a nadie**: una marca no puede quedarse colgada porque
 * la red tarde. Sin señal, los eventos esperan en el teléfono y salen al volver. Cada evento lleva su `id` (un reintento no duplica: `ON
 * CONFLICT DO NOTHING`) y su `client_at`, así que el orden sobrevive aunque el
 * insert llegue tarde. El envío, el grupo y el usuario los sella la base.
 */
import { supabase } from '../../../lib/supabase';
import type { EventContext, PalletEventRow } from '../utils/palletEvents';

// pallet_events is newer than the generated Supabase types: a narrow, locally
// typed wrapper instead of `any`, as in dcvShadow.
const fromPalletEvents = () =>
  (
    supabase.from.bind(supabase) as unknown as (t: 'pallet_events') => {
      upsert: (
        rows: PalletEventRow[],
        opts: { onConflict: string; ignoreDuplicates: boolean }
      ) => Promise<{ error: { message: string } | null }>;
    }
  )('pallet_events');

const DEVICE_KEY = 'pickd.device_id';

/** Un id estable por navegador: distingue dos teléfonos sin guardar el UA. */
export function deviceId(): string | null {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export const eventContext = (listId: string | null): EventContext => ({
  newId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  device: deviceId(),
  listId,
});

/**
 * What could not be sent yet: a phone in the back of the warehouse loses
 * signal, and the time of a tick is exactly what this table exists to keep.
 * Each row already carries its id and its `client_at`, so a late retry keeps
 * the order and a double send is a no-op. Capped so a phone that never gets
 * back online cannot fill its storage.
 */
const QUEUE_KEY = 'pickd.pallet_events_queue';
const QUEUE_MAX = 2000;

const readQueue = (): PalletEventRow[] => {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PalletEventRow[]) : [];
  } catch {
    return [];
  }
};

const writeQueue = (rows: PalletEventRow[]) => {
  try {
    if (rows.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(-QUEUE_MAX)));
  } catch {
    /* storage full or blocked: nothing else to do */
  }
};

let sending = false;
let onlineHooked = false;

async function sendQueued(): Promise<void> {
  if (sending) return;
  const rows = readQueue();
  if (rows.length === 0) return;
  sending = true;
  try {
    const { error } = await fromPalletEvents().upsert(rows, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
    // Only what was sent leaves: ticks queued meanwhile stay for the next try.
    const sent = new Set(rows.map((r) => r.id));
    writeQueue(readQueue().filter((r) => !sent.has(r.id)));
    sending = false;
    if (readQueue().length > 0) void sendQueued();
  } catch (e) {
    sending = false;
    console.warn('[palletEvents] queued, will retry:', e);
  }
}

/** Never throws, never waits: queue first, then try to send everything queued. */
export function recordPalletEvents(rows: PalletEventRow[]): void {
  if (!onlineHooked && typeof window !== 'undefined') {
    onlineHooked = true;
    window.addEventListener('online', () => void sendQueued());
  }
  if (rows.length > 0) writeQueue([...readQueue(), ...rows]);
  void sendQueued();
}
