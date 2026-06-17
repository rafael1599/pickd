import { useCallback, useEffect, useState } from 'react';

/**
 * Which codes to print on a SKU label. Persisted per-device so the print window
 * opens pre-filled with the user's last choice. Orientation lives separately in
 * `useLabelLayoutPreference` (it's per-item in Label Studio).
 */
export interface LabelCodeOptions {
  withQr: boolean;
  withBarcode: boolean;
}

const QR_KEY = 'pickd-label-qr';
const BC_KEY = 'pickd-label-barcode';
// The pre-split single switch. When the granular keys are unset we seed from it
// so a user who had "codes off" keeps both QR and barcode off.
const LEGACY_CODES_KEY = 'pickd-label-codes';

function readFlag(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const v = window.localStorage.getItem(key);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

/** Read the options synchronously (for use in non-React contexts). */
export function getLabelCodeOptions(): LabelCodeOptions {
  const legacy = readFlag(LEGACY_CODES_KEY, true);
  return {
    withQr: readFlag(QR_KEY, legacy),
    withBarcode: readFlag(BC_KEY, legacy),
  };
}

/** React hook with reactive get/set (syncs across tabs). */
export function useLabelCodeOptions(): [LabelCodeOptions, (next: LabelCodeOptions) => void] {
  const [opts, setOptsState] = useState<LabelCodeOptions>(getLabelCodeOptions);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === QR_KEY || e.key === BC_KEY || e.key === LEGACY_CODES_KEY) {
        setOptsState(getLabelCodeOptions());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setOpts = useCallback((next: LabelCodeOptions) => {
    window.localStorage.setItem(QR_KEY, String(next.withQr));
    window.localStorage.setItem(BC_KEY, String(next.withBarcode));
    setOptsState(next);
  }, []);

  return [opts, setOpts];
}
