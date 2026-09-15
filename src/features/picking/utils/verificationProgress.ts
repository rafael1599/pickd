import { calculatePalletsWithBikeAwareness, type PickingItem } from '../../../utils/pickingLogic';
import { isBikeSku, isSmallBikeSku } from '../../../utils/bikeDetection';

/** What the reading needs from an order — loose, so every card's projection fits. */
export interface ProgressOrder {
  status: string;
  is_shipped?: boolean | null;
  items?: readonly unknown[] | null;
  verified_item_keys?: readonly string[] | null;
}

/**
 * How far Double Check has got, 0–100 — the one reading every progress bar
 * uses: the board's single, combined and FedEx group cards (`VerificationBar`)
 * and `OrderProgressBar` in Ship and Orders.
 *
 * Double Check writes one key per line it ticks, `pallet-sku-location`, into
 * `verified_item_keys` of every member of the group: the progress is the
 * group's, because the cart is. It does so whether the order was opened to
 * check (ready → double_checking) or to pick (active, needs_correction) — the
 * picker ticks lines the same way in both (Rafael, 11 Sep 2026, on a manual
 * order that sat at 3/7 on the phone and empty on the board).
 *
 * Two things can differ between the cart that wrote a key and the card that
 * reads it, and neither should hide a tick:
 *
 * - **The pallet number.** A card numbers its own pallets, so a key counts by
 *   its `-sku-location` tail, once: one key, one line (a line split over two
 *   pallets has two).
 * - **The address.** A line ticked before it had one (`…-12-2501-null`) keeps
 *   that key after Double Check writes the address it resolved (bug-026), so a
 *   `null` key still counts for a line of its SKU. #881529 read 62 % finished.
 *
 * A finished order is 100; one waiting in the queue to be checked is 0 — Ready
 * to DC empties its keys, so anything left there is not this check's. A check in
 * progress stops at 95 until every unit is ticked.
 */
export function verificationProgress(order: ProgressOrder, bikeSkuSet?: Set<string>): number {
  if (order.status === 'completed' || order.is_shipped) return 100;
  if (order.status === 'ready_to_double_check') return 0;
  if (!Array.isArray(order.items) || order.items.length === 0) return 0;

  const verifiedKeys = new Set(order.verified_item_keys ?? []);
  if (verifiedKeys.size === 0) return 0;

  const lines = order.items as ReadonlyArray<Record<string, unknown>>;
  const bikes = new Set<string>();
  // Las pequeñas se reconocen aquí y no se piden como parámetro: el sello de
  // `sku_metadata` dentro de cada línea sólo lleva `is_bike` y `weight_lbs`,
  // pero la línea misma trae la descripción del AS400 y el número de Jamis, que
  // es lo que decide. Tiene que salir el mismo reparto que en Double Check: una
  // línea de 24 juveniles es **un** apunte allí, y si aquí se paginara en dos,
  // la única marca escrita cubriría la mitad y la barra se quedaría al 50 %.
  const smallBikes = new Set<string>();
  for (const item of lines) {
    const sku = typeof item.sku === 'string' ? item.sku : '';
    const isBike =
      (bikeSkuSet && bikeSkuSet.has(sku)) ||
      isBikeSku(sku, item.sku_metadata as { is_bike?: boolean | null } | null);
    if (!isBike || !sku) continue;
    bikes.add(sku);
    const named = {
      model: typeof item.item_name === 'string' ? item.item_name : null,
      as400_description: typeof item.description === 'string' ? item.description : null,
    };
    if (isSmallBikeSku(sku, named)) smallBikes.add(sku);
  }
  const allItems = lines.map((i) => {
    const rawQty = (i.pickingQty ?? i.qty ?? i.quantity) as number | string | undefined;
    return {
      ...i,
      sku: typeof i.sku === 'string' ? i.sku : '',
      pickingQty: typeof rawQty === 'string' ? Number(rawQty) || 0 : rawQty || 0,
      location: (i.location as string | null | undefined) ?? null,
    };
  }) as unknown as PickingItem[];
  const pallets = calculatePalletsWithBikeAwareness(allItems, bikes, smallBikes);

  const byTail = new Map<string, number>();
  for (const key of verifiedKeys) {
    const dash = key.indexOf('-');
    if (dash !== -1) byTail.set(key.slice(dash), (byTail.get(key.slice(dash)) ?? 0) + 1);
  }
  const take = (tail: string) => {
    const n = byTail.get(tail) ?? 0;
    if (n === 0) return false;
    byTail.set(tail, n - 1);
    return true;
  };

  let totalUnits = 0;
  let verifiedUnits = 0;
  const unmatched: Array<{ sku: string; qty: number }> = [];
  for (const pallet of pallets) {
    for (const item of pallet.items) {
      const qty = item.pickingQty || 0;
      totalUnits += qty;
      if (take(`-${item.sku}-${item.location}`)) verifiedUnits += qty;
      else unmatched.push({ sku: item.sku, qty });
    }
  }
  // Ticked before the line had an address.
  for (const line of unmatched) {
    if (take(`-${line.sku}-null`)) verifiedUnits += line.qty;
  }

  if (totalUnits === 0) return 0;
  if (verifiedUnits >= totalUnits) return 100;
  return Math.min(95, Math.round((verifiedUnits / totalUnits) * 100));
}
