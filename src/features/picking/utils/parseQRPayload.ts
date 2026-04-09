export interface QRPayload {
  shortCode: string;
  sku: string;
}

export function parseQRPayload(raw: string): QRPayload | null {
  // Try URL format first: .../tag/PK-X/TOKEN?sku=SKU
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/');
    const tagIdx = parts.indexOf('tag');
    if (tagIdx >= 0 && parts[tagIdx + 1]) {
      const sku = url.searchParams.get('sku');
      if (sku) return { shortCode: parts[tagIdx + 1], sku: decodeURIComponent(sku) };
    }
  } catch {
    /* not a URL */
  }

  // Legacy fallback: PK-X|SKU
  const pipe = raw.split('|');
  if (pipe.length >= 2 && pipe[0].startsWith('PK-')) {
    return { shortCode: pipe[0], sku: pipe[1] };
  }

  return null;
}

/** Aggregate scan results: count unique QRs per SKU */
export function aggregateScanResults(
  payloads: QRPayload[],
  orderSkus: string[],
): { matched: Map<string, Set<string>>; unmatched: QRPayload[] } {
  const matched = new Map<string, Set<string>>();
  const unmatched: QRPayload[] = [];
  const orderSkuSet = new Set(orderSkus.map((s) => s.toUpperCase()));

  for (const p of payloads) {
    if (orderSkuSet.has(p.sku.toUpperCase())) {
      const set = matched.get(p.sku) ?? new Set();
      set.add(p.shortCode);
      matched.set(p.sku, set);
    } else {
      unmatched.push(p);
    }
  }

  return { matched, unmatched };
}
