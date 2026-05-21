/**
 * Ship-out SMS helpers — pure functions, no React or Supabase deps.
 *
 * The flow:
 *  1. After an order is marked completed via the DoubleCheckView slider,
 *     we have the picking_list + customer + sku_metadata in memory.
 *  2. `computeShipOutMetrics` derives pallets / parts / weight using the
 *     same rules the OrdersScreen uses, so the SMS shows numbers consistent
 *     with the printed shipping label.
 *  3. `buildShipOutSmsBody` formats the human-readable message.
 *  4. `buildShipOutSmsUrl` returns a platform-aware `sms:` URL that the
 *     UI opens via `window.location.href`. Android Chrome and iOS Safari
 *     accept slightly different query syntaxes — we sniff `userAgent` to
 *     pick the right one so the recipient list lands in the existing
 *     group thread (Google Messages / Apple Messages match the recipient
 *     set to find an existing conversation).
 */

export interface ShipOutSmsItem {
  sku: string;
  pickingQty: number;
}

export interface ShipOutSmsSkuMeta {
  is_bike: boolean | null;
  weight_lbs: number | null;
}

export interface ShipOutSmsCustomer {
  name: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
}

export interface ShipOutSmsOrder {
  order_number: string | null;
  pallets_qty: number | null;
  total_weight_lbs?: number | null;
  shipping_type?: string | null;
  items: ShipOutSmsItem[];
}

export interface ShipOutMetrics {
  pallets: number;
  bikes: number;
  parts: number;
  weightLbs: number;
}

const PALLET_WEIGHT_LBS = 40;

/**
 * Mirror of OrdersScreen's auto-bike/parts/weight calculation so the SMS
 * uses the same numbers the operator sees on the shipping label. If the
 * `picking_list.total_weight_lbs` was already persisted (admin entered a
 * manual override), it takes precedence.
 *
 * Pallet weight is added unless the shipping_type is `fedex`.
 */
export function computeShipOutMetrics(
  order: ShipOutSmsOrder,
  skuMeta: Record<string, ShipOutSmsSkuMeta>
): ShipOutMetrics {
  const pallets = order.pallets_qty ?? 1;
  const isFedex = (order.shipping_type ?? '').toLowerCase() === 'fedex';

  let bikes = 0;
  let parts = 0;
  let itemWeight = 0;
  for (const item of order.items ?? []) {
    const qty = item.pickingQty || 0;
    const meta = skuMeta[item.sku];
    if (meta?.is_bike) bikes += qty;
    else parts += qty;
    itemWeight += qty * (meta?.weight_lbs ?? 0);
  }

  const palletWeight = isFedex ? 0 : pallets * PALLET_WEIGHT_LBS;
  const computedWeight = itemWeight + palletWeight;
  // Prefer the persisted weight if the operator typed a manual override
  // on OrdersScreen. Falls back to computed value.
  const weightLbs =
    typeof order.total_weight_lbs === 'number' && order.total_weight_lbs > 0
      ? order.total_weight_lbs
      : computedWeight;

  return {
    pallets,
    bikes,
    parts,
    weightLbs: Math.round(weightLbs),
  };
}

/**
 * Formats the SMS body exactly like the example Rafael uses today:
 *
 *   READY TO SHIP:
 *
 *   {customer name}
 *   {street}
 *   {city}, {state} {zip}
 *
 *   ORDER #: {order_number}
 *   PALLETS: {pallets}
 *   PARTS: {parts}
 *   WEIGHT: {weight} LBS
 */
export function buildShipOutSmsBody(
  customer: ShipOutSmsCustomer,
  order: ShipOutSmsOrder,
  metrics: ShipOutMetrics
): string {
  const lines: string[] = ['READY TO SHIP:', ''];

  if (customer.name?.trim()) lines.push(customer.name.trim().toUpperCase());
  if (customer.street?.trim()) lines.push(customer.street.trim().toUpperCase());

  const cityLine = [customer.city, customer.state].filter(Boolean).join(', ').trim();
  const zip = customer.zip_code?.trim() ?? '';
  const cityStateZip = [cityLine, zip].filter(Boolean).join(' ').trim();
  if (cityStateZip) lines.push(cityStateZip.toUpperCase());

  lines.push('');
  if (order.order_number) lines.push(`ORDER #: ${order.order_number}`);
  lines.push(`PALLETS: ${metrics.pallets}`);
  lines.push(`PARTS: ${metrics.parts}`);
  lines.push(`WEIGHT: ${metrics.weightLbs} LBS`);

  return lines.join('\n');
}

/**
 * Normalize a list of typed phone numbers into E.164-ish strings the
 * `sms:` URL accepts. Strips spaces / dashes / parens; preserves the
 * leading `+`. Drops empty or obviously-bad entries.
 */
export function normalizeRecipients(input: string[] | string | null | undefined): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,]/) : [];
  return raw
    .map((s) => (s ?? '').replace(/[\s()\-.]/g, '').trim())
    .filter((s) => /^\+?\d{7,15}$/.test(s));
}

export type SmsPlatform = 'ios' | 'android' | 'other';

export function detectSmsPlatform(userAgent: string): SmsPlatform {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'other';
}

/**
 * Build the `sms:` URL for the detected platform.
 *
 * - Android (Google Messages and most third-party SMS apps): the
 *   recipient list goes comma-separated in the URL path, body in `?body=`.
 *   Multiple recipients prompt Messages to open the matching group MMS
 *   thread when one already exists.
 *
 * - iOS (Messages.app): Apple's documented form is
 *   `sms:/open?addresses=A,B&body=...`. Same group-thread matching rule.
 *
 * - Other: fall back to the Android form (works on desktop Chrome too,
 *   which just opens the system handler).
 */
export function buildShipOutSmsUrl(
  recipients: string[],
  body: string,
  platform: SmsPlatform
): string {
  const cleanRecipients = normalizeRecipients(recipients);
  const encodedBody = encodeURIComponent(body);
  const numbers = cleanRecipients.join(',');

  if (platform === 'ios') {
    // iOS accepts both `sms:N1,N2&body=...` and `sms:/open?addresses=...`.
    // The `/open?addresses=` form is more reliable for group-thread
    // matching on recent iOS versions.
    return `sms:/open?addresses=${numbers}&body=${encodedBody}`;
  }

  // Android / other: numbers go in the path, body as ?body=.
  return `sms:${numbers}?body=${encodedBody}`;
}
