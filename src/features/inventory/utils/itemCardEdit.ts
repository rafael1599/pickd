/**
 * An existing item, edited where it is shown (docs/prds/item-detail-register.md, F2).
 *
 * No Edit / View switch: every value on the card is tappable, each change is
 * pending until SAVE, and the bar says how many there are. This file is the
 * pure half: what the card starts from, what changed, and what a save writes.
 *
 * The writes keep the old sheet's contract (`ItemDetailView.executeSave`, mode
 * edit): the inventory row goes through `updateItem`, which already decides
 * move / consolidate / rename, and the catalogue through one upsert. What is
 * different is that the upsert carries only what changed — the old one rewrote
 * the whole row, dimensions included, on every save.
 */
import type {
  DistributionItem,
  InventoryItemInput,
  InventoryItemWithMetadata,
} from '../../../schemas/inventory.schema';
import type { SKUMetadataInput } from '../../../schemas/skuMetadata.schema';
import { normalizeSkuModel, normalizeSkuOnRegister } from '../../../utils/skuNormalize';
import { nameAfterSave } from './itemName';
import { fieldsFromName } from './newSkuPrefill';
import { isRowLocation, REGISTER_FIELDS, type RegisterField } from './registerItem';

export interface SdDetailsState {
  category: string;
  condition: string;
  conditionDescription: string;
  msrp: number | null;
  standardPrice: number | null;
  pdfLink: string;
}

export interface ItemCardState {
  fields: Record<RegisterField, string>;
  isBike: boolean;
  isScratchDent: boolean;
  location: string;
  squares: string[];
  quantity: number;
  note: string;
  sd: SdDetailsState;
}

/** The catalogue columns the card reads, fetched fresh on open. */
export interface ItemCardMeta {
  is_bike?: boolean | null;
  is_scratch_dent?: boolean | null;
  model?: string | null;
  size?: string | null;
  color?: string | null;
  serial_number?: string | null;
  upc?: string | null;
  category?: string | null;
  condition?: string | null;
  condition_description?: string | null;
  msrp?: number | null;
  standard_price?: number | null;
  pdf_link?: string | null;
  length_in?: number | null;
  width_in?: number | null;
  height_in?: number | null;
  weight_lbs?: number | null;
  dimensions_verified?: boolean | null;
  weight_verified?: boolean | null;
}

const s = (v: string | null | undefined) => (v ?? '').trim();

/**
 * What the card shows when it opens. A row with a name and no model takes its
 * model, size and colour from the name — into the baseline too, so saving an
 * unrelated change does not rebuild the name and drop the AS400 year (bug-044).
 */
export function itemCardBaseline(
  item: InventoryItemWithMetadata,
  meta: ItemCardMeta | null
): ItemCardState {
  const m = meta ?? (item.sku_metadata as ItemCardMeta | null) ?? {};
  const isBike = m.is_bike === true;
  let model = s(m.model);
  let size = s(m.size);
  let color = s(m.color);
  if (!model && item.item_name) {
    const f = fieldsFromName(item.item_name, isBike);
    model = s(f.model);
    size = size || s(f.size);
    color = color || s(f.color);
  }
  return {
    fields: {
      sku: s(item.sku),
      model,
      size,
      color,
      serial: s(m.serial_number),
      upc: s(m.upc),
    },
    isBike,
    isScratchDent: m.is_scratch_dent === true,
    location: s(item.location),
    squares: Array.isArray(item.sublocation) ? [...item.sublocation] : [],
    quantity: Number(item.quantity ?? 0),
    note: s(item.internal_note),
    sd: {
      category: s(m.category),
      condition: s(m.condition),
      conditionDescription: s(m.condition_description),
      msrp: m.msrp ?? null,
      standardPrice: m.standard_price ?? null,
      pdfLink: s(m.pdf_link),
    },
  };
}

export type ItemCardChange = RegisterField | 'type' | 'sd' | 'where' | 'qty' | 'note' | 'sdDetails';

const sameSquares = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Every value that differs from what the card opened with, in card order. */
export function itemCardChanges(base: ItemCardState, cur: ItemCardState): ItemCardChange[] {
  const out: ItemCardChange[] = [];
  for (const k of REGISTER_FIELDS) if (s(base.fields[k]) !== s(cur.fields[k])) out.push(k);
  if (base.isBike !== cur.isBike) out.push('type');
  if (base.isScratchDent !== cur.isScratchDent) out.push('sd');
  if (
    s(base.location).toUpperCase() !== s(cur.location).toUpperCase() ||
    !sameSquares(base.squares, cur.squares)
  ) {
    out.push('where');
  }
  if (base.quantity !== cur.quantity) out.push('qty');
  if (s(base.note) !== s(cur.note)) out.push('note');
  if (JSON.stringify(base.sd) !== JSON.stringify(cur.sd)) out.push('sdDetails');
  return out;
}

export interface ItemCardWriteInput {
  original: InventoryItemWithMetadata;
  meta: ItemCardMeta | null;
  base: ItemCardState;
  cur: ItemCardState;
  distribution: DistributionItem[];
}

export interface ItemCardWrite {
  item: InventoryItemInput;
  /** `null` when nothing in the catalogue changed. */
  metadata: SKUMetadataInput | null;
  renamed: boolean;
}

const text = (v: string) => v.trim() || null;

function sdColumns(sd: SdDetailsState) {
  return {
    category: text(sd.category),
    condition: text(sd.condition),
    condition_description: text(sd.conditionDescription),
    msrp: sd.msrp,
    standard_price: sd.standardPrice,
    pdf_link: text(sd.pdfLink),
  };
}

/**
 * The save. A rename writes the whole known catalogue row under the new name
 * (the upsert creates it there), but only the measurements somebody took: an
 * unmeasured default sent on insert would be stamped as measured.
 */
export function buildItemCardWrite({
  original,
  meta,
  base,
  cur,
  distribution,
}: ItemCardWriteInput): ItemCardWrite {
  const changes = itemCardChanges(base, cur);
  const sku = normalizeSkuOnRegister(cur.fields.sku);
  const renamed = sku !== original.sku;
  const model = cur.fields.model ? normalizeSkuModel(cur.fields.model) : '';
  const location = s(cur.location);

  const item = {
    sku,
    location,
    quantity: cur.quantity,
    item_name: nameAfterSave({
      mode: 'edit',
      isBike: cur.isBike,
      model,
      size: cur.fields.size,
      color: cur.fields.color,
      baseline: { model: base.fields.model, size: base.fields.size, color: base.fields.color },
      itemName: original.item_name,
    }),
    warehouse: original.warehouse,
    internal_note: text(cur.note),
    sublocation: isRowLocation(location) && cur.squares.length ? cur.squares : null,
    distribution: distribution.filter((d) => d.count > 0 && d.units_each > 0),
  } as InventoryItemInput;

  let metadata: SKUMetadataInput | null = null;
  if (renamed) {
    metadata = {
      sku,
      is_bike: cur.isBike,
      is_scratch_dent: cur.isScratchDent,
      model: model || null,
      size: text(cur.fields.size),
      color: text(cur.fields.color),
      serial_number: text(cur.fields.serial),
      upc: text(cur.fields.upc),
      ...Object.fromEntries(Object.entries(sdColumns(cur.sd)).filter(([, v]) => v !== null)),
      ...(meta?.dimensions_verified
        ? { length_in: meta.length_in, width_in: meta.width_in, height_in: meta.height_in }
        : {}),
      ...(meta?.weight_verified ? { weight_lbs: meta.weight_lbs } : {}),
    };
  } else {
    const m: SKUMetadataInput = { sku };
    if (changes.includes('type')) m.is_bike = cur.isBike;
    if (changes.includes('sd')) m.is_scratch_dent = cur.isScratchDent;
    // The three name the row together (the name is rebuilt from them), so a
    // change to one writes all three — a model the card took from the name
    // reaches the catalogue with it.
    if (changes.some((c) => c === 'model' || c === 'size' || c === 'color')) {
      m.model = model || null;
      m.size = text(cur.fields.size);
      m.color = text(cur.fields.color);
    }
    if (changes.includes('serial')) m.serial_number = text(cur.fields.serial);
    if (changes.includes('upc')) m.upc = text(cur.fields.upc);
    if (changes.includes('sdDetails')) Object.assign(m, sdColumns(cur.sd));
    metadata = Object.keys(m).length > 1 ? m : null;
  }

  return { item, metadata, renamed };
}
