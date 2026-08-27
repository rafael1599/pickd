/**
 * Which carriers the Ship picker shows before "…" (idea-162, refined
 * 2026-08-27 by Rafael): the screen should hold only what this order can use.
 *
 *   FedEx order   → FedEx alone; every other carrier waits under "…".
 *   Regular order → the LTL carriers used most (R+L 128 orders, RIST 27 in the
 *                   90 days to 2026-08-27); FedEx waits under "…" — a regular
 *                   order does not go FedEx by accident.
 *
 * The selected carrier is always shown, whichever it is, so a choice made
 * under "…" never disappears from the row.
 */
const REGULAR_PRIMARY: readonly string[] = ['R+L', 'RIST'];
const FEDEX_PRIMARY: readonly string[] = ['FEDEX'];

export function primaryCarriersFor(isFedexOrder: boolean): ReadonlySet<string> {
  return new Set(isFedexOrder ? FEDEX_PRIMARY : REGULAR_PRIMARY);
}

export function isCarrierVisible(
  company: string,
  opts: { isFedexOrder: boolean; selected: string | null | undefined; showAll: boolean }
): boolean {
  if (opts.showAll) return true;
  if (opts.selected === company) return true;
  return primaryCarriersFor(opts.isFedexOrder).has(company);
}
