/** The ways a FedEx return can be disposed (docs/prds/fedex-return-card.md, ❓3). */
export const DISPOSE_REASONS = ['Scrapped', 'Kept for parts', 'Sent back'] as const;

/** Whole days since the return came in; null when nobody knows. */
export const daysWaiting = (iso: string | null | undefined, now = Date.now()) =>
  iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000)) : null;
