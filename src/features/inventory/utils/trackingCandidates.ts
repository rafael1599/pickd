/**
 * The tracking number in a photo of a FedEx label (idea-250; moved from the
 * FedEx Returns intake bar, where it was born).
 *
 * FedEx tracking is typically 12, 15, or 20 digits. In GS1-128 encoded strings
 * (the real FedEx barcodes) the tracking lives at the END of a longer numeric
 * string, so both suffix slices and prefix matches are offered.
 */
export function trackingCandidates(rawResults: string[]): string[] {
  const out = new Set<string>();
  for (const raw of rawResults) {
    // Suffix slices first — in GS1-128 the tracking is at the end, and the
    // Set keeps insertion order.
    if (/^\d+$/.test(raw)) {
      if (raw.length >= 12) out.add(raw.slice(-12));
      if (raw.length >= 15) out.add(raw.slice(-15));
      if (raw.length >= 20) out.add(raw.slice(-20));
    }
    const forwardMatches = raw.match(/\d{20}|\d{15}|\d{12}/g);
    if (forwardMatches) forwardMatches.forEach((m) => out.add(m));
    out.add(raw);
  }
  return Array.from(out);
}

/** The likeliest tracking: 12 digits (FedEx Ground), then 15, then any number. */
export function bestTracking(candidates: string[]): string | null {
  return (
    candidates.find((c) => /^\d{12}$/.test(c)) ??
    candidates.find((c) => /^\d{15}$/.test(c)) ??
    candidates.find((c) => /^\d+$/.test(c)) ??
    candidates[0] ??
    null
  );
}

/** What a FedEx tracking looks like; anything else is allowed but flagged. */
export const looksLikeTracking = (v: string) => /^\d{12,15}$/.test(v.trim());
