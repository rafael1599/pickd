import { describe, it, expect } from 'vitest';
import {
  batchReducer,
  batchPayload,
  batchStats,
  batchSummary,
  cardProblem,
  cardUnits,
  initialBatchState,
  sendLabel,
  type BatchAction,
  type BatchState,
  type CatalogInfo,
} from '../labelBatch';
import type { DraftField, SkuLabelDraft } from '../labelToSkuDraft';
import { serialKey, serialLooksReal } from '../serialIdentity';

const found = <T>(value: T): DraftField<T> => ({ value, status: 'found', source: 'ocr' });
const missing: DraftField<never> = { value: null, status: 'missing', source: null };
const uncertain = <T>(options: T[]): DraftField<T> => ({
  value: options[0],
  status: 'uncertain',
  source: 'ocr',
  options,
});

function draft(over: Partial<SkuLabelDraft> = {}): SkuLabelDraft {
  return {
    sku: missing,
    isBike: found(true),
    model: missing,
    size: missing,
    color: missing,
    serial: missing,
    upc: missing,
    gtin: missing,
    weightLbs: missing,
    missingFields: [],
    uncertainFields: [],
    ...over,
  };
}

const existing = (sku: string, over: Partial<CatalogInfo> = {}): CatalogInfo => ({
  canonicalSku: sku,
  isNew: false,
  existingQty: 5,
  topLocation: 'RETURN TO STOCK',
  model: 'STARLINER 7-SPD MENS',
  size: '17"',
  color: 'BLACK',
  isBike: true,
  hasImage: true,
  ...over,
});

const fresh = (sku: string): CatalogInfo => ({
  ...existing(sku),
  isNew: true,
  existingQty: 0,
  topLocation: null,
  model: null,
  size: null,
  color: null,
  isBike: null,
  hasImage: false,
});

let n = 0;
const run = (actions: BatchAction[], state: BatchState = initialBatchState('b1')) =>
  actions.reduce(batchReducer, state);

/** Shoot and read one photo; its new card (if any) is `card-<photo>`. */
function shootRead(photoId: string, d: SkuLabelDraft): BatchAction[] {
  return [
    { type: 'photoShot', id: photoId, at: 1000 + n++ },
    { type: 'photoReading', id: photoId },
    { type: 'photoRead', id: photoId, draft: d, cardId: `card-${photoId}` },
  ];
}

describe('serialIdentity', () => {
  it('rejects the label caption and short or digit-poor readings', () => {
    // `SERIALLOE` is in sku_serials today: the «SERIAL NO.» caption read as a value.
    expect(serialLooksReal('SERIALLOE')).toBe(false);
    expect(serialLooksReal('AB12')).toBe(false);
    expect(serialLooksReal('ABCDEF12')).toBe(false);
    expect(serialLooksReal('M25H000432')).toBe(true);
    expect(serialLooksReal('CM25K004628')).toBe(true);
  });

  it('folds O→0 and I→1 so two readings of one carton compare equal', () => {
    // `M25HO00435` beside `M25H000432` in sku_serials today.
    expect(serialKey('M25HO00432')).toBe(serialKey('M25H000432'));
    expect(serialKey('SERIALLOE')).toBeNull();
  });
});

describe('counting cartons (PRD §9)', () => {
  const sku = found('05-3849BK');

  it('C1 — three photos, three serials: one card, three units', () => {
    const s = run([
      ...shootRead('p1', draft({ sku, serial: found('M25H000501') })),
      ...shootRead('p2', draft({ sku, serial: found('M25H000502') })),
      ...shootRead('p3', draft({ sku, serial: found('M25H000503') })),
    ]);
    expect(s.cards).toHaveLength(1);
    expect(cardUnits(s.cards[0], s.photos)).toMatchObject({ units: 3, unproven: false });
  });

  it('C2 — the same carton twice: one unit, the second photo marked `=`', () => {
    const s = run([
      ...shootRead('p1', draft({ sku, serial: found('CM25K004625') })),
      ...shootRead('p2', draft({ sku, serial: found('CM25K004625') })),
    ]);
    const u = cardUnits(s.cards[0], s.photos);
    expect(u.units).toBe(1);
    expect(u.repeatPhotoIds).toEqual(['p2']);
  });

  it('C3 — no credible serial: every photo counts, and the card says `?`', () => {
    const s = run([
      ...shootRead('p1', draft({ sku, serial: found('SERIALLOE') })),
      ...shootRead('p2', draft({ sku, serial: found('SERIALLOE') })),
    ]);
    expect(cardUnits(s.cards[0], s.photos)).toMatchObject({ units: 2, unproven: true });
  });

  it('C4 — the O/0 confusion does not split one carton into two', () => {
    const s = run([
      ...shootRead('p1', draft({ sku, serial: found('M25H000432') })),
      ...shootRead('p2', draft({ sku, serial: found('M25HO00432') })),
    ]);
    expect(cardUnits(s.cards[0], s.photos).units).toBe(1);
  });

  it('a single photo without a serial is one unit and nothing to doubt', () => {
    const s = run(shootRead('p1', draft({ sku })));
    expect(cardUnits(s.cards[0], s.photos)).toMatchObject({ units: 1, unproven: false });
  });

  it('a typed count wins and says so', () => {
    const s = run([
      ...shootRead('p1', draft({ sku })),
      { type: 'cardUnitsTyped', cardId: 'card-p1', units: 4 },
    ]);
    expect(cardUnits(s.cards[0], s.photos)).toMatchObject({ units: 4, typed: true });
  });
});

describe('what blocks a card', () => {
  it('C5 — a NEW SKU without a model cannot be sent until one is typed', () => {
    let s = run([
      ...shootRead('p1', draft({ sku: found('03-4686GY'), size: found('54') })),
      { type: 'catalogResolved', cardId: 'card-p1', info: fresh('03-4686GY') },
    ]);
    expect(cardProblem(s.cards[0], s.photos)).toBe('needs_model');
    expect(sendLabel(batchSummary(s), s.location)).toBe('1 CARD NEEDS A MODEL');

    s = batchReducer(s, {
      type: 'cardFieldSet',
      cardId: 'card-p1',
      field: 'model',
      value: 'RENEGADE C3',
      typed: true,
    });
    expect(cardProblem(s.cards[0], s.photos)).toBeNull();
    expect(sendLabel(batchSummary(s), s.location)).toBe('SEND · 1 U → RETURN TO STOCK');
    expect(s.cards[0].redTyped).toBe(1);
  });

  it('an amber size on a NEW SKU has to be chosen, and choosing counts', () => {
    let s = run([
      ...shootRead(
        'p1',
        draft({
          sku: found('03-4686GY'),
          model: found('RENEGADE C3'),
          size: uncertain(['54', '14']),
        })
      ),
      { type: 'catalogResolved', cardId: 'card-p1', info: fresh('03-4686GY') },
    ]);
    expect(cardProblem(s.cards[0], s.photos)).toBe('choose_size');
    s = batchReducer(s, {
      type: 'cardFieldSet',
      cardId: 'card-p1',
      field: 'size',
      value: '54',
      typed: false,
    });
    expect(cardProblem(s.cards[0], s.photos)).toBeNull();
    expect(s.cards[0].amberResolved).toBe(1);
  });

  it('an EXISTING SKU is never blocked by what its label left out', () => {
    const s = run([
      ...shootRead('p1', draft({ sku: found('05-3849BK') })),
      { type: 'catalogResolved', cardId: 'card-p1', info: existing('05-3849BK') },
    ]);
    expect(cardProblem(s.cards[0], s.photos)).toBeNull();
  });

  it('photos still being read hold the whole batch', () => {
    const s = run([
      ...shootRead('p1', draft({ sku: found('05-3849BK') })),
      { type: 'catalogResolved', cardId: 'card-p1', info: existing('05-3849BK') },
      { type: 'photoShot', id: 'p2', at: 5000 },
    ]);
    const summary = batchSummary(s);
    expect(summary.canSend).toBe(false);
    expect(sendLabel(summary, s.location)).toBe('READING 1…');
  });
});

describe('the SKU the label did not give', () => {
  it('C6 — an unreadable label is a NO SKU card; typing the SKU makes it the hand’s', () => {
    let s = run([
      { type: 'photoShot', id: 'p1', at: 1 },
      { type: 'photoFailed', id: 'p1', cardId: 'card-p1' },
    ]);
    expect(cardProblem(s.cards[0], s.photos)).toBe('no_sku');
    s = batchReducer(s, {
      type: 'cardSkuTyped',
      cardId: 'card-p1',
      sku: '05 1135 gn',
      typed: true,
    });
    expect(s.cards[0].sku).toBe('05-1135GN');
    expect(batchStats(s, 2).cards_hand).toBe(1);
  });

  it('two SKU readings are never settled silently', () => {
    let s = run(shootRead('p1', draft({ sku: uncertain(['03-4686GY', '03-4636GY']) })));
    expect(s.cards[0].sku).toBeNull();
    expect(s.cards[0].skuOptions).toEqual(['03-4686GY', '03-4636GY']);
    s = batchReducer(s, {
      type: 'cardSkuTyped',
      cardId: 'card-p1',
      sku: '03-4686GY',
      typed: false,
    });
    // Picking one of the label's readings is still the camera's answer.
    expect(s.cards[0].skuSource).toBe('camera');
  });

  it('a typed SKU that is already in the pile joins that card', () => {
    const s = run([
      ...shootRead('p1', draft({ sku: found('05-1135GN'), serial: found('W25011011') })),
      { type: 'photoShot', id: 'p2', at: 2 },
      { type: 'photoFailed', id: 'p2', cardId: 'card-p2' },
      { type: 'cardSkuTyped', cardId: 'card-p2', sku: '05-1135GN', typed: true },
    ]);
    expect(s.cards).toHaveLength(1);
    expect(cardUnits(s.cards[0], s.photos).units).toBe(2);
  });
});

describe('the pile keeps its order and its promises', () => {
  it('a variant spelling folds into the card of the canonical SKU', () => {
    const s = run([
      ...shootRead('p1', draft({ sku: found('03-3768BL') })),
      { type: 'catalogResolved', cardId: 'card-p1', info: existing('03-3768BL') },
      ...shootRead('p2', draft({ sku: found('03-3768BLD') })),
      { type: 'catalogResolved', cardId: 'card-p2', info: existing('03-3768BL') },
    ]);
    expect(s.cards.map((c) => c.id)).toEqual(['card-p1']);
    expect(s.cards[0].photoIds).toEqual(['p1', 'p2']);
  });

  it('a photo deleted while it was being read leaves no card behind', () => {
    const s = run([
      { type: 'photoShot', id: 'p1', at: 1 },
      { type: 'photoReading', id: 'p1' },
      { type: 'photoRemoved', id: 'p1' },
      { type: 'photoRead', id: 'p1', draft: draft({ sku: found('05-3849BK') }), cardId: 'card-p1' },
    ]);
    expect(s.cards).toHaveLength(0);
  });

  it('removing the last photo of a camera card removes the card', () => {
    const s = run([
      ...shootRead('p1', draft({ sku: found('05-3849BK') })),
      { type: 'photoRemoved', id: 'p1' },
    ]);
    expect(s.cards).toHaveLength(0);
  });
});

describe('the write', () => {
  it('sends is_bike only for a SKU the catalogue does not have', () => {
    const s = run([
      ...shootRead('p1', draft({ sku: found('05-3849BK') })),
      { type: 'catalogResolved', cardId: 'card-p1', info: existing('05-3849BK') },
      ...shootRead(
        'p2',
        draft({
          sku: found('05-9991ZZ'),
          model: found('beach  cruiser'),
          size: found('26'),
          weightLbs: found(41.5),
        })
      ),
      { type: 'catalogResolved', cardId: 'card-p2', info: fresh('05-9991ZZ') },
    ]);
    expect(batchPayload(s)).toEqual([
      { sku: '05-3849BK', qty: 1, model: null, size: null, color: null, weight_lbs: null },
      {
        sku: '05-9991ZZ',
        qty: 1,
        model: 'BEACH CRUISER',
        size: '26',
        color: null,
        weight_lbs: 41.5,
        is_bike: true,
      },
    ]);
  });

  it('a card flipped to PART sends is_bike false; the switch covers the rest', () => {
    const s = run([
      ...shootRead(
        'p1',
        draft({ sku: found('19-1961'), model: found('SADDLE'), size: found('ADULT') })
      ),
      { type: 'catalogResolved', cardId: 'card-p1', info: fresh('19-1961') },
      { type: 'cardTypeToggled', cardId: 'card-p1' },
    ]);
    expect(batchPayload(s)[0].is_bike).toBe(false);
  });

  it('the stats count effort, not just the result', () => {
    const s = run([
      { type: 'photoShot', id: 'p0', at: 1_000 },
      { type: 'photoRemoved', id: 'p0' },
      ...shootRead('p1', draft({ sku: found('05-3849BK') })),
      { type: 'cardAddedByHand', cardId: 'h1' },
    ]);
    expect(batchStats(s, 61_000)).toEqual({
      photos: 2,
      cards_camera: 1,
      cards_hand: 1,
      amber_resolved: 0,
      red_typed: 0,
      units_hand_set: 1,
      seconds: 60,
    });
  });
});
