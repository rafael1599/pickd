import { useState, useEffect, useCallback } from 'react';

/**
 * Shared preference for the user's preferred SKU label layout.
 * Persisted in localStorage so it survives across sessions and is consistent
 * across all label print entry points (Label Studio, ItemDetailView quick
 * print, HistoryMode reprint, etc.).
 *
 * Default: 'vertical' (matches Label Studio's current default).
 */

export type LabelLayout = 'standard' | 'vertical';

const STORAGE_KEY = 'pickd-label-layout';
const DEFAULT_LAYOUT: LabelLayout = 'vertical';

/** Read the preference synchronously (for use in non-React contexts). */
export function getLabelLayoutPreference(): LabelLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'standard' || stored === 'vertical' ? stored : DEFAULT_LAYOUT;
}

/** React hook with reactive get/set. */
export function useLabelLayoutPreference(): [LabelLayout, (layout: LabelLayout) => void] {
  const [layout, setLayoutState] = useState<LabelLayout>(getLabelLayoutPreference);

  // Sync across tabs/windows
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'standard' || e.newValue === 'vertical')) {
        setLayoutState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLayout = useCallback((next: LabelLayout) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setLayoutState(next);
  }, []);

  return [layout, setLayout];
}
