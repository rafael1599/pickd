/**
 * Success pulse — confirmación de éxito breve y con marca (el check de PickD).
 *
 * Reemplaza al toast pegajoso de "sesión completada" por una animación central
 * que aparece, celebra, y desaparece sola (~1.2s). No requiere que el usuario
 * la cierre ni la deslice.
 *
 * `celebrateSuccess(message)` también graba en el historial de notificaciones,
 * así que el registro sigue completo aunque el splash sea efímero.
 */

import { useSyncExternalStore } from 'react';
import { addNotification } from './notificationHistory';

export interface SuccessPulse {
  /** Cambia en cada disparo — dispara el re-render/replay del splash. */
  id: number;
  message?: string;
}

let current: SuccessPulse | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Dispara la animación del check de PickD. Opcionalmente graba en el historial. */
export function celebrateSuccess(message?: string) {
  current = { id: ++seq, message };
  if (message) addNotification('success', message);
  // Feedback háptico en móvil (glanceable, no molesta). No-op donde no exista.
  try {
    navigator.vibrate?.(25);
  } catch {
    // Algunos navegadores lanzan si la API está bloqueada — ignorar.
  }
  emit();
}

export function clearSuccessPulse() {
  if (current === null) return;
  current = null;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): SuccessPulse | null {
  return current;
}

export function useSuccessPulse(): SuccessPulse | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
