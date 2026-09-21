/**
 * Turns one recognised box label into a draft of the add-SKU form.
 *
 * Registering a box the catalogue has never seen means typing model, size,
 * colour, serial and the codes by hand off the carton. The label already
 * carries all of it, so the photo fills what it can prove and hands back the
 * rest — never a plausible guess.
 *
 * Every field comes back with a status the form can paint:
 *   found     — one value, and nothing else on the label contradicts it.
 *   uncertain — the label offered more than one reading. Both are handed over
 *               as options; the operator picks. This is the case that used to
 *               be resolved silently, and silence is what cost us the `14"`
 *               that belonged to the neighbouring box (R10 §4, A3k).
 *   missing   — the label does not say. The form paints it red and waits.
 *
 * Label layouts differ by type (A-F, PRODUCT ID, and the variants that keep
 * appearing): some print `MODEL:` anchors, some put the model in a black
 * banner with no anchor at all, some carry a serial barcode and some carry
 * none. Nothing here assumes a fixed position — it reads what the recogniser
 * arbitrated and reports honestly how sure it is.
 */
import type { ClientRecognitionResult } from '../../../lib/recognition/recognizeLabelClient';
import type { FieldCandidate, SkuCandidate } from '../../../lib/recognition/clientOcr';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import { skuDefaultsFor } from '../../../utils/skuDefaults';
import { normalizeSkuOnRegister, normalizeSkuModel } from '../../../utils/skuNormalize';

export type FieldStatus = 'found' | 'uncertain' | 'missing';

export interface DraftField<T> {
  value: T | null;
  status: FieldStatus;
  /** Which channel produced it — 'barcode', 'ocr', 'barcode+ocr'. */
  source: string | null;
  /** Only when `uncertain`: every reading the label supports, best first. */
  options?: T[];
}

export interface SkuLabelDraft {
  sku: DraftField<string>;
  isBike: DraftField<boolean>;
  model: DraftField<string>;
  size: DraftField<string>;
  color: DraftField<string>;
  serial: DraftField<string>;
  upc: DraftField<string>;
  gtin: DraftField<string>;
  weightLbs: DraftField<number>;
  /** Field keys the operator still has to fill — the ones painted red. */
  missingFields: (keyof SkuLabelDraft)[];
  /** Field keys offering a choice — the ones painted amber. */
  uncertainFields: (keyof SkuLabelDraft)[];
}

const KG_TO_LBS = 2.20462;

/** Distinct, non-empty, order preserved: the first reading stays the default. */
function distinct<T>(values: (T | null | undefined)[]): T[] {
  const out: T[] = [];
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    if (!out.some((existing) => existing === v)) out.push(v);
  }
  return out;
}

/**
 * One field, decided. A chosen value with rival candidates is NOT settled:
 * the rivals go to the operator rather than being dropped, because dropping
 * them is exactly how a wrong value reaches the catalogue looking confident.
 */
function decide<T>(value: T | null, candidates: T[], source: string | null): DraftField<T> {
  const options = distinct<T>([value, ...candidates]);

  if (options.length === 0) return { value: null, status: 'missing', source: null };
  if (options.length === 1) return { value: options[0], status: 'found', source };
  return { value: options[0], status: 'uncertain', source, options };
}

function candidateValues<T>(candidates: FieldCandidate<T>[] | undefined): T[] {
  return (candidates ?? []).map((c) => c.value);
}

function skuCandidateValues(candidates: SkuCandidate[] | undefined): string[] {
  return (candidates ?? []).map((c) => c.sku);
}

/**
 * Bike or part, inferred only from what the carton states outright.
 *
 * The strongest tell is the quantity line: a bike ships as `QTY: 1 SET`, a
 * box of spares as `Q'TY: 10 PCS` with an `ITEM:` line naming the part
 * (R10 §3, the chainstay carton). A serial number is a decent second signal —
 * parts are not serialised — but it is never enough on its own to overrule
 * an explicit PCS count.
 *
 * When the label says nothing either way, this stays `missing`: the type sets
 * the default box and weight for everything that follows, so guessing it wrong
 * is expensive and the operator answers in one tap anyway.
 */
export function inferIsBike(fullText: string, hasSerial: boolean): DraftField<boolean> {
  const text = fullText.toUpperCase();

  const pcsMatch = text.match(/Q\s*'?\s*TY[.:\s]*(\d+)\s*PCS/);
  const setMatch = /Q\s*'?\s*TY[.:\s]*\d+\s*SET/.test(text);
  const itemAnchor = /\bITEM\s*[:.]/.test(text);

  const partSignals = (pcsMatch && Number(pcsMatch[1]) > 1 ? 1 : 0) + (itemAnchor ? 1 : 0);
  const bikeSignals = (setMatch ? 1 : 0) + (hasSerial ? 1 : 0);

  if (partSignals > 0 && bikeSignals > 0) {
    // A carton that reads both ways is precisely the case not to settle alone.
    return { value: null, status: 'uncertain', source: 'ocr', options: [true, false] };
  }
  if (partSignals > 0) return { value: false, status: 'found', source: 'ocr' };
  if (bikeSignals > 0) return { value: true, status: 'found', source: 'ocr' };
  return { value: null, status: 'missing', source: null };
}

export function buildSkuLabelDraft(result: ClientRecognitionResult): SkuLabelDraft {
  const f = result.extractedFields;
  const extracted = result.ocr?.extracted;
  const sources = result.fieldSources ?? {};
  const fullText = result.ocr?.fullText ?? '';

  const sku = decide(
    f.sku,
    distinct([...skuCandidateValues(result.allSkuCandidates), ...skuCandidateValues(extracted?.skuCandidates)]),
    sources.sku ?? null
  );

  const model = decide(f.model, candidateValues(extracted?.modelCandidates), sources.model ?? null);
  const size = decide(f.size, candidateValues(extracted?.sizeCandidates), sources.size ?? null);
  const color = decide(f.color, candidateValues(extracted?.colorCandidates), sources.color ?? null);

  // The serial is read as printed or not at all — there is no second candidate
  // to weigh, and a serial guessed one glyph wrong is worse than none.
  const serial = decide(f.serial, [], sources.serial ?? null);

  // UPC and GTIN disagreeing is a real conflict, surfaced rather than resolved
  // by checksum: a one-digit check accepts a wrong code about a tenth of the
  // time, which is far too often for a code that then identifies the box.
  const upcConflict = extracted?.upcConflict ?? null;
  const upc = upcConflict
    ? {
        value: upcConflict.direct,
        status: 'uncertain' as const,
        source: sources.upc ?? 'barcode',
        options: distinct([upcConflict.direct, upcConflict.fromGtin]),
      }
    : decide(f.upc, [], sources.upc ?? null);

  const gtin = decide(f.gtin ?? null, [], sources.gtin ?? null);

  const gw = decide(f.gw_kg, candidateValues(extracted?.gwCandidates), sources.gw_kg ?? null);
  const weightLbs: DraftField<number> = {
    value: gw.value === null ? null : Math.round(gw.value * KG_TO_LBS * 10) / 10,
    status: gw.status,
    source: gw.source,
    options: gw.options?.map((kg) => Math.round(kg * KG_TO_LBS * 10) / 10),
  };

  const isBike = inferIsBike(fullText, serial.status === 'found');

  const draft = {
    sku,
    isBike,
    model,
    size,
    color,
    serial,
    upc,
    gtin,
    weightLbs,
  };

  const keys = Object.keys(draft) as (keyof SkuLabelDraft)[];
  return {
    ...draft,
    missingFields: keys.filter((k) => (draft as Record<string, DraftField<unknown>>)[k].status === 'missing'),
    uncertainFields: keys.filter(
      (k) => (draft as Record<string, DraftField<unknown>>)[k].status === 'uncertain'
    ),
  };
}

/**
 * The draft, once the operator has resolved whatever the label left open, in
 * the shape the add form opens with.
 *
 * Location and quantity stay empty on purpose: those are the two things a
 * carton cannot tell you, and the form already asks for them. The type drives
 * the default box; a weight read off the label overrides that default, since
 * the printed G.W. is the real one for this carton.
 */
export function skuDraftToPrefill(
  draft: SkuLabelDraft,
  warehouse: 'LUDLOW' | 'ATS' = 'LUDLOW'
): InventoryItemWithMetadata {
  const isBike = draft.isBike.value ?? true;
  const defaults = skuDefaultsFor(isBike);
  const sku = draft.sku.value ? normalizeSkuOnRegister(draft.sku.value) : '';
  const model = draft.model.value ? normalizeSkuModel(draft.model.value) : null;

  // "Model Size Colour" is how the catalogue names a bike (register_new_sku,
  // 20260717200000); a part is named by its model line alone.
  const name = isBike
    ? [model, draft.size.value, draft.color.value].filter(Boolean).join(' ')
    : (model ?? '');

  return {
    sku,
    item_name: name || null,
    warehouse,
    location: null,
    quantity: 0,
    is_active: true,
    distribution: [],
    sku_metadata: {
      sku,
      is_bike: isBike,
      length_in: defaults.length_in,
      width_in: defaults.width_in,
      height_in: defaults.height_in,
      weight_lbs: draft.weightLbs.value ?? defaults.weight_lbs,
      model,
      size: draft.size.value,
      color: draft.color.value,
      serial_number: draft.serial.value,
      upc: draft.upc.value,
    },
  } as unknown as InventoryItemWithMetadata;
}
