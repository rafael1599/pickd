interface SelectableOrder {
  status: string;
}

/**
 * The order Ship opens by itself: the most recently completed one in To Ship —
 * the one a picker most likely just finished — else the newest To Ship, else
 * the most recently shipped (Rafael, 2026-08-28: never an empty preview).
 * Both lists come newest first, already filtered and with groups collapsed.
 * `prefetchAutoSelectCandidate` asks the database the same question.
 */
export function pickAutoSelectCandidate<T extends SelectableOrder>(
  toShip: readonly T[],
  shipped: readonly T[]
): T | null {
  return toShip.find((o) => o.status === 'completed') ?? toShip[0] ?? shipped[0] ?? null;
}
