import { useModal } from '../../../context/ModalContext';
import { useOrderNoteEntries } from '../hooks/useOrderNoteEntries';
import {
  noteLabel,
  type AS400NoteSource,
  type NoteTone,
  type OrderNoteEntry,
} from '../../../utils/orderNoteSignals';

interface OrderNotesInlineProps {
  listId: string | string[];
  /** The AS400 note (picking_lists.notes) of a single order. */
  watcherNote?: string | null;
  /** The AS400 note of every member of a combined order — one line each. Wins
   *  over `watcherNote`, which on a combined card is only the anchor's. */
  watcherNotes?: AS400NoteSource[];
  combinedNumbers?: string[];
  className?: string;
  /**
   * 'line' — the board card: the strongest note, one line, in its type's colour.
   * 'sign' — the Ship card: an LED-style strip, up to two notes with their type,
   * then '+N'. Both open the same full history.
   */
  variant?: 'line' | 'sign';
}

/** On the page background — readable in both themes (ui-rules §10). */
const LINE_TONE: Record<NoteTone, string> = {
  pickup: 'text-red-500',
  hold: 'text-amber-500',
  ship_with: 'text-blue-500',
  delivery: 'text-cyan-600',
  note: 'text-content',
};

/** On the sign's black strip. */
const SIGN_TONE: Record<NoteTone, string> = {
  pickup: 'text-red-400',
  hold: 'text-amber-300',
  ship_with: 'text-blue-400',
  delivery: 'text-cyan-300',
  note: 'text-slate-100',
};

const SIGN_LINES = 2;

/** The last three digits, the way the board prints a combined member ('#347'). */
function shortOrder(orderNumber: string | null): string | null {
  return orderNumber ? `#${orderNumber.slice(-3)}` : null;
}

/**
 * The single, unified note surface used everywhere an order shows notes
 * (Ship, Live Board, …): a compact, always-clickable preview that opens the same
 * drill-down modal (full chronological history + composer) no matter where it's
 * rendered. Renders nothing when there's nothing to show.
 *
 * What it previews is the strongest note, not the newest: a pickup, then a hold,
 * then a ship-together, a delivery instruction, and last a plain note — each in
 * its colour (utils/orderNoteSignals). Billing boilerplate and the notes PickD
 * writes about itself never reach it; they stay in the history (idea-179).
 */
export const OrderNotesInline: React.FC<OrderNotesInlineProps> = ({
  listId,
  watcherNote,
  watcherNotes,
  combinedNumbers,
  className,
  variant = 'line',
}) => {
  const { open } = useModal();
  const isCombined = Array.isArray(listId) && listId.length > 1;
  const as400: AS400NoteSource[] =
    watcherNotes && watcherNotes.length > 0
      ? watcherNotes
      : [{ orderNumber: null, notes: watcherNote ?? null }];
  const entries = useOrderNoteEntries(listId, as400);
  if (entries.length === 0) return null;

  const openHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    open({ type: 'order-notes', listId, watcherNote, watcherNotes, combinedNumbers });
  };

  if (variant === 'sign') {
    const shown = entries.slice(0, SIGN_LINES);
    const more = entries.length - shown.length;
    return (
      <button
        onClick={openHistory}
        title="View all notes"
        className={
          className ??
          'block w-full max-w-full min-w-0 text-left rounded-md bg-black px-2 py-1 font-mono uppercase leading-tight hover:opacity-90 transition-opacity'
        }
      >
        {shown.map((entry, i) => (
          <SignLine key={i} entry={entry} showOrder={isCombined} />
        ))}
        {more > 0 && (
          <span className="block text-[10px] font-bold text-slate-400">+{more} more</span>
        )}
      </button>
    );
  }

  const top = entries[0];
  const badge = isCombined && top.orderNumber ? `[#${top.orderNumber}] ` : '';
  return (
    <button
      onClick={openHistory}
      title="View all notes"
      className={className ?? 'flex flex-col items-end gap-0.5 min-w-0'}
    >
      <p
        className={`text-xs font-bold truncate max-w-[60vw] hover:opacity-70 transition-opacity ${LINE_TONE[top.tone]}`}
      >
        {badge}
        {top.text}
      </p>
    </button>
  );
};

function SignLine({ entry, showOrder }: { entry: OrderNoteEntry; showOrder: boolean }) {
  const tone = SIGN_TONE[entry.tone];
  const order = showOrder ? shortOrder(entry.orderNumber) : null;
  return (
    <span
      className={`block truncate text-[11px] ${tone}`}
      style={{ textShadow: '0 0 6px currentColor' }}
    >
      {order && <span className="text-slate-400">{order} </span>}
      <span className="font-black">{noteLabel(entry.signals)}</span>
      <span className="opacity-80"> · {entry.text}</span>
      {entry.author && (
        <span className="normal-case text-slate-500" style={{ textShadow: 'none' }}>
          {' '}
          — {entry.author}
        </span>
      )}
    </span>
  );
}
