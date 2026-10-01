/**
 * Registering a box, as three questions: what is it, where is it, how many.
 *
 * The pure half of `RegisterItemView` (docs/prds/item-detail-register.md). The
 * screen is the carton's label; this file decides what each field on it says,
 * when the three answers are complete, and what a registration writes. The
 * write keeps the contract the old add form had (`ItemDetailView.executeSave`):
 * inventory first, metadata second, and nothing filed as measured that nobody
 * measured.
 */
import type { InventoryItemInput } from '../../../schemas/inventory.schema';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import type { SKUMetadataInput } from '../../../schemas/skuMetadata.schema';
import type { SkuLabelDraft, DraftField } from './labelToSkuDraft';
import { skuDefaultsFor } from '../../../utils/skuDefaults';
import { normalizeSkuOnRegister, normalizeSkuModel } from '../../../utils/skuNormalize';
import { calculateBikeDistribution } from '../../../utils/distributionCalculator';
import { nameAfterSave } from './itemName';
import { serialLooksReal } from './serialIdentity';

export const REGISTER_FIELDS = ['sku', 'model', 'size', 'color', 'serial', 'upc'] as const;
export type RegisterField = (typeof REGISTER_FIELDS)[number];

/**
 * - `read`: the label said it (green).
 * - `choose`: the label offered two readings (amber, the options are buttons).
 * - `missing`: nobody has said it yet (red).
 * - `given`: the caller already knew it (a prefill) — no dot, nothing to check.
 * - `typed`: the operator typed or picked it.
 */
export type RegisterStatus = 'read' | 'choose' | 'missing' | 'given' | 'typed';

export interface RegisterValue {
  value: string;
  status: RegisterStatus;
  options?: string[];
}

export type RegisterFields = Record<RegisterField, RegisterValue>;

export interface RegisterIdentity {
  fields: RegisterFields;
  /** `null` = nobody chose; the screen asks and Register waits (no default type). */
  isBike: boolean | null;
  /** A weight printed on the carton (G.W.), the only real one at registration. */
  labelWeightLbs: number | null;
  isScratchDent: boolean;
}

const missing = (): RegisterValue => ({ value: '', status: 'missing' });

export function emptyIdentity(): RegisterIdentity {
  return {
    fields: {
      sku: missing(),
      model: missing(),
      size: missing(),
      color: missing(),
      serial: missing(),
      upc: missing(),
    },
    isBike: null,
    labelWeightLbs: null,
    isScratchDent: false,
  };
}

const given = (v: string | null | undefined): RegisterValue =>
  v && v.trim() ? { value: v.trim(), status: 'given' } : missing();

/**
 * What a caller handed over (Double Check's register, a known SKU). The type is
 * only known when the catalogue row came with it — a brand-new SKU asks.
 */
export function identityFromPrefill(
  item: InventoryItemWithMetadata | null | undefined
): RegisterIdentity {
  if (!item) return emptyIdentity();
  const meta = item.sku_metadata ?? null;
  return {
    fields: {
      sku: given(item.sku),
      model: given(meta?.model),
      size: given(meta?.size),
      color: given(meta?.color),
      serial: given(meta?.serial_number),
      upc: given(meta?.upc),
    },
    isBike: typeof meta?.is_bike === 'boolean' ? meta.is_bike : null,
    labelWeightLbs: null,
    isScratchDent: meta?.is_scratch_dent === true,
  };
}

/** The reader's own "CONFLICTO: a ≠ b" is a note about two readings, never a value. */
const isConflictNote = (v: string) => /^CONFLICTO\b/i.test(v.trim()) || v.includes('≠');

function fromDraft(field: DraftField<string>): RegisterValue {
  if (field.status === 'uncertain' && field.options) {
    const options = [...new Set(field.options.map((o) => String(o).trim()))].filter(
      (o) => o && !isConflictNote(o)
    );
    if (options.length > 1) return { value: '', status: 'choose', options };
    if (options.length === 1) return { value: '', status: 'choose', options };
  }
  if (field.value && isConflictNote(String(field.value))) return missing();
  if (field.value && String(field.value).trim()) {
    return { value: String(field.value).trim(), status: 'read' };
  }
  return missing();
}

/**
 * The label's reading, painted on the label. What the caller already knew stays
 * (a prefilled SKU is not replaced by an OCR guess); everything else takes what
 * the carton said. The type is taken only when the label was sure of it.
 */
export function identityFromDraft(draft: SkuLabelDraft, base?: RegisterIdentity): RegisterIdentity {
  const start = base ?? emptyIdentity();
  const read: RegisterFields = {
    sku: fromDraft(draft.sku),
    model: fromDraft(draft.model),
    size: fromDraft(draft.size),
    color: fromDraft(draft.color),
    // A caption read as a value (`SERIALLOE`, `BICYCLING`) is not a serial.
    serial: serialLooksReal(draft.serial.value) ? fromDraft(draft.serial) : missing(),
    upc: fromDraft(draft.upc),
  };
  const fields = { ...read };
  for (const k of REGISTER_FIELDS) {
    if (start.fields[k].status === 'given' || start.fields[k].status === 'typed') {
      fields[k] = start.fields[k];
    }
  }
  return {
    fields,
    isBike:
      start.isBike ??
      (draft.isBike.status === 'found' && typeof draft.isBike.value === 'boolean'
        ? draft.isBike.value
        : null),
    labelWeightLbs:
      draft.weightLbs.status === 'found' && typeof draft.weightLbs.value === 'number'
        ? draft.weightLbs.value
        : null,
    isScratchDent: start.isScratchDent,
  };
}

/** The operator settled a field: typed it, or picked one of the label's readings. */
export function settle(
  identity: RegisterIdentity,
  key: RegisterField,
  value: string
): RegisterIdentity {
  const v = value.trim();
  return {
    ...identity,
    fields: { ...identity.fields, [key]: v ? { value: v, status: 'typed' } : missing() },
  };
}

/**
 * A typed SKU the catalogue already knows: what it knows is not asked again.
 * Only empty fields are filled, and the type only if nobody chose one.
 */
export function fillFromCatalogue(
  identity: RegisterIdentity,
  meta: {
    is_bike?: boolean | null;
    model?: string | null;
    size?: string | null;
    color?: string | null;
    upc?: string | null;
  } | null
): RegisterIdentity {
  if (!meta) return identity;
  const fields = { ...identity.fields };
  const known: [RegisterField, string | null | undefined][] = [
    ['model', meta.model],
    ['size', meta.size],
    ['color', meta.color],
    ['upc', meta.upc],
  ];
  for (const [k, v] of known) {
    if (fields[k].status === 'missing' && v && v.trim()) fields[k] = given(v);
  }
  return {
    ...identity,
    fields,
    isBike: identity.isBike ?? (typeof meta.is_bike === 'boolean' ? meta.is_bike : null),
  };
}

export const isRowLocation = (location: string | null | undefined) =>
  /^ROW\b/i.test((location ?? '').trim());

export interface RegisterAnswers {
  identity: RegisterIdentity;
  location: string | null;
  quantity: number | null;
}

export interface Readiness {
  what: boolean;
  where: boolean;
  howMany: boolean;
  /** The first thing still missing, in the words the bottom bar shows. */
  blocker: string | null;
}

/**
 * When Register is allowed. Kept to the old form's contract — SKU, type,
 * location, a quantity, the serial of an S/D — plus one rule the label adds: an
 * amber field is a question, and a question blocks until it is answered.
 */
export function readiness({ identity, location, quantity }: RegisterAnswers): Readiness {
  const f = identity.fields;
  const choose = REGISTER_FIELDS.find((k) => f[k].status === 'choose');
  let whatBlocker: string | null = null;
  if (!f.sku.value) whatBlocker = 'SKU';
  else if (identity.isBike === null) whatBlocker = 'Bike or part';
  else if (choose)
    whatBlocker = choose === 'sku' ? 'SKU' : choose[0].toUpperCase() + choose.slice(1);
  else if (identity.isScratchDent && !f.serial.value) whatBlocker = 'Serial (S/D)';
  const what = whatBlocker === null;
  const where = !!location && !!location.trim();
  const howMany = quantity !== null && Number.isInteger(quantity) && quantity >= 0;
  return {
    what,
    where,
    howMany,
    blocker: whatBlocker ?? (!where ? 'Where' : !howMany ? 'How many' : null),
  };
}

/**
 * Units in each square of one row. A line listing several letters is spread
 * over them, so the row's total is never counted twice.
 */
export function unitsBySquare(
  lines: { sublocation: string[] | null | undefined; quantity: number | null | undefined }[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const qty = Number(line.quantity ?? 0);
    const letters = (line.sublocation ?? []).filter((l) => /^[A-Z]$/.test(l));
    if (qty <= 0 || letters.length === 0) continue;
    const share = qty / letters.length;
    for (const l of letters) out.set(l, (out.get(l) ?? 0) + share);
  }
  for (const [l, n] of out) out.set(l, Math.round(n));
  return out;
}

const BASE_SQUARES = 'ABCDEFGHIJK'.split('');

/** A–K, plus any letter the row already uses (an L in Bay 2). Never fewer. */
export function squaresForRow(used: Iterable<string>): string[] {
  const all = new Set(BASE_SQUARES);
  for (const l of used) if (/^[A-Z]$/.test(l)) all.add(l);
  return [...all].sort();
}

export interface RegisterWrite {
  /** What `onSave` (→ addItem) gets: the inventory row. */
  item: InventoryItemInput;
  /** What `updateSKUMetadata` upserts afterwards. Absent keys are left alone. */
  metadata: SKUMetadataInput;
  /** A serial to file in `sku_serials` (one carton), when it is not the S/D's own. */
  cartonSerial: string | null;
}

export interface BuildRegisterInput extends RegisterAnswers {
  square: string | null;
  warehouse: string;
  /** The name the caller came with (an AS400 description), kept when there is no model. */
  itemName: string | null | undefined;
  /** S/D card values, only what was typed. */
  sdFields?: Partial<SKUMetadataInput>;
}

const isDefaultWeight = (w: number) =>
  w === skuDefaultsFor(true).weight_lbs || w === skuDefaultsFor(false).weight_lbs;

/**
 * The registration's two writes. Only what somebody said goes into the
 * catalogue: an empty field is left out (a known SKU registered at a second
 * location keeps its model), the box's dimensions are never sent (the trigger
 * fills the type's default and `dimensions_verified` stays false), and a
 * weight goes in only when the carton printed one that is not a default.
 */
export function buildRegisterWrite(input: BuildRegisterInput): RegisterWrite {
  const { identity, location, quantity, square, warehouse, itemName, sdFields } = input;
  const f = identity.fields;
  const isBike = identity.isBike === true;
  const sku = normalizeSkuOnRegister(f.sku.value);
  const model = f.model.value ? normalizeSkuModel(f.model.value) : '';
  const qty = quantity ?? 0;
  const loc = (location ?? '').trim();

  const item = {
    sku,
    location: loc,
    quantity: qty,
    item_name: nameAfterSave({
      mode: 'add',
      isBike,
      model,
      size: f.size.value,
      color: f.color.value,
      baseline: { model: '', size: '', color: '' },
      itemName,
    }),
    warehouse,
    internal_note: null,
    sublocation: isRowLocation(loc) && square ? [square] : null,
    distribution: isBike && qty > 0 ? calculateBikeDistribution(qty) : [],
    is_bike: isBike,
  } as InventoryItemInput;

  const metadata: SKUMetadataInput = {
    sku,
    is_bike: isBike,
    is_scratch_dent: identity.isScratchDent,
    ...(model ? { model } : {}),
    ...(f.size.value ? { size: f.size.value } : {}),
    ...(f.color.value ? { color: f.color.value } : {}),
    ...(f.upc.value ? { upc: f.upc.value } : {}),
    // The catalogue keeps one serial per SKU: it is the S/D's, never a carton's.
    ...(identity.isScratchDent && f.serial.value ? { serial_number: f.serial.value } : {}),
    ...(identity.labelWeightLbs != null && !isDefaultWeight(identity.labelWeightLbs)
      ? { weight_lbs: identity.labelWeightLbs }
      : {}),
    ...(identity.isScratchDent ? (sdFields ?? {}) : {}),
  };

  return {
    item,
    metadata,
    cartonSerial: !identity.isScratchDent && f.serial.value ? f.serial.value : null,
  };
}
