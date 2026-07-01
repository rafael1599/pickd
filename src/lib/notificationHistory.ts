/**
 * Notification history — captura discreta de los toasts para revisión posterior.
 *
 * Los toasts en pantalla son efímeros (desaparecen en ~1-2.5s). Para no perder
 * mensajes importantes (sobre todo errores), este store los graba en un log
 * persistente (localStorage) que el usuario puede abrir desde Settings.
 *
 * La captura es 100% pasiva: `useToastHistoryRecorder()` observa el store de
 * react-hot-toast vía `useToasterStore()` y graba cada toast nuevo. No requiere
 * cambiar ninguna de las ~250 llamadas a `toast(...)` existentes.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useToasterStore } from 'react-hot-toast';

export type NotificationKind = 'success' | 'error' | 'info';

export interface NotificationEntry {
  id: string;
  kind: NotificationKind;
  message: string;
  at: number; // epoch ms
}

const STORAGE_KEY = 'pickd.notifications.history';
const MAX_ENTRIES = 200;

function load(): NotificationEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NotificationEntry[]) : [];
  } catch {
    return [];
  }
}

let entries: NotificationEntry[] = load();
let seq = 0;
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage lleno o no disponible — el log en memoria sigue funcionando.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function addNotification(kind: NotificationKind, message: string) {
  const clean = message.trim();
  if (!clean) return;
  const entry: NotificationEntry = {
    id: `${Date.now()}-${seq++}`,
    kind,
    message: clean,
    at: Date.now(),
  };
  // Newest-first, cap al máximo. Nueva referencia para useSyncExternalStore.
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  persist();
  emit();
}

export function clearNotifications() {
  if (entries.length === 0) return;
  entries = [];
  persist();
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): NotificationEntry[] {
  return entries;
}

/** Historial reactivo, newest-first. */
export function useNotifications(): NotificationEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Observa el store de react-hot-toast y graba cada toast nuevo en el historial.
 * Montar UNA sola vez (dentro de `SwipeableToaster`). Ignora `loading` (efímero)
 * y mensajes que no sean string (JSX/custom no se pueden serializar).
 */
export function useToastHistoryRecorder() {
  const { toasts } = useToasterStore();

  useEffect(() => {
    for (const t of toasts) {
      if (recordedIds.has(t.id)) continue;
      recordedIds.add(t.id);

      if (t.type === 'loading') continue;
      if (typeof t.message !== 'string') continue;

      const kind: NotificationKind =
        t.type === 'success' ? 'success' : t.type === 'error' ? 'error' : 'info';
      addNotification(kind, t.message);
    }

    // Evita crecimiento ilimitado del Set: si se infla, reconstruye con los ids activos.
    if (recordedIds.size > 1000) {
      const active = new Set(toasts.map((t) => t.id));
      recordedIds = active;
    }
  }, [toasts]);
}

let recordedIds = new Set<string>();
