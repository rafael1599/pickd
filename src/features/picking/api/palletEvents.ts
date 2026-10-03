/**
 * Escribe la línea de tiempo de un envío en `pallet_events` (idea-245, F0).
 *
 * **Nunca lanza ni espera a nadie**: una marca no puede quedarse colgada porque
 * la red tarde. Cada evento lleva su `id` (un reintento no duplica: `ON
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

export function recordPalletEvents(rows: PalletEventRow[]): void {
  if (rows.length === 0) return;
  void fromPalletEvents()
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    .then(({ error }) => {
      if (error) console.warn('[palletEvents] not recorded:', error.message);
    })
    .catch((e: unknown) => console.warn('[palletEvents] not recorded:', e));
}
