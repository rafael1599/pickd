/**
 * Lo que hay que mirar de una orden antes de enviarla (Rafael, 6 oct 2026:
 * «busca más casos que puede que no se estén tomando en cuenta para detectar
 * irregularidades en una orden que se va a enviar»).
 *
 * Medido ese día sobre las 297 órdenes completadas en 30 días: 8 completadas
 * sin verificar todas sus líneas (#881543, 0 de 15), 16 enviadas sin foto, 4
 * con menos fotos que tarimas, 2 pares de órdenes idénticas del mismo cliente
 * enviadas las dos (#881536 / #881551), 5 con una línea sin catálogo, 10 con
 * una línea LOW STOCK, 12 reabiertas, y dos S/D (#76, #78) con el mismo SKU que
 * bicis nuevas en otra fila.
 *
 * Sólo avisa, nunca bloquea: rojo lo que casi seguro está mal, ámbar lo que
 * hay que mirar. Puro: los datos llegan ya leídos (`useShipCheckData`).
 */

import { sdCode } from '../../../../utils/sdCode';

export interface ShipCheckItem {
  level: 'red' | 'amber';
  text: string;
}

export interface ShipCheckLine {
  sku: string;
  location?: string | null;
  pickingQty?: number | null;
  sku_not_found?: boolean | null;
  insufficient_stock?: boolean | null;
}

export interface ShipCheckInput {
  lines: readonly ShipCheckLine[];
  /** Las marcas de verificación de todas las órdenes del envío. */
  verifiedKeys: readonly string[];
  /** Ya redactadas: WRONG PICK?, TOO MANY, NOT IN ORDER (`photo_reads`). */
  photoAlerts: readonly string[];
  photos: number;
  pallets: number;
  isFedex: boolean;
  reopenCount: number;
  /** S/D cuyo SKU también tiene bicis nuevas en otra fila. */
  sdShared: readonly { sku: string; sdNumber: number | null; location: string }[];
  /** Órdenes del mismo cliente con las mismas líneas, cerca en el tiempo. */
  duplicates: readonly string[];
  /** El SKU tiene ficha en el catálogo (una línea UNREG que ya se registró no cuenta). */
  registered: (sku: string) => boolean;
}

const list = (skus: readonly string[], max = 3) =>
  skus.length > max ? `${skus.slice(0, max).join(', ')} +${skus.length - max}` : skus.join(', ');

/** Una línea está verificada si alguna marca termina en `-SKU-ubicación` (la marca lleva la tarima delante). */
const isVerified = (line: ShipCheckLine, keys: readonly string[]) =>
  keys.some(
    (k) =>
      k.endsWith(`-${line.sku}-${line.location ?? 'null'}`) ||
      (line.location == null && k.endsWith(`-${line.sku}-`))
  );

export function shipCheck(input: ShipCheckInput): ShipCheckItem[] {
  const red: ShipCheckItem[] = [];
  const amber: ShipCheckItem[] = [];
  const lines = input.lines.filter((l) => (Number(l.pickingQty) || 0) > 0);

  for (const a of input.photoAlerts) red.push({ level: 'red', text: a });

  const unverified = lines.filter((l) => !isVerified(l, input.verifiedKeys));
  if (lines.length > 0 && unverified.length > 0) {
    red.push({
      level: 'red',
      text: `NOT VERIFIED ${unverified.length} of ${lines.length} lines · ${list(unverified.map((l) => l.sku))}`,
    });
  }

  const unreg = [
    ...new Set(lines.filter((l) => l.sku_not_found && !input.registered(l.sku)).map((l) => l.sku)),
  ];
  if (unreg.length) red.push({ level: 'red', text: `NOT IN CATALOG ${list(unreg)}` });

  for (const sd of input.sdShared) {
    if (!lines.some((l) => l.sku === sd.sku)) continue;
    red.push({
      level: 'red',
      text: `${sd.sku} HAS AN S/D${sd.sdNumber != null ? ` #${sdCode(sd.sdNumber)}` : ''} IN ${sd.location} · ship a new one`,
    });
  }

  if (!input.isFedex && input.photos === 0) {
    amber.push({ level: 'amber', text: 'NO PHOTO of the pallets' });
  } else if (input.photos > 0 && input.photos < input.pallets) {
    amber.push({
      level: 'amber',
      text: `${input.pallets} PALLETS, ${input.photos} PHOTO${input.photos === 1 ? '' : 'S'}`,
    });
  }

  for (const n of input.duplicates) {
    amber.push({ level: 'amber', text: `POSSIBLE DUPLICATE of #${n} · same customer, same lines` });
  }

  const low = [...new Set(lines.filter((l) => l.insufficient_stock).map((l) => l.sku))];
  if (low.length) amber.push({ level: 'amber', text: `LOW STOCK ${list(low)}` });

  if (input.reopenCount > 0) {
    amber.push({
      level: 'amber',
      text: `REOPENED${input.reopenCount > 1 ? ` ×${input.reopenCount}` : ''} · photos may be from before the change`,
    });
  }

  return [...red, ...amber];
}

/**
 * Cuándo se miran los avisos (Rafael, 7 oct 2026: «advertencias que no deberían
 * estar en la vista Ship si no se cumple con que la orden ya haya sido enviada a
 * double check, o tomado una foto, o completada»). Una orden `active` (o idle)
 * todavía se está pickeando: NOT VERIFIED o LOW STOCK ahí son el trabajo en curso,
 * no una irregularidad del envío. Aplica si se cumple AL MENOS una:
 *   1. pasó a double check (`ready_to_double_check`, `double_checking`, `needs_correction`);
 *   2. está `completed`, o `reopened` (que fue completada);
 *   3. hay al menos una foto de tarima.
 *
 * Combinada: basta con que **una** orden del envío cumpla. El envío es lo que sale
 * junto (`shipments`, 26 sep 2026): las fotos ya llegan juntas
 * (`combinedPalletPhotos`) y los avisos se calculan sobre las líneas y marcas de
 * todas; si una hermana ya está en double check, la otra a medio pickear es
 * justo lo que hay que ver antes de cargar. Mirar sólo el estado del ancla
 * (`...anchor`, la más vieja) dependería de cuál es más vieja, no del envío.
 *
 * `cancelled` no aplica aunque tenga fotos: no se envía. En una combinada las
 * canceladas no cuentan; si todas lo están, no hay avisos.
 */
const SHIP_CHECK_STATUSES: ReadonlySet<string> = new Set([
  'ready_to_double_check',
  'double_checking',
  'needs_correction',
  'completed',
  'reopened',
]);

export function shipCheckApplies(input: {
  /** El estado de cada orden del envío (una sola si no es combinada). */
  statuses: readonly (string | null | undefined)[];
  /** Fotos de tarima del envío. */
  photos: number;
}): boolean {
  const live = input.statuses.filter((s) => s !== 'cancelled');
  if (live.length === 0) return false;
  if (input.photos > 0) return true;
  return live.some((s) => s != null && SHIP_CHECK_STATUSES.has(s));
}

/** Las líneas de una orden como conjunto comparable: `SKU:cantidad`, ordenado. */
export function lineSignature(lines: readonly ShipCheckLine[]): string {
  return lines
    .filter((l) => (Number(l.pickingQty) || 0) > 0)
    .map((l) => `${l.sku}:${Number(l.pickingQty) || 0}`)
    .sort()
    .join('|');
}
