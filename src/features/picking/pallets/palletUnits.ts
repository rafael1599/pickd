/**
 * Editar qué bicis lleva una tarima, caja por caja (Rafael, 29 sep 2026: «una
 * lista simple de SKUs cuando da click en un botón de edit de una pallet, para
 * ver los que están seleccionados para esa pallet específica, pudiendo
 * deseleccionarlos y seleccionar otros de la misma orden para armar esa
 * pallet»).
 *
 * La lista son **las bicis de la orden, una fila por caja**, cada una con la
 * tarima donde está ahora. Lo que se guarda es una tarima armada a mano
 * (`pallet_dims[].items`), que el motor aparta primero y reparte el resto
 * alrededor. Traer una caja de **otra tarima armada a mano** se la quita a esa:
 * si no, las dos la reclamarían y una se quedaría corta. Lo que se desmarca
 * vuelve al reparto solo.
 *
 * Puro: lo usan Double Check y Ship con el mismo resultado.
 */
import type { PalletItemPick } from '../../../utils/palletDims';
import type { PlannedPallet } from './planPallets';

/** Una caja de la orden, en la tarima donde está ahora. */
export interface PalletUnit {
  sku: string;
  location: string | null;
  itemName: string | null;
  isKids: boolean;
  /** Ordinal de la tarima donde está ahora (`pallet.id`). */
  fromPallet: number;
  /** Esa tarima la armó alguien a mano. */
  fromManual: boolean;
  /** «#3»: la posición que enseña la pantalla. */
  fromLabel: string;
}

export function palletUnits(
  pallets: readonly PlannedPallet[],
  isBike: (sku: string) => boolean,
  isKids: (sku: string) => boolean,
  positionOf: (id: number) => number
): PalletUnit[] {
  const units: PalletUnit[] = [];
  for (const p of pallets) {
    if (p.isParts) continue;
    for (const item of p.items) {
      if (!isBike(item.sku)) continue;
      const n = Math.max(0, Math.floor(item.pickingQty || 0));
      for (let i = 0; i < n; i += 1) {
        units.push({
          sku: item.sku,
          location: item.location ?? null,
          itemName: (item.item_name as string | null | undefined) ?? null,
          isKids: isKids(item.sku),
          fromPallet: p.id,
          fromManual: p.manual === true,
          fromLabel: `#${positionOf(p.id)}`,
        });
      }
    }
  }
  return units;
}

const keyOf = (sku: string, location: string | null) => `${sku}|${location ?? ''}`;

function toPicks(units: readonly Pick<PalletUnit, 'sku' | 'location'>[]): PalletItemPick[] {
  const byKey = new Map<string, PalletItemPick>();
  for (const u of units) {
    const k = keyOf(u.sku, u.location);
    const pick = byKey.get(k) ?? { sku: u.sku, location: u.location, qty: 0 };
    pick.qty += 1;
    byKey.set(k, pick);
  }
  return [...byKey.values()];
}

/** Lo que hay que escribir en `pallet_dims`: una tarima, o `null` para devolverla al reparto. */
export interface PalletWrite {
  pallet: number;
  items: PalletItemPick[] | null;
}

/**
 * Lo elegido para la tarima `target`: ella queda armada a mano con esas cajas
 * (o vuelve al reparto si no lleva ninguna), y cada **otra** tarima armada a
 * mano de la que salió una caja pierde esa caja.
 */
export function applyPalletSelection(
  target: number,
  selected: readonly PalletUnit[],
  all: readonly PalletUnit[]
): PalletWrite[] {
  const writes: PalletWrite[] = [];
  const picks = toPicks(selected);
  writes.push({ pallet: target, items: picks.length > 0 ? picks : null });

  const taken = new Set(selected);
  const otherManual = new Set(
    all.filter((u) => u.fromManual && u.fromPallet !== target).map((u) => u.fromPallet)
  );
  for (const pallet of otherManual) {
    const own = all.filter((u) => u.fromPallet === pallet);
    const kept = own.filter((u) => !taken.has(u));
    if (kept.length === own.length) continue;
    const items = toPicks(kept);
    writes.push({ pallet, items: items.length > 0 ? items : null });
  }
  return writes;
}
