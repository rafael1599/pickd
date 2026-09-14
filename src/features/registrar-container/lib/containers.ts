// A shipment file as containers: which ones it lists, which PickD already has,
// and which are registered by default. Pure -- the reads live in the api.

import type { ContainerInputItem, ContainerIntake, ParsedContainer, ParsedLine } from './types';

// Model / size / color travel beside the joined name: `register_new_sku` has a
// column for each, and the sheet already knows which is which. A bike that
// reaches sku_metadata without a model is held out of the FedEx carton file
// for good, however many times somebody measures the box.
export function toInputItems(container: ParsedContainer): ContainerInputItem[] {
  return container.items.map((i) => ({
    sku: i.sku,
    qty: i.qty,
    item_name: i.itemName,
    model: i.model,
    size: i.size,
    color: i.color,
  }));
}

/**
 * A load of this warehouse: four digits and N (Jamis North, the NJ warehouse
 * that PickD calls LUDLOW). The FL Breakdown ('6438F') goes to Miami and the
 * Direct Containers ('6433FL') to a customer; the file lists them too, so they
 * are shown, but only ticked by hand.
 *
 * Copied from resolve_location (20260910151722), which creates these names as
 * staging and not floor space; if the pattern changes there, change it here.
 */
const WAREHOUSE_CONTAINER_RE = /^\d{4}N$/;

export function isWarehouseContainer(po: string | null): boolean {
  return po != null && WAREHOUSE_CONTAINER_RE.test(po);
}

/**
 * One container per PO. The same PO can open two sections -- the Direct sheet
 * lists 6433FL twice, once per box -- and both land in one location, so they
 * are one container with two box numbers. Lines without a PO are never merged
 * with anything: each such block needs its own name. Empty sections go.
 */
export function groupContainers(sections: ParsedContainer[]): ParsedContainer[] {
  const out: ParsedContainer[] = [];
  const byPo = new Map<string, ParsedContainer>();

  for (const s of sections) {
    if (s.items.length === 0) continue;
    const seen = s.po == null ? undefined : byPo.get(s.po);
    if (!seen) {
      const copy: ParsedContainer = {
        ...s,
        containerIds: [...s.containerIds],
        items: [...s.items],
      };
      if (s.po != null) byPo.set(s.po, copy);
      out.push(copy);
      continue;
    }
    seen.items.push(...s.items);
    seen.total += s.total;
    seen.vessel ??= s.vessel;
    for (const id of s.containerIds) {
      if (!seen.containerIds.includes(id)) seen.containerIds.push(id);
    }
  }
  return out;
}

/**
 * Lo que la hoja trae para un contenedor ya registrado y la ubicación no tiene.
 *
 * El registrador era todo-o-nada: `intake` contestaba «¿entró este contenedor
 * alguna vez?» y nada contestaba «¿qué trae el fichero que no está dentro?», así
 * que una hoja que gana líneas después de registrarse las escondía. Rafael, 14
 * sep 2026: «cuando agrego cambios en el excel no los detecta el registrador» —
 * el `7005N` de esa hoja trae once líneas y PickD tenía nueve.
 *
 * **Sólo líneas nuevas, nunca diferencias de cantidad.** Un contenedor a medio
 * descargar tiene menos unidades de las que trajo, porque es exactamente lo que
 * se espera de él: comparar cantidades daría una lista de falsos positivos que
 * crece según se vacía. Una SKU que no tiene fila ahí, en cambio, no entró.
 */
export function pendingLines(
  container: ParsedContainer,
  intake: ContainerIntake | null
): ParsedLine[] {
  if (!intake) return [];
  const known = new Set(intake.skus.map((s) => s.trim().toUpperCase()));
  return container.items.filter((i) => !known.has(i.sku.trim().toUpperCase()));
}

/** The container a PDF worksheet is: one PO, no vessel or box number on it. */
export function worksheetContainer(
  sheet: string,
  items: ParsedLine[],
  total: number
): ParsedContainer {
  return {
    po: items.find((i) => i.po)?.po?.toUpperCase() ?? null,
    sheet,
    vessel: null,
    containerIds: [],
    items,
    total,
  };
}

export interface IntakeLog {
  to_location: string | null;
  action_type: string | null;
  quantity_change: number | null;
  performed_by: string | null;
  created_at: string | null;
  is_reversed: boolean | null;
}

export interface LocationStock {
  location: string | null;
  quantity: number | null;
  /** Presente desde que el intake recuerda sus SKUs; una fila en cero cuenta
   *  igual — el contenedor la recibió y alguien la movió. */
  sku?: string | null;
}

/**
 * Which of `locations` PickD already has.
 *
 * A container is in PickD once stock was ever added to its location (an ADD
 * that raised the quantity and was not undone), or while the location holds
 * stock. The second half is register_container's own guard; the first is the
 * one it lacks: once a load is moved to the rows its location reads 0 (7004N,
 * 10 Sep, registered that morning and empty by the afternoon), and a schedule
 * still listing it would load the same 235 bikes again. A file with every
 * container on the water makes that the normal case, not a slip.
 *
 * `units` counts what people put there; an ADD by 'system: unpick' or 'System
 * Auto-Cancel' is stock going back where it came from -- it proves the
 * container was registered, but it is not the intake.
 */
export function summarizeIntakes(
  locations: string[],
  logs: IntakeLog[],
  stock: LocationStock[]
): Map<string, ContainerIntake> {
  const out = new Map<string, ContainerIntake>();

  for (const location of locations) {
    const adds = logs.filter(
      (l) =>
        (l.to_location ?? '').trim().toUpperCase() === location &&
        l.action_type === 'ADD' &&
        (l.quantity_change ?? 0) > 0 &&
        !l.is_reversed
    );
    const now = stock
      .filter((s) => (s.location ?? '').trim().toUpperCase() === location)
      .reduce((sum, s) => sum + Math.max(s.quantity ?? 0, 0), 0);
    if (adds.length === 0 && now === 0) continue;

    const times = adds.map((l) => l.created_at).filter((t): t is string => !!t);
    const skus = [
      ...new Set(
        stock
          .filter((s) => (s.location ?? '').trim().toUpperCase() === location)
          .map((s) => (s.sku ?? '').trim().toUpperCase())
          .filter(Boolean)
      ),
    ];
    out.set(location, {
      location,
      firstAt: times.length > 0 ? times.reduce((a, b) => (a < b ? a : b)) : null,
      units: adds
        .filter((l) => !/^system/i.test(l.performed_by ?? ''))
        .reduce((sum, l) => sum + (l.quantity_change ?? 0), 0),
      stock: now,
      skus,
    });
  }
  return out;
}
