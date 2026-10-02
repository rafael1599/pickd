import { describe, expect, it } from 'vitest';
import {
  buildItemCardWrite,
  itemCardBaseline,
  itemCardChanges,
  type ItemCardMeta,
  type ItemCardState,
  toggleSquare,
} from '../itemCardEdit';
import type { InventoryItemWithMetadata } from '../../../../schemas/inventory.schema';

/** The CODA S2 of the screenshot: 50 in ROW 1 · A. */
const coda = {
  id: 7,
  sku: '03-3933BK',
  item_name: 'CODA S2 16" GLOSS BLACK',
  location: 'ROW 1',
  sublocation: ['A'],
  quantity: 50,
  warehouse: 'LUDLOW',
  internal_note: null,
  distribution: [{ type: 'TOWER', count: 1, units_each: 12 }],
} as unknown as InventoryItemWithMetadata;

const meta: ItemCardMeta = {
  is_bike: true,
  model: 'CODA S2',
  size: '16"',
  color: 'GLOSS BLACK',
  length_in: 55,
  width_in: 8.5,
  height_in: 30.5,
  weight_lbs: 33.6,
  dimensions_verified: false,
  weight_verified: true,
};

const edit = (patch: (c: ItemCardState) => void) => {
  const base = itemCardBaseline(coda, meta);
  const cur: ItemCardState = JSON.parse(JSON.stringify(base));
  patch(cur);
  return { base, cur };
};

describe('itemCardBaseline', () => {
  it('reads the row and the catalogue', () => {
    const b = itemCardBaseline(coda, meta);
    expect(b.fields).toMatchObject({ sku: '03-3933BK', model: 'CODA S2', size: '16"' });
    expect(b).toMatchObject({ location: 'ROW 1', squares: ['A'], quantity: 50, isBike: true });
  });

  it('takes model, size and colour from the name when the catalogue has no model', () => {
    const b = itemCardBaseline(
      { ...coda, item_name: 'EXPLORER A2 15 2026 GLOSS BLAC' } as InventoryItemWithMetadata,
      { is_bike: true }
    );
    expect(b.fields.model).toBe('EXPLORER A2');
  });
});

describe('itemCardChanges', () => {
  it('nothing touched, nothing to save', () => {
    const { base, cur } = edit(() => {});
    expect(itemCardChanges(base, cur)).toEqual([]);
  });

  it('counts each value once (V4, V5)', () => {
    const { base, cur } = edit((c) => {
      c.quantity = 53;
      c.location = 'ROW 25';
      c.squares = ['D'];
    });
    expect(itemCardChanges(base, cur)).toEqual(['where', 'qty']);
  });

  it('the same squares in another order are not a change', () => {
    const base = itemCardBaseline({ ...coda, sublocation: ['A', 'B'] } as never, meta);
    const cur = { ...base, squares: ['B', 'A'] };
    expect(itemCardChanges(base, cur)).toEqual([]);
  });
});

describe('buildItemCardWrite', () => {
  it('a quantity change touches the row and leaves the catalogue alone', () => {
    const { base, cur } = edit((c) => (c.quantity = 53));
    const w = buildItemCardWrite({ original: coda, meta, base, cur, distribution: [] });
    expect(w.item).toMatchObject({ quantity: 53, location: 'ROW 1', sublocation: ['A'] });
    expect(w.item.item_name).toBe('CODA S2 16" GLOSS BLACK');
    expect(w.metadata).toBeNull();
  });

  it('a colour change writes the name trio, and renames the row', () => {
    const { base, cur } = edit((c) => (c.fields.color = 'MATTE BLACK'));
    const w = buildItemCardWrite({ original: coda, meta, base, cur, distribution: [] });
    expect(w.metadata).toEqual({
      sku: '03-3933BK',
      model: 'CODA S2',
      size: '16"',
      color: 'MATTE BLACK',
    });
    expect(w.item.item_name).toBe('CODA S2 16" MATTE BLACK');
  });

  it('a move off a ROW drops the square', () => {
    const { base, cur } = edit((c) => (c.location = 'RETURN TO STOCK'));
    const w = buildItemCardWrite({ original: coda, meta, base, cur, distribution: [] });
    expect(w.item.sublocation).toBeNull();
  });

  it('a rename carries the catalogue, but only the measurements somebody took', () => {
    const { base, cur } = edit((c) => (c.fields.sku = '03-3933bk2'));
    const w = buildItemCardWrite({ original: coda, meta, base, cur, distribution: [] });
    expect(w.renamed).toBe(true);
    expect(w.metadata).toMatchObject({ is_bike: true, model: 'CODA S2', weight_lbs: 33.6 });
    expect(w.metadata).not.toHaveProperty('length_in');
  });

  it('clearing a field writes null', () => {
    const { base, cur } = edit((c) => (c.fields.size = ''));
    const w = buildItemCardWrite({ original: coda, meta, base, cur, distribution: [] });
    expect(w.metadata).toMatchObject({ sku: '03-3933BK', size: null });
  });
});

describe('toggleSquare', () => {
  it('one unit: a tap moves it to that square, a second tap clears it', () => {
    expect(toggleSquare(['A'], 'C', 1)).toEqual(['C']);
    expect(toggleSquare(['C'], 'C', 1)).toEqual([]);
  });

  it('several units: taps add and remove squares, in board order', () => {
    expect(toggleSquare(['C'], 'A', 3)).toEqual(['A', 'C']);
    expect(toggleSquare(['A', 'C'], 'B', 3)).toEqual(['A', 'B', 'C']);
    expect(toggleSquare(['A', 'B', 'C'], 'B', 3)).toEqual(['A', 'C']);
  });

  it('never more squares than units: the first one drops', () => {
    expect(toggleSquare(['A', 'B'], 'D', 2)).toEqual(['B', 'D']);
  });
});
