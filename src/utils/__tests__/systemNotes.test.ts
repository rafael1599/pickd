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
  ['[Parked]: 14D', 'parked'],
  ['[AUTO] Stale pick location: 12-0509 @ D17 (0) → D17 (9)', 'auto_stale_location'],
  ['[Daylight]: Texted Luis — 4 pallets to pick up', 'daylight_pickup_sms'],
];

describe('deriveSystemNoteKind', () => {
  it('classifies every tag that exists in prod', () => {
    for (const [message, kind] of REAL_MESSAGES) {
      expect(deriveSystemNoteKind(message)).toBe(kind);
    }
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
