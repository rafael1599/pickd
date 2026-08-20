/**
 * System notes — the ones PickD writes on an order by itself, as opposed to the
 * ones a person types into the composer.
 *
 * They have existed since long before this module, as bracketed prefixes stuffed
 * into `picking_list_notes.message`: `[Waiting]: …`, `[Parked]: 14D`,
 * `[AUTO] Stale pick location: …`, `[Resumed from waiting]`. In prod that is 95 of
 * 389 notes. Five writers had invented five formats — `[AUTO]` skips the colon the
 * others use — and every reader had grown its own parser.
 *
 * The authority is now the DB: migration 20260820190000 added `kind` + `metadata`
 * and a BEFORE INSERT trigger (`classify_picking_note`) that fills them from the
 * message. This module is the TS mirror, in the same spirit as `skuDefaults.ts`
 * mirrors the is_bike trigger — it exists so the UI can branch without a round
 * trip, and it must stay in sync with that migration.
 *
 * Readers should ask `isSystemNote()`, never match a prefix themselves. Adding a
 * seventh kind is one line here and one branch in `classify_picking_note`.
 */

export type SystemNoteKind =
  | 'waiting'
  | 'resumed_from_waiting'
  | 'cancelled_from_waiting'
  | 'parked'
  | 'auto_stale_location'
  | 'daylight_pickup_sms';

/**
 * The message prefix each kind is written with. Kept because `kind` is NULL on
 * any row written before the migration landed, and because a client running
 * older code can still be inserting bare messages.
 */
export const SYSTEM_NOTE_TAGS: Record<SystemNoteKind, string> = {
  waiting: '[Waiting]:',
  resumed_from_waiting: '[Resumed from waiting]',
  cancelled_from_waiting: '[Cancelled from waiting]',
  parked: '[Parked]:',
  auto_stale_location: '[AUTO]',
  daylight_pickup_sms: '[Daylight]:',
};

/** Anything note-shaped: the full row, or just a message during a write. */
export interface NoteLike {
  message: string;
  kind?: string | null;
  /** `unknown` because jsonb can hold anything — the readers below check. */
  metadata?: unknown;
}

function metadataValue(note: NoteLike, key: string): unknown {
  const meta = note.metadata;
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined;
  return (meta as Record<string, unknown>)[key];
}

/**
 * TS mirror of `classify_picking_note`'s prefix matching — the fallback for rows
 * the trigger never saw. Order matters only in that every tag is distinct.
 */
export function deriveSystemNoteKind(message: string | null | undefined): SystemNoteKind | null {
  const text = (message ?? '').trimStart();
  if (!text) return null;
  for (const [kind, tag] of Object.entries(SYSTEM_NOTE_TAGS) as [SystemNoteKind, string][]) {
    if (text.startsWith(tag)) return kind;
  }
  return null;
}

/**
 * The note's kind: the column when the DB has classified it, the prefix otherwise.
 * Returns the raw string rather than the union, because an explicit `kind` written
 * by some future caller always wins over the trigger and need not be one of ours.
 */
export function noteKind(note: NoteLike): string | null {
  return note.kind ?? deriveSystemNoteKind(note.message);
}

/** True when PickD wrote this note, false when a person did. */
export function isSystemNote(note: NoteLike): boolean {
  return noteKind(note) !== null;
}

/** True when a person typed it — what the one-line preview shows. */
export function isHumanNote(note: NoteLike): boolean {
  return !isSystemNote(note);
}

/** A number the note carried in `metadata`, or null when it isn't one. */
export function noteMetadataNumber(note: NoteLike, key: string): number | null {
  const value = metadataValue(note, key);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** A string the note carried in `metadata`, or null. */
export function noteMetadataString(note: NoteLike, key: string): string | null {
  const value = metadataValue(note, key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
