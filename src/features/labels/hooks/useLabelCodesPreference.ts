import { useState, useEffect, useCallback } from 'react';

/**
 * Shared preference for whether SKU labels print WITH the QR + barcode (default)
 * or codeless (text enlarged to fill the label). Persisted in localStorage so it
 * survives sessions and is consistent across every print entry point, mirroring
 * useLabelLayoutPreference.
 */

const STORAGE_KEY = 'pickd-label-codes';
const DEFAULT_CODES = true;

const parse = (v: string | null): boolean => (v === null ? DEFAULT_CODES : v === 'true');

/** Read the preference synchronously (for use in non-React contexts). */
export function getLabelCodesPreference(): boolean {
  if (typeof window === 'undefined') return DEFAULT_CODES;
  return parse(window.localStorage.getItem(STORAGE_KEY));
}

/** React hook with reactive get/set. */
export function useLabelCodesPreference(): [boolean, (withCodes: boolean) => void] {
  const [codes, setCodesState] = useState<boolean>(getLabelCodesPreference);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setCodesState(parse(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setCodes = useCallback((next: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, String(next));
    setCodesState(next);
  }, []);

  return [codes, setCodes];
}
