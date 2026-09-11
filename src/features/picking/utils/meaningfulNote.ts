// Filter order-import notes ("picking_lists.notes") down to the ones worth
// showing. The notes column is a mixed bag: useful shipping instructions live
// next to billing boilerplate ("FREE FREIGHT", "NET 60", "FF N30 W/FLA") and the
// text PickD itself appends on cancel ("[System: …]", "User Cancelled").
//
// The reading lives in `utils/orderNoteSignals` since 11 Sep 2026 (idea-179), so
// Double Check and the Ship sign apply one rule to the same note instead of two:
// a note that is only billing shows nothing; anything else — an instruction, or
// words nobody has classified — is kept, without PickD's appendages. Never lose
// information: an unknown word keeps the note.

import { noteTone, readOrderNote } from '../../../utils/orderNoteSignals';

/** Return the note if it's worth showing, else null (billing only, or empty). */
export function meaningfulNote(raw: string | null | undefined): string | null {
  const signals = readOrderNote(raw);
  return noteTone(signals) ? signals.text : null;
}
