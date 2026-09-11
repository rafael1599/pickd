import { describe, expect, it } from 'vitest';
import {
  SYSTEM_NOTE_TAGS,
  deriveSystemNoteKind,
  isHumanNote,
  isSystemNote,
  noteKind,
  noteMetadataNumber,
  noteMetadataString,
} from '../systemNotes';

// The exact strings prod holds, per the audit of the 95 tagged notes.
const REAL_MESSAGES: Array<[string, string]> = [
  ['[Waiting]: Waiting for james — 01-560 missing', 'waiting'],
  ['[Resumed from waiting]', 'resumed_from_waiting'],
  ['[Cancelled from waiting]', 'cancelled_from_waiting'],
  ['[Cancelled]: 19 units returned to RETURN TO STOCK across 7 line(s).', 'cancelled_order'],
  ['[Parked]: 14D', 'parked'],
  ['[AUTO] Stale pick location: 12-0509 @ D17 (0) → D17 (9)', 'auto_stale_location'],
  ['[Daylight]: Texted Luis — 4 pallets to pick up', 'daylight_pickup_sms'],
  ['[Add-On] Completed via merge into #881301', 'addon'],
  ['[Take Over SKU] 03-4704GY x2 moved to order #881485', 'take_over_sku'],
];

// The sentences PickD writes with no prefix — real rows from prod, Sep 2026.
const TEMPLATE_MESSAGES: Array<[string, string]> = [
  ['Replaced 03-3742BK → 03-3742BK: Pickd from ROW 6', 'correction'],
  ['Replaced 03-3768BL → 03-3768BL [REBOX → ROW 43]: Location', 'correction'],
  ['Replaced 860001BK → 86-001BK [FDX STATION]: New item added to pickd', 'correction'],
  ['Swapped SKU 033768BLD → 03-3768BL', 'correction'],
  ['Removed 01-0449: Shipped before in ORDER #879790/879791', 'correction'],
  ['Removed SKU 03-4056BL from order', 'correction'],
  ['Adjusted 03-3738BK qty to 2: Partial stock only', 'correction'],
  ['Adjusted qty for 03-3987GY to 1', 'correction'],
  ['Added 03-3768BL (qty 2): Fix', 'correction'],
  ['Extra item: 12-9833, qty 18 (total 18)', 'correction'],
  ['Order reopened for editing. Reason: add on', 'order_event'],
  ['Order re-completed after reopen #1', 'order_event'],
  ['Reopen cancelled — items restored to original completed state', 'order_event'],
  ['Order restored from cancelled to active. Reason: wrong order', 'order_event'],
  ['Order deleted from completed state. Restored 4 units', 'order_event'],
];

describe('deriveSystemNoteKind', () => {
  it('classifies every tag that exists in prod', () => {
    for (const [message, kind] of REAL_MESSAGES) {
      expect(deriveSystemNoteKind(message)).toBe(kind);
    }
  });

  it('keeps the two cancel tags apart', () => {
    // `[Cancelled]:` is a completed order sent back to stock; `[Cancelled from
    // waiting]` is an order that died waiting for inventory. Same word, two
    // different events — a reader that matched on `[Cancelled` would merge them.
    expect(deriveSystemNoteKind('[Cancelled from waiting]')).toBe('cancelled_from_waiting');
    expect(deriveSystemNoteKind('[Cancelled]: 3 units returned')).toBe('cancelled_order');
  });

  it('leaves human notes unclassified', () => {
    // The second one is the trap: it mentions pallets but nobody tagged it.
    expect(deriveSystemNoteKind('DO NOT SHIP BEFORE 8/25')).toBeNull();
    expect(deriveSystemNoteKind('Customer asked for 4 pallets max')).toBeNull();
    expect(deriveSystemNoteKind('')).toBeNull();
    expect(deriveSystemNoteKind(null)).toBeNull();
  });

  it('has a tag registered for every kind it can return', () => {
    for (const [, kind] of REAL_MESSAGES) {
      expect(SYSTEM_NOTE_TAGS[kind as keyof typeof SYSTEM_NOTE_TAGS]).toBeTruthy();
    }
  });

  it('recognizes the sentences PickD writes with no prefix', () => {
    for (const [message, kind] of TEMPLATE_MESSAGES) {
      expect(deriveSystemNoteKind(message)).toBe(kind);
    }
  });

  it('does not take a person starting with the same word for a template', () => {
    // What people typed on orders in prod, plus the shapes that would be the trap.
    expect(deriveSystemNoteKind('Removed the damaged box, bike is fine')).toBeNull();
    expect(deriveSystemNoteKind('Added a second pallet')).toBeNull();
    expect(deriveSystemNoteKind('Replaced the label')).toBeNull();
    expect(deriveSystemNoteKind('Order is ready at the dock')).toBeNull();
    expect(deriveSystemNoteKind('Hold for missing bike')).toBeNull();
    expect(deriveSystemNoteKind('Hamish picked it up')).toBeNull();
  });
});

describe('noteKind', () => {
  it('trusts the kind column when the DB has classified the row', () => {
    expect(noteKind({ message: 'anything at all', kind: 'parked' })).toBe('parked');
  });

  it('falls back to the prefix for rows written before the migration', () => {
    expect(noteKind({ message: '[Parked]: 14D', kind: null })).toBe('parked');
    expect(noteKind({ message: '[Parked]: 14D' })).toBe('parked');
  });

  it('lets an explicit kind outside our union through', () => {
    // The trigger only fills a NULL kind, so a future caller can set its own.
    expect(noteKind({ message: 'x', kind: 'something_new' })).toBe('something_new');
  });
});

describe('isSystemNote / isHumanNote', () => {
  it('treats every tagged note as system-written', () => {
    for (const [message] of REAL_MESSAGES) {
      expect(isSystemNote({ message })).toBe(true);
      expect(isHumanNote({ message })).toBe(false);
    }
  });

  it('treats PickD templates as system-written even with kind NULL', () => {
    // #881448: this template covered «DO NOT SHIP. HP PICKUP FRI» in the preview.
    for (const [message] of TEMPLATE_MESSAGES) {
      expect(isHumanNote({ message, kind: null })).toBe(false);
    }
  });

  it('treats an untagged note as a person writing', () => {
    expect(isHumanNote({ message: 'DO NOT SHIP BEFORE 8/25' })).toBe(true);
  });
});

describe('metadata readers', () => {
  it('reads the fields the trigger fills', () => {
    expect(noteMetadataString({ message: 'x', metadata: { location: '14D' } }, 'location')).toBe(
      '14D'
    );
    expect(noteMetadataNumber({ message: 'x', metadata: { pallets: 4 } }, 'pallets')).toBe(4);
  });

  it('survives jsonb holding something that is not an object', () => {
    // The column accepts any JSON; readers must not throw on a scalar or array.
    for (const metadata of [null, undefined, 'a string', 42, ['a'], true]) {
      expect(noteMetadataNumber({ message: 'x', metadata }, 'pallets')).toBeNull();
      expect(noteMetadataString({ message: 'x', metadata }, 'location')).toBeNull();
    }
  });

  it('returns null for a key the note does not carry', () => {
    expect(
      noteMetadataNumber({ message: 'x', metadata: { location: '14D' } }, 'pallets')
    ).toBeNull();
  });
});
