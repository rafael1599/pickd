// What a Ship card's notes say about sending it — shared by the list card (its
// chip and the truck button), the ship confirm and Start Shipping, so the three
// never disagree about the same order (idea-179).

import { splitOrderNumbers } from '../../../../utils/orderLabel';
import type { AS400NoteSource, BlockingLine } from '../../../../utils/orderNoteSignals';

export interface CardNotesLike {
  order_number: string | null;
  notes: string | null;
  /** Set on a combined card: every member's AS400 note. */
  member_notes?: AS400NoteSource[];
}

/** The AS400 note of every order behind a card — one per member on a combined card. */
export function cardAs400Notes(order: CardNotesLike): AS400NoteSource[] {
  return order.member_notes && order.member_notes.length > 0
    ? order.member_notes
    : [{ orderNumber: order.order_number, notes: order.notes }];
}

/** The order numbers that travel in this card's shipment. */
export function cardOrderNumbers(order: Pick<CardNotesLike, 'order_number'>): Set<string> {
  return new Set(splitOrderNumbers(order.order_number));
}

/** A pickup the carrier already says is not news — the red stripe says it. */
export function withoutKnownPickup(
  lines: BlockingLine[],
  transportCompany: string | null | undefined
): BlockingLine[] {
  const pickupCarrier = (transportCompany ?? '').trim().toUpperCase() === 'PICK UP';
  return pickupCarrier ? lines.filter((l) => l.reason !== 'PICK UP') : lines;
}

/** The opening of the ship confirm: what the notes say, before "Mark as Shipped?". */
export function blockersConfirmPrefix(lines: BlockingLine[], combined: boolean): string {
  if (lines.length === 0) return '';
  const body = lines
    .map(
      (l) => `⚠️ ${l.reason} — ${l.text}${combined && l.orderNumber ? ` (#${l.orderNumber})` : ''}`
    )
    .join('\n');
  return `${body}\n\n`;
}
