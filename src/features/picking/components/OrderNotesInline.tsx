import { usePickingNotes } from '../hooks/usePickingNotes';
import { useModal } from '../../../context/ModalContext';
import { getUserColor } from '../../../utils/userUtils';

interface OrderNotesInlineProps {
  listId: string | string[];
  /** The AS400/watcher import note (picking_lists.notes) — shown as the
   *  preview only when no user note has been added yet (a fresh order's
   *  only "note" is this one; once someone adds a real note, that becomes
   *  the more relevant thing to preview). Always available in the
   *  drill-down modal regardless, as the earliest entry. */
  watcherNote?: string | null;
  className?: string;
}

/**
 * The single, unified note surface used everywhere an order shows notes
 * (Ship, Live Board, …): a compact, always-clickable preview of the MOST
 * RECENT note — one line, author-colored — that opens the same drill-down
 * modal (full chronological history + composer) no matter where it's
 * rendered. Renders nothing when there's nothing to show.
 */
export const OrderNotesInline: React.FC<OrderNotesInlineProps> = ({
  listId,
  watcherNote,
  className,
}) => {
  const { notes } = usePickingNotes(listId);
  const { open } = useModal();

  const mostRecentUserNote = notes.length > 0 ? notes[notes.length - 1] : null;
  const rawText = mostRecentUserNote?.message ?? watcherNote ?? null;
  if (!rawText) return null;

  const orderBadge = mostRecentUserNote?.order_number
    ? `[#${mostRecentUserNote.order_number}] `
    : '';
  const previewText = `${orderBadge}${rawText}`;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        open({ type: 'order-notes', listId, watcherNote });
      }}
      title="View all notes"
      className={className ?? 'flex flex-col items-end gap-0.5 min-w-0'}
    >
      <p
        className={`text-xs font-bold truncate max-w-[60vw] hover:opacity-70 transition-opacity ${
          mostRecentUserNote ? '' : 'text-red-400'
        }`}
        style={
          mostRecentUserNote
            ? { color: getUserColor(mostRecentUserNote.user_display_name ?? null) }
            : undefined
        }
      >
        {previewText}
      </p>
    </button>
  );
};
