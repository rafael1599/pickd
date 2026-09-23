/**
 * A batch of cartons registered by photographing their labels (idea-224).
 *
 * PRD: docs/prds/inventory-batch-label-intake.md. The words it uses, and this
 * module keeps:
 *   - **photo** = one label = one carton;
 *   - **card** = one SKU in the batch; its photos are its units;
 *   - **batch** = one location + one BIKES switch + the pile of cards, sent
 *     whole or not at all.
 *
 * Everything here is pure: the reducer the screen dispatches to, and the
 * readings the screen paints (units per card, what blocks a card, the payload
 * for `register_label_batch`). The camera, the recognition queue and the
 * network live elsewhere and only dispatch actions.
 */
import { settleDraftField, type DraftField, type SkuLabelDraft } from './labelToSkuDraft';
import { normalizeSerial, serialKey } from './serialIdentity';
import { normalizeSkuModel, normalizeSkuOnRegister } from '../../../utils/skuNormalize';

export const DEFAULT_BATCH_LOCATION = 'RETURN TO STOCK';

export type PhotoStatus = 'queued' | 'reading' | 'read' | 'failed';

export interface BatchPhoto {
  id: string;
  shotAt: number;
  status: PhotoStatus;
  /** The card it counts toward; null until it has been read. */
  cardId: string | null;
  /** The serial as read (normalised, never folded), or null. */
  serial: string | null;
}

/** What the catalogue says about a card's SKU (resolve_container_skus + sku_metadata). */
export interface CatalogInfo {
  /** The spelling the batch will write: the live variant sibling if there is one. */
  canonicalSku: string;
  isNew: boolean;
  /** Units of this SKU family on hand anywhere in the warehouse. */
  existingQty: number;
  /** Where most of them are, for the `IN STOCK n · LOC` line. */
  topLocation: string | null;
  /** The catalogue's own values — for an existing SKU they win over the label. */
  model: string | null;
  size: string | null;
  color: string | null;
  isBike: boolean | null;
  hasImage: boolean;
}

export type CardField = 'model' | 'size' | 'color' | 'weightLbs';

export interface BatchCard {
  id: string;
  /** Normalised SKU, or null while the label gave none and nobody typed one. */
  sku: string | null;
  /** Who produced the SKU: the camera, or a person typing it. */
  skuSource: 'camera' | 'hand';
  /**
   * The label offered two SKUs. Nothing is picked silently — a wrong SKU adds
   * stock to another bike — so the card has no SKU until one is chosen.
   */
  skuOptions: string[];
  /** Photo ids, in shot order. */
  photoIds: string[];
  model: DraftField<string>;
  size: DraftField<string>;
  color: DraftField<string>;
  weightLbs: DraftField<number>;
  /** The label reads as a part (`PCS`, `ITEM:`) — only a flag; the switch decides. */
  labelSaysPart: boolean;
  /** One card flipped against the batch switch. */
  isBikeOverride: boolean | null;
  /** Units typed by hand (✎); null = counted from the photos. */
  unitsTyped: number | null;
  /** null = not looked up yet. */
  catalog: CatalogInfo | null;
  catalogError: string | null;
  amberResolved: number;
  redTyped: number;
}

export interface BatchState {
  batchId: string;
  location: string;
  bikes: boolean;
  photos: BatchPhoto[];
  cards: BatchCard[];
  /** Every shutter press, including photos deleted later — the stat counts effort. */
  photosShot: number;
  startedAt: number | null;
}

export type BatchAction =
  | { type: 'photoShot'; id: string; at: number }
  | { type: 'photoReading'; id: string }
  | { type: 'photoRead'; id: string; draft: SkuLabelDraft; cardId: string }
  | { type: 'photoFailed'; id: string; cardId: string }
  | { type: 'photoRemoved'; id: string }
  | { type: 'cardAddedByHand'; cardId: string }
  | { type: 'cardSkuTyped'; cardId: string; sku: string; typed: boolean }
  | {
      type: 'cardFieldSet';
      cardId: string;
      field: CardField;
      value: string | number;
      typed: boolean;
    }
  | { type: 'cardUnitsTyped'; cardId: string; units: number | null }
  | { type: 'cardTypeToggled'; cardId: string }
  | { type: 'cardRemoved'; cardId: string }
  | { type: 'catalogResolved'; cardId: string; info: CatalogInfo }
  | { type: 'catalogFailed'; cardId: string; error: string }
  | { type: 'locationSet'; location: string }
  | { type: 'bikesToggled' }
  | { type: 'reset'; batchId: string };

export function initialBatchState(batchId: string): BatchState {
  return {
    batchId,
    location: DEFAULT_BATCH_LOCATION,
    bikes: true,
    photos: [],
    cards: [],
    photosShot: 0,
    startedAt: null,
  };
}

const MISSING: DraftField<never> = { value: null, status: 'missing', source: null };

function emptyCard(id: string, skuSource: BatchCard['skuSource']): BatchCard {
  return {
    id,
    sku: null,
    skuSource,
    skuOptions: [],
    photoIds: [],
    model: MISSING,
    size: MISSING,
    color: MISSING,
    weightLbs: MISSING,
    labelSaysPart: false,
    isBikeOverride: null,
    unitsTyped: null,
    catalog: null,
    catalogError: null,
    amberResolved: 0,
    redTyped: 0,
  };
}

function cardFromDraft(id: string, sku: string | null, draft: SkuLabelDraft): BatchCard {
  return {
    ...emptyCard(id, 'camera'),
    sku,
    skuOptions:
      draft.sku.status === 'uncertain'
        ? [
            ...new Set(
              (draft.sku.options ?? []).map((o) => normalizeSkuOnRegister(o)).filter(Boolean)
            ),
          ]
        : [],
    model: draft.model,
    size: draft.size,
    color: draft.color,
    weightLbs: draft.weightLbs,
    labelSaysPart: draft.isBike.status === 'found' && draft.isBike.value === false,
  };
}

/** A second label of the same SKU fills only what the first one left open. */
function fillGaps<T>(have: DraftField<T>, next: DraftField<T>): DraftField<T> {
  return have.status === 'missing' && next.status !== 'missing' ? next : have;
}

/** The card a SKU belongs to: same typed/read SKU, or the same canonical spelling. */
function findCardBySku(cards: BatchCard[], sku: string, exceptId?: string): BatchCard | undefined {
  return cards.find((c) => c.id !== exceptId && (c.sku === sku || c.catalog?.canonicalSku === sku));
}

/**
 * Two cards that turned out to be one SKU become the one that came first — the
 * pile keeps its shot order. The earlier card keeps its fields, and takes the
 * later one's photos and anything it had that the earlier lacked.
 */
function mergeCards(cards: BatchCard[], keepId: string, dropId: string): BatchCard[] {
  const keep = cards.find((c) => c.id === keepId);
  const drop = cards.find((c) => c.id === dropId);
  if (!keep || !drop) return cards;
  const merged: BatchCard = {
    ...keep,
    photoIds: [...keep.photoIds, ...drop.photoIds],
    model: fillGaps(keep.model, drop.model),
    size: fillGaps(keep.size, drop.size),
    color: fillGaps(keep.color, drop.color),
    weightLbs: fillGaps(keep.weightLbs, drop.weightLbs),
    labelSaysPart: keep.labelSaysPart || drop.labelSaysPart,
    // Both counted from photos: keep counting from photos. If either was typed,
    // the merged count is typed too — each side's own count, added.
    unitsTyped:
      keep.unitsTyped === null && drop.unitsTyped === null
        ? null
        : (keep.unitsTyped ?? keep.photoIds.length) + (drop.unitsTyped ?? drop.photoIds.length),
    skuSource: keep.skuSource === 'hand' || drop.skuSource === 'hand' ? 'hand' : 'camera',
    skuOptions: [],
    amberResolved: keep.amberResolved + drop.amberResolved,
    redTyped: keep.redTyped + drop.redTyped,
  };
  return cards.filter((c) => c.id !== dropId).map((c) => (c.id === keepId ? merged : c));
}

function orderIndex(cards: BatchCard[], id: string): number {
  return cards.findIndex((c) => c.id === id);
}

/** Merge into whichever of the two came first in the pile. */
function mergeInOrder(cards: BatchCard[], a: string, b: string): BatchCard[] {
  return orderIndex(cards, a) <= orderIndex(cards, b)
    ? mergeCards(cards, a, b)
    : mergeCards(cards, b, a);
}

export function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case 'photoShot':
      return {
        ...state,
        photos: [
          ...state.photos,
          { id: action.id, shotAt: action.at, status: 'queued', cardId: null, serial: null },
        ],
        photosShot: state.photosShot + 1,
        startedAt: state.startedAt ?? action.at,
      };

    case 'photoReading':
      return {
        ...state,
        photos: state.photos.map((p) => (p.id === action.id ? { ...p, status: 'reading' } : p)),
      };

    case 'photoRead': {
      // A photo deleted while it was being read: the result has nobody to go to.
      if (!state.photos.some((p) => p.id === action.id)) return state;
      const { draft } = action;
      const sku =
        draft.sku.status === 'found' && draft.sku.value
          ? normalizeSkuOnRegister(draft.sku.value)
          : null;
      const serial =
        draft.serial.status === 'found' && draft.serial.value
          ? normalizeSerial(draft.serial.value)
          : null;

      const existing = sku ? findCardBySku(state.cards, sku) : undefined;
      let cards: BatchCard[];
      let cardId: string;
      if (existing) {
        cardId = existing.id;
        cards = state.cards.map((c) =>
          c.id === existing.id
            ? {
                ...c,
                photoIds: [...c.photoIds, action.id],
                model: fillGaps(c.model, draft.model),
                size: fillGaps(c.size, draft.size),
                color: fillGaps(c.color, draft.color),
                weightLbs: fillGaps(c.weightLbs, draft.weightLbs),
              }
            : c
        );
      } else {
        cardId = action.cardId;
        cards = [...state.cards, { ...cardFromDraft(cardId, sku, draft), photoIds: [action.id] }];
      }
      return {
        ...state,
        cards,
        photos: state.photos.map((p) =>
          p.id === action.id ? { ...p, status: 'read', cardId, serial } : p
        ),
      };
    }

    case 'photoFailed': {
      if (!state.photos.some((p) => p.id === action.id)) return state;
      // An unreadable label is a carton all the same: a NO SKU card to type into,
      // never a photo that silently counts for nothing.
      return {
        ...state,
        cards: [...state.cards, { ...emptyCard(action.cardId, 'camera'), photoIds: [action.id] }],
        photos: state.photos.map((p) =>
          p.id === action.id ? { ...p, status: 'failed', cardId: action.cardId } : p
        ),
      };
    }

    case 'photoRemoved': {
      const photo = state.photos.find((p) => p.id === action.id);
      if (!photo) return state;
      const cards = state.cards
        .map((c) =>
          c.id === photo.cardId
            ? { ...c, photoIds: c.photoIds.filter((id) => id !== action.id) }
            : c
        )
        // A card the camera made, left with no photos and no typed count, is gone.
        .filter(
          (c) =>
            c.id !== photo.cardId ||
            c.photoIds.length > 0 ||
            c.unitsTyped !== null ||
            c.skuSource === 'hand'
        );
      return { ...state, cards, photos: state.photos.filter((p) => p.id !== action.id) };
    }

    case 'cardAddedByHand':
      return {
        ...state,
        cards: [...state.cards, { ...emptyCard(action.cardId, 'hand'), unitsTyped: 1 }],
      };

    case 'cardSkuTyped': {
      const sku = normalizeSkuOnRegister(action.sku);
      if (!sku) return state;
      const cards = state.cards.map((c) =>
        c.id === action.cardId
          ? {
              ...c,
              sku,
              // Picking one of the label's own readings is still the camera's answer.
              skuSource: action.typed ? ('hand' as const) : c.skuSource,
              skuOptions: [],
              catalog: null,
              catalogError: null,
            }
          : c
      );
      const twin = findCardBySku(cards, sku, action.cardId);
      return { ...state, cards: twin ? mergeInOrder(cards, twin.id, action.cardId) : cards };
    }

    case 'cardFieldSet':
      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.id !== action.cardId) return c;
          const before = c[action.field] as DraftField<string | number>;
          const settled = settleDraftField(before, action.value, action.typed);
          return {
            ...c,
            [action.field]: settled,
            amberResolved: c.amberResolved + (before.status === 'uncertain' ? 1 : 0),
            redTyped: c.redTyped + (before.status === 'missing' && action.typed ? 1 : 0),
          };
        }),
      };

    case 'cardUnitsTyped':
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.cardId
            ? {
                ...c,
                unitsTyped: action.units === null ? null : Math.max(0, Math.floor(action.units)),
              }
            : c
        ),
      };

    case 'cardTypeToggled':
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.cardId ? { ...c, isBikeOverride: !effectiveIsBike(c, state.bikes) } : c
        ),
      };

    case 'cardRemoved': {
      const card = state.cards.find((c) => c.id === action.cardId);
      if (!card) return state;
      return {
        ...state,
        cards: state.cards.filter((c) => c.id !== action.cardId),
        photos: state.photos.filter((p) => !card.photoIds.includes(p.id)),
      };
    }

    case 'catalogResolved': {
      // The card may have been removed, or re-typed, while the lookup was out.
      const card = state.cards.find((c) => c.id === action.cardId);
      if (!card || !card.sku) return state;
      let cards = state.cards.map((c) =>
        c.id === action.cardId ? { ...c, catalog: action.info, catalogError: null } : c
      );
      // `03-3768BLD` read, `03-3768BL` is where the stock lives: the bridge shows
      // on the card, and a second card already holding the canonical spelling
      // absorbs this one.
      const twin = findCardBySku(cards, action.info.canonicalSku, action.cardId);
      if (twin) cards = mergeInOrder(cards, twin.id, action.cardId);
      return { ...state, cards };
    }

    case 'catalogFailed':
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.cardId ? { ...c, catalogError: action.error } : c
        ),
      };

    case 'locationSet':
      return { ...state, location: action.location.trim().toUpperCase() || state.location };

    case 'bikesToggled':
      return { ...state, bikes: !state.bikes };

    case 'reset':
      return initialBatchState(action.batchId);
  }
}

// ── Readings ────────────────────────────────────────────────────────────────

export interface CardUnits {
  units: number;
  /** Some photo could not prove it was a different carton (`?`). */
  unproven: boolean;
  /** Photos that are an earlier photo's carton again (`=`). */
  repeatPhotoIds: string[];
  /** The count was typed (`✎`). */
  typed: boolean;
}

/**
 * How many cartons a card holds. Each photo is a carton unless a credible
 * serial proves it is one already counted (PRD Q3: count, and say so). A photo
 * without a credible serial counts, and marks the card `?` when it is not alone
 * — it cannot be told apart from its neighbours, and a missed box is worse than
 * a `?` that is fixed with one tap.
 */
export function cardUnits(card: BatchCard, photos: BatchPhoto[]): CardUnits {
  const own = card.photoIds
    .map((id) => photos.find((p) => p.id === id))
    .filter((p): p is BatchPhoto => !!p);
  const seen = new Set<string>();
  const repeatPhotoIds: string[] = [];
  let counted = 0;
  let unkeyed = 0;
  for (const p of own) {
    const key = serialKey(p.serial);
    if (key === null) {
      unkeyed++;
      counted++;
    } else if (seen.has(key)) {
      repeatPhotoIds.push(p.id);
    } else {
      seen.add(key);
      counted++;
    }
  }
  if (card.unitsTyped !== null) {
    return { units: card.unitsTyped, unproven: false, repeatPhotoIds, typed: true };
  }
  return { units: counted, unproven: unkeyed > 0 && counted > 1, repeatPhotoIds, typed: false };
}

export function effectiveIsBike(card: BatchCard, bikesSwitch: boolean): boolean {
  if (card.catalog && !card.catalog.isNew && card.catalog.isBike !== null)
    return card.catalog.isBike;
  return card.isBikeOverride ?? bikesSwitch;
}

export type CardProblem =
  | 'no_sku'
  | 'looking_up'
  | 'lookup_failed'
  | 'needs_model'
  | 'needs_size'
  | 'choose_model'
  | 'choose_size'
  | 'no_units';

/**
 * What stops this card from being sent, or null. A NEW SKU needs a clean model
 * and size (PRD Q1): it is the only moment someone has the carton in hand, and
 * afterwards nobody looks again — that is how `model = 'T'` got into the
 * catalogue. An existing SKU keeps what the catalogue knows, so its label
 * fields cannot block it.
 */
export function cardProblem(card: BatchCard, photos: BatchPhoto[]): CardProblem | null {
  if (!card.sku) return 'no_sku';
  if (card.catalogError) return 'lookup_failed';
  if (!card.catalog) return 'looking_up';
  if (cardUnits(card, photos).units < 1) return 'no_units';
  if (card.catalog.isNew) {
    if (!card.model.value) return 'needs_model';
    if (card.model.status === 'uncertain') return 'choose_model';
    if (!card.size.value) return 'needs_size';
    if (card.size.status === 'uncertain') return 'choose_size';
  }
  return null;
}

export interface BatchSummary {
  skus: number;
  units: number;
  newSkus: number;
  /** Photos still waiting for, or in, the reader. */
  pendingPhotos: number;
  /** Problems by kind, for the one sentence the send button says. */
  problems: Partial<Record<CardProblem, number>>;
  canSend: boolean;
}

export function batchSummary(state: BatchState): BatchSummary {
  const problems: Partial<Record<CardProblem, number>> = {};
  let units = 0;
  let newSkus = 0;
  for (const card of state.cards) {
    const problem = cardProblem(card, state.photos);
    if (problem) problems[problem] = (problems[problem] ?? 0) + 1;
    units += cardUnits(card, state.photos).units;
    if (card.catalog?.isNew) newSkus++;
  }
  const pendingPhotos = state.photos.filter(
    (p) => p.status === 'queued' || p.status === 'reading'
  ).length;
  return {
    skus: state.cards.length,
    units,
    newSkus,
    pendingPhotos,
    problems,
    canSend: state.cards.length > 0 && pendingPhotos === 0 && Object.keys(problems).length === 0,
  };
}

const PROBLEM_WORDS: Record<CardProblem, [string, string]> = {
  no_sku: ['CARD NEEDS A SKU', 'CARDS NEED A SKU'],
  looking_up: ['CARD IS CHECKING', 'CARDS ARE CHECKING'],
  lookup_failed: ['CARD COULD NOT BE CHECKED', 'CARDS COULD NOT BE CHECKED'],
  needs_model: ['CARD NEEDS A MODEL', 'CARDS NEED A MODEL'],
  needs_size: ['CARD NEEDS A SIZE', 'CARDS NEED A SIZE'],
  choose_model: ['CARD HAS 2 MODELS', 'CARDS HAVE 2 MODELS'],
  choose_size: ['CARD HAS 2 SIZES', 'CARDS HAVE 2 SIZES'],
  no_units: ['CARD HAS 0 UNITS', 'CARDS HAVE 0 UNITS'],
};

/** The send button's words: what it will do, or the one thing stopping it. */
export function sendLabel(summary: BatchSummary, location: string): string {
  if (summary.pendingPhotos > 0) return `READING ${summary.pendingPhotos}…`;
  for (const [problem, n] of Object.entries(summary.problems) as [CardProblem, number][]) {
    const [one, many] = PROBLEM_WORDS[problem];
    return `${n} ${n === 1 ? one : many}`;
  }
  if (summary.skus === 0) return 'NOTHING TO SEND';
  return `SEND · ${summary.units} U → ${location}`;
}

// ── The write ───────────────────────────────────────────────────────────────

export interface BatchPayloadItem {
  sku: string;
  qty: number;
  model?: string | null;
  size?: string | null;
  color?: string | null;
  is_bike?: boolean;
  weight_lbs?: number | null;
}

export interface BatchStats {
  photos: number;
  cards_camera: number;
  cards_hand: number;
  amber_resolved: number;
  red_typed: number;
  units_hand_set: number;
  seconds: number | null;
}

/**
 * The lines for `register_label_batch`, one per card. What the database does
 * with each field is its rule, not this one's (apply_intake_lines): model, size
 * and colour only fill blanks, `is_bike` only matters when the SKU is created,
 * and the label's weight only lands where nobody weighed the box.
 */
export function batchPayload(state: BatchState): BatchPayloadItem[] {
  return state.cards
    .filter((c) => c.sku)
    .map((card) => {
      const sku = card.catalog?.canonicalSku ?? (card.sku as string);
      const item: BatchPayloadItem = {
        sku,
        qty: cardUnits(card, state.photos).units,
        model: normalizeSkuModel(card.model.value),
        size: card.size.value?.trim() || null,
        color: card.color.value?.trim() || null,
        weight_lbs: card.weightLbs.value ?? null,
      };
      if (card.catalog?.isNew) item.is_bike = effectiveIsBike(card, state.bikes);
      return item;
    });
}

export function batchStats(state: BatchState, now: number): BatchStats {
  return {
    photos: state.photosShot,
    cards_camera: state.cards.filter((c) => c.skuSource === 'camera').length,
    cards_hand: state.cards.filter((c) => c.skuSource === 'hand').length,
    amber_resolved: state.cards.reduce((n, c) => n + c.amberResolved, 0),
    red_typed: state.cards.reduce((n, c) => n + c.redTyped, 0),
    units_hand_set: state.cards.filter((c) => c.unitsTyped !== null).length,
    seconds: state.startedAt === null ? null : Math.round((now - state.startedAt) / 1000),
  };
}
