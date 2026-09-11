import { useRef } from 'react';
import { useModal } from '../../../context/ModalContext';
import { useOrderNoteEntries } from '../hooks/useOrderNoteEntries';
import { useLedMode } from '../../../hooks/useLedMode';
import { LedSign, type LedSignSize } from '../../../components/ui/LedSign';
import { LED_MODE_LABEL, type LedNote } from '../../../utils/led/ledText';
import {
  latestNoteEntries,
  noteLabel,
  type AS400NoteSource,
  type NoteTone,
  type OrderNoteEntry,
} from '../../../utils/orderNoteSignals';

interface OrderNotesInlineProps {
  listId: string | string[];
  /** The AS400 note (picking_lists.notes) of a single order. */
  watcherNote?: string | null;
  /** The AS400 note of every member of a combined order. Wins over `watcherNote`,
   *  which on a combined card is only the anchor's. */
  watcherNotes?: AS400NoteSource[];
  combinedNumbers?: string[];
  className?: string;
  /**
   * 'large' — Ship, under the four numbers; holding it steps through the modes.
   * 'small' — each Live Board card. Both open the same full history on a tap.
   */
  size?: LedSignSize;
}

/** The newest two (Rafael, 11 Sep 2026). */
const SIGN_NOTES = 2;
const LONG_PRESS_MS = 550;

/** LED colours: the tones of the old strip, as the lit dot of each. */
const LED_TONE: Record<NoteTone, string> = {
  pickup: '#ff4a3d',
  hold: '#ffb21e',
  ship_with: '#4a7dff',
  delivery: '#3ff0e0',
  note: '#f2f5ff',
};
const LED_DIM = '#8a93a3';

/** The last three digits, the way the board prints a combined member ('#347'). */
function shortOrder(orderNumber: string | null): string | null {
  return orderNumber ? `#${orderNumber.slice(-3)}` : null;
}

/** 'PICK UP · DO NOT SHIP DEALER PICK UP' — but a note that already says its label says it once. */
function noteLine(entry: OrderNoteEntry): string {
  const label = noteLabel(entry.signals);
  const squash = (s: string) => s.toUpperCase().replace(/\s+/g, ' ');
  return squash(entry.text).includes(squash(label)) ? entry.text : `${label} · ${entry.text}`;
}

function toLedNote(entry: OrderNoteEntry, showOrder: boolean): LedNote {
  const order = showOrder ? shortOrder(entry.orderNumber) : null;
  return [
    ...(order ? [{ text: `${order} `, color: LED_DIM }] : []),
    { text: noteLine(entry), color: LED_TONE[entry.tone] },
  ];
}

/**
 * The note surface of an order, the same on Ship and on the Live Board: an LED
 * sign with the two newest notes, each in its type's colour, running right to
 * left so a long note is read whole. A tap opens the full history and composer.
 * Renders nothing when there is nothing to show.
 *
 * Billing boilerplate and the notes PickD writes about itself never reach it;
 * they stay in the history (idea-179).
 */
export const OrderNotesInline: React.FC<OrderNotesInlineProps> = ({
  listId,
  watcherNote,
  watcherNotes,
  combinedNumbers,
  className,
  size = 'large',
}) => {
  const { open } = useModal();
  const [mode, cycleMode] = useLedMode();
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const isCombined = Array.isArray(listId) && listId.length > 1;
  const as400: AS400NoteSource[] =
    watcherNotes && watcherNotes.length > 0
      ? watcherNotes
      : [{ orderNumber: null, notes: watcherNote ?? null }];
  const entries = useOrderNoteEntries(listId, as400);
  const latest = latestNoteEntries(entries, SIGN_NOTES);
  if (latest.length === 0) return null;

  const notes = latest.map((entry) => toLedNote(entry, isCombined));
  const spoken = latest.map(noteLine).join('. ');
  const canCycle = size === 'large';

  const endPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const startPress = () => {
    if (!canCycle) return;
    endPress();
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      cycleMode();
      if ('vibrate' in navigator) navigator.vibrate(12);
    }, LONG_PRESS_MS);
  };

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    open({ type: 'order-notes', listId, watcherNote, watcherNotes, combinedNumbers });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
      onContextMenu={canCycle ? (e) => e.preventDefault() : undefined}
      title={canCycle ? `All notes · hold to change mode (${LED_MODE_LABEL[mode]})` : 'All notes'}
      aria-label={`Notes: ${spoken}`}
      className={`${className ?? 'block w-full'} select-none [-webkit-touch-callout:none] hover:opacity-90 transition-opacity`}
    >
      <LedSign notes={notes} size={size} mode={mode} label={spoken} />
    </button>
  );
};
