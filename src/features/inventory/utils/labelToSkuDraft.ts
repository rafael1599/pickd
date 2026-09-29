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
import type { FieldCandidate, OcrItem, SkuCandidate } from '../../../lib/recognition/clientOcr';
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

/**
 * A field the anchored pass could not claim, offered from position instead —
 * always as a choice, so the operator confirms it rather than inheriting it.
 */
function withAnchorlessFallback(field: DraftField<string>, guesses: string[]): DraftField<string> {
  if (field.status !== 'missing' || guesses.length === 0) return field;
  return {
    value: guesses[0],
    status: 'uncertain',
    source: 'ocr (sin ancla)',
    options: distinct(guesses),
  };
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

/** Lines that name a field of their own — never a model or a colour. */
const KNOWN_FIELD_LINE =
  /\b(?:JAMIS|MODEL|SIZE|SZ|COLOR|COLOUR|UPC|GTIN|EAN|P\s*\/?\s*O|PO\s*NO|MK\s*NO|C\s*\/?\s*NO|CARTON|SERIAL|Q\s*'?\s*TY|QTY|N\.?\s*W|G\.?\s*W|M\.?\s*W|NET|GROSS|PORT|MADE\s+IN|TAIWAN|CHINA|USA|PCS|SET)\b/i;

/**
 * What the label shows but never labels.
 *
 * Some cartons print the model in a black banner under the JAMIS header and
 * the colour on the line under SIZE, with no `MODEL:` or `COLOR:` anchor
 * anywhere — the XR20 carton is one, and it left both fields empty while the
 * value sat in plain sight. The anchored extractor is right not to claim
 * them: position is weaker evidence than an anchor.
 *
 * So these come back as candidates, never as settled values. The sheet shows
 * them amber and the operator confirms with one tap. That keeps the promise
 * that nothing is filled in by guesswork while still saving the typing.
 */
export function inferAnchorlessFields(lines: OcrItem[][] | undefined): {
  model: string[];
  size: string[];
  color: string[];
} {
  const texts = (lines ?? []).map((line) =>
    line
      .map((item) => item.text)
      .join(' ')
      .trim()
  );

  const plausible = (text: string): boolean => {
    if (text.length < 2 || text.length > 40) return false;
    if (KNOWN_FIELD_LINE.test(text)) return false;
    // A SKU, a code or a run of digits is never the model name or the colour.
    if (/^\d{2}-?\d{4}[A-Z]{0,2}$/i.test(text.replace(/\s/g, ''))) return false;
    const digits = (text.match(/\d/g) ?? []).length;
    return digits <= text.length / 2 && /[A-Za-z]/.test(text);
  };

  const headerIdx = texts.findIndex((t) => /\bJAMIS\b/i.test(t));
  const sizeIdx = texts.findIndex((t) => /\b(?:SIZE|SZ|SZE|S1ZE)\b/i.test(t));

  const model: string[] = [];
  const size: string[] = [];
  const color: string[] = [];

  // `SIZE:20"x10"` is one line, and when the anchored parser cannot make a
  // size out of that shape the value is still sitting right after the colon.
  // Offering the remainder verbatim beats leaving empty the field the carton
  // prints most plainly.
  if (sizeIdx >= 0) {
    const rest = texts[sizeIdx].replace(/^.*?\b(?:SIZE|SZ|SZE|S1ZE)\b\s*[:.]?\s*/i, '').trim();
    if (rest && rest.length <= 20 && /\d/.test(rest)) size.push(rest);
  }

  // The banner sits between the brand header and the size line; the one
  // nearest SIZE is the model on every layout seen so far.
  if (headerIdx >= 0 && sizeIdx > headerIdx + 1) {
    for (let i = sizeIdx - 1; i > headerIdx; i--) {
      if (plausible(texts[i])) {
        model.push(texts[i]);
        break;
      }
    }
  }

  // The colour is the unlabelled line right below SIZE — unless that line is
  // the size itself, which is how some layouts print it (`SIZE:` alone, the
  // measurement underneath). `20"x10"` reads as words to a naive check.
  // A size starts with its measurement — `20"x10"`, `700C*18"`, `17"` — while
  // a colour starts with a word. That one difference separates them cleanly.
  const looksLikeSize = (text: string) => /^\d[\dA-Za-z\s"'.,xX×*/-]*$/.test(text);
  const below = sizeIdx >= 0 ? texts[sizeIdx + 1] : undefined;
  if (below !== undefined && plausible(below) && !looksLikeSize(below)) {
    color.push(below);
  } else if (below !== undefined && looksLikeSize(below) && size.length === 0) {
    size.push(below);
    const twoBelow = texts[sizeIdx + 2];
    if (twoBelow !== undefined && plausible(twoBelow) && !looksLikeSize(twoBelow)) {
      color.push(twoBelow);
    }
  }

  return { model, size, color };
}

/**
 * GTIN-14 is a UPC-A with two leading zeros — the same identifier, written
 * wider. Deriving it is arithmetic, not a reading, so the source says so.
 */
function deriveGtinFromUpc(upc: string | null): string | null {
  if (!upc) return null;
  const digits = upc.replace(/\D/g, '');
  return digits.length === 12 ? `00${digits}` : null;
}

export function buildSkuLabelDraft(result: ClientRecognitionResult): SkuLabelDraft {
  const f = result.extractedFields;
  const extracted = result.ocr?.extracted;
  const sources = result.fieldSources ?? {};
  const fullText = result.ocr?.fullText ?? '';

  const sku = decide(
    f.sku,
    distinct([
      ...skuCandidateValues(result.allSkuCandidates),
      ...skuCandidateValues(extracted?.skuCandidates),
    ]),
    sources.sku ?? null
  );

  // Anchor-less readings only ever fill a field the anchored extractor left
  // empty, and they arrive as a choice: position is weaker than an anchor and
  // is not allowed to overrule one.
  const anchorless = inferAnchorlessFields(result.ocr?.lines);

  const model = withAnchorlessFallback(
    decide(f.model, candidateValues(extracted?.modelCandidates), sources.model ?? null),
    anchorless.model
  );
  const { size, color } = separateSizeFromColor(
    withAnchorlessFallback(
      decide(f.size, candidateValues(extracted?.sizeCandidates), sources.size ?? null),
      anchorless.size
    ),
    withAnchorlessFallback(
      decide(f.color, candidateValues(extracted?.colorCandidates), sources.color ?? null),
      anchorless.color
    )
  );

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

  const derivedGtin = deriveGtinFromUpc(upc.value);
  const gtin =
    f.gtin || !derivedGtin
      ? decide(f.gtin ?? null, [], sources.gtin ?? null)
      : { value: derivedGtin, status: 'found' as const, source: 'derivado del UPC' };

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
    missingFields: keys.filter(
      (k) => (draft as Record<string, DraftField<unknown>>)[k].status === 'missing'
    ),
    uncertainFields: keys.filter(
      (k) => (draft as Record<string, DraftField<unknown>>)[k].status === 'uncertain'
    ),
  };
}

/** A size at the very end of a colour: `… 700C X 54CM`, `… 26"x18"`. */
const SIZE_AT_END =
  /\s*[-/,]?\s*((?:700\s*C?|\d{2}(?:\.\d)?)\s*["'”]{0,2}\s*[x×*]\s*\d{2}(?:\.\d)?\s*(?:CM|["'”]{1,2})?)\s*$/i;

/**
 * A colour never contains a size. On some cartons the size line runs into the
 * colour line, and the reader hands back `ADOBE CLAY / BRONZE DUSK 700C X 54CM`
 * as the colour with the size missing — which is how `03-4686GY` was stored in
 * prod (23 sep 2026). The size is split off, and **both** come back amber: the
 * split is a reading, so the operator confirms it with one tap instead of it
 * being settled silently.
 */
export function separateSizeFromColor(
  size: DraftField<string>,
  color: DraftField<string>
): { size: DraftField<string>; color: DraftField<string> } {
  if (!color.value) return { size, color };
  const match = SIZE_AT_END.exec(color.value);
  if (!match) return { size, color };
  const stripped = color.value
    .slice(0, match.index)
    .replace(/[\s/,-]+$/, '')
    .trim();
  if (!stripped) return { size, color };
  const fragment = match[1].trim();
  return {
    color: {
      value: stripped,
      status: 'uncertain',
      source: color.source,
      options: distinct([stripped, color.value]),
    },
    size:
      size.status === 'missing'
        ? {
            value: fragment,
            status: 'uncertain',
            source: 'ocr (dentro del color)',
            options: [fragment],
          }
        : size,
  };
}

/**
 * One field, from several labels of the same photo. What they agree on stays
 * `found`; what they disagree on is offered, the reading most labels share
 * first (it is the default the card shows). A label that says nothing does not
 * vote. A value only one label *offered* among others counts half: it is a
 * guess of that label, not a statement.
 */
export function mergeDraftFields<T>(
  fields: DraftField<T>[],
  keyOf: (v: T) => string = (v) =>
    String(v)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
): DraftField<T> {
  const tally = new Map<string, { value: T; votes: number; first: number }>();
  const sources: string[] = [];
  let order = 0;
  for (const f of fields) {
    if (f.status === 'missing') continue;
    // "CONFLICTO: a ≠ b" is the recogniser flagging a clash, not a reading: its sides come as options.
    const readings = (
      f.status === 'uncertain'
        ? distinct<T>([f.value, ...(f.options ?? [])])
        : distinct<T>([f.value])
    ).filter((v) => !(typeof v === 'string' && v.startsWith('CONFLICTO')));
    readings.forEach((v, i) => {
      const k = keyOf(v);
      const vote = f.status === 'found' || i === 0 ? 1 : 0.5;
      const t = tally.get(k);
      if (t) t.votes += vote;
      else tally.set(k, { value: v, votes: vote, first: order++ });
    });
    if (f.source && !sources.includes(f.source)) sources.push(f.source);
  }
  if (tally.size === 0) return { value: null, status: 'missing', source: null };
  const ranked = [...tally.values()].sort((a, b) => b.votes - a.votes || a.first - b.first);
  const labels = fields.filter((f) => f.status !== 'missing').length;
  const source = labels > 1 ? `${sources.join(' + ')} · ${labels} etiquetas` : (sources[0] ?? null);
  const allFound = fields.every((f) => f.status !== 'uncertain');
  if (ranked.length === 1 && allFound) return { value: ranked[0].value, status: 'found', source };
  return {
    value: ranked[0].value,
    status: 'uncertain',
    source,
    options: ranked.map((r) => r.value),
  };
}

/**
 * Every label of one photo, as one draft (lote por fotos, 29 sep 2026): the
 * product label, the serial sticker, a second label with the weight. Each field
 * takes what all of them say (`mergeDraftFields`). SKUs are compared in their
 * canonical spelling, weights to the tenth of a pound.
 */
export function mergeDrafts(drafts: SkuLabelDraft[]): SkuLabelDraft {
  if (drafts.length === 1) return drafts[0];
  const pick = <K extends keyof SkuLabelDraft>(k: K) =>
    drafts.map((d) => d[k]) as SkuLabelDraft[K][];
  const draft = {
    sku: mergeDraftFields(pick('sku') as DraftField<string>[], (v) =>
      normalizeSkuOnRegister(v)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
    ),
    isBike: mergeDraftFields(pick('isBike') as DraftField<boolean>[]),
    model: mergeDraftFields(pick('model') as DraftField<string>[]),
    size: mergeDraftFields(pick('size') as DraftField<string>[]),
    color: mergeDraftFields(pick('color') as DraftField<string>[]),
    serial: mergeDraftFields(pick('serial') as DraftField<string>[]),
    upc: mergeDraftFields(pick('upc') as DraftField<string>[], (v) => v.replace(/\D/g, '')),
    gtin: mergeDraftFields(pick('gtin') as DraftField<string>[], (v) => v.replace(/\D/g, '')),
    weightLbs: mergeDraftFields(pick('weightLbs') as DraftField<number>[], (v) => v.toFixed(1)),
  };
  const keys = Object.keys(draft) as (keyof SkuLabelDraft)[];
  return {
    ...draft,
    missingFields: keys.filter(
      (k) => (draft as Record<string, DraftField<unknown>>)[k].status === 'missing'
    ),
    uncertainFields: keys.filter(
      (k) => (draft as Record<string, DraftField<unknown>>)[k].status === 'uncertain'
    ),
  };
}

/**
 * A field the operator settled: an amber reading they picked, or a red one they
 * typed. Settled is `found` — the only open question left was theirs, and they
 * answered it. The single-box sheet and the batch both settle through here.
 */
export function settleDraftField<T>(field: DraftField<T>, value: T, typed = false): DraftField<T> {
  return { value, status: 'found', source: typed ? 'hand' : field.source };
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
  warehouse: 'LUDLOW' | 'ATS' = 'LUDLOW',
  options: { includeSerial?: boolean } = {}
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
      // sku_metadata holds one row per SKU, so a serial written here is the
      // catalogue's answer for EVERY box of that SKU — registering a second
      // XR20 would overwrite the first one's with its own. The field exists
      // for S/D units, which are single serialised units by definition, so it
      // is only filled when the operator says this is one of those.
      serial_number: options.includeSerial ? draft.serial.value : null,
      upc: draft.upc.value,
    },
  } as unknown as InventoryItemWithMetadata;
}
