import { useMemo } from 'react';
import { usePickingNotes, type PickingNote } from './usePickingNotes';
import { isHumanNote } from '../../../utils/systemNotes';
import {
  orderNoteEntries,
  type AS400NoteSource,
  type OrderNoteEntry,
  type TypedNoteSource,
} from '../../../utils/orderNoteSignals';

/** What people typed on an order, as the sign reads it — PickD's own notes out. */
export function typedNoteSources(notes: readonly PickingNote[]): TypedNoteSource[] {
  return notes.filter(isHumanNote).map((n) => ({
    message: n.message,
    orderNumber: n.order_number ?? null,
    author: n.user_display_name ?? null,
    at: n.created_at,
  }));
}

/**
 * Every note an order shows, strongest first: the AS400 note of each member plus
 * what people typed. PickD's own notes (corrections, lifecycle, `[Parked]`…)
 * stay in the history — they used to win the one-line preview and cover the
 * office's instruction (idea-179).
 *
 * Pass `null` as `listId` to skip the fetch (a shipped card that shows no notes).
 */
export function useOrderNoteEntries(
  listId: string | string[] | null,
  as400: readonly AS400NoteSource[]
): OrderNoteEntry[] {
  const { notes } = usePickingNotes(listId);
  // The AS400 sources are rebuilt by callers on every render; key them by value.
  const as400Key = JSON.stringify(as400);
  return useMemo(
    () => orderNoteEntries(JSON.parse(as400Key) as AS400NoteSource[], typedNoteSources(notes)),
    [as400Key, notes]
  );
}
