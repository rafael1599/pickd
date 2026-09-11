import { useCallback, useSyncExternalStore } from 'react';
import { LED_MODES, nextLedMode, type LedMode } from '../utils/led/ledText';

/**
 * The LED sign's mode — one per device, shared by every sign on it. Holding the
 * Ship sign steps to the next mode; the board's signs follow, because the mode
 * is how a person likes to read, not a property of an order.
 */
const STORAGE_KEY = 'pickd.led.mode';

const listeners = new Set<() => void>();
let current: LedMode | null = null;

function read(): LedMode {
  if (current) return current;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the default is fine.
  }
  current = LED_MODES.find((m) => m === stored) ?? 'rotate';
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLedMode(): [LedMode, () => void] {
  const mode = useSyncExternalStore(subscribe, read, () => 'rotate' as const);
  const cycle = useCallback(() => {
    current = nextLedMode(read());
    try {
      localStorage.setItem(STORAGE_KEY, current);
    } catch {
      // Still changes for this session.
    }
    listeners.forEach((l) => l());
  }, []);
  return [mode, cycle];
}
