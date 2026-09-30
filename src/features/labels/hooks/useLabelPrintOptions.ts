import { useCallback, useEffect, useState } from 'react';

/**
 * The one print choice left on a SKU label: whether to print the UPC line.
 * Persisted per device so the print window opens on the last choice.
 *
 * Orientation, QR and barcode stopped being choices on 30 Sep 2026 (Rafael):
 * every label is 6×4 horizontal with its QR and its Code 128. The barcode stays
 * even though nobody scans it yet — a scan gun is coming.
 */
export interface LabelCodeOptions {
  /** Print the UPC line. Off by default (idea-212): the room goes to the SKU. */
  withUpc: boolean;
}

const UPC_KEY = 'pickd-label-upc';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* storage blocked: use the default */
  }
  return fallback;
}

/** Read the options synchronously (for use in non-React contexts). */
export function getLabelCodeOptions(): LabelCodeOptions {
  return { withUpc: readFlag(UPC_KEY, false) };
}

/** React hook with reactive get/set (syncs across tabs). */
export function useLabelCodeOptions(): [LabelCodeOptions, (next: LabelCodeOptions) => void] {
  const [opts, setOptsState] = useState<LabelCodeOptions>(getLabelCodeOptions);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === UPC_KEY) setOptsState(getLabelCodeOptions());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setOpts = useCallback((next: LabelCodeOptions) => {
    try {
      window.localStorage.setItem(UPC_KEY, String(next.withUpc));
    } catch {
      /* storage blocked: the choice lasts this session only */
    }
    setOptsState(next);
  }, []);

  return [opts, setOpts];
}
