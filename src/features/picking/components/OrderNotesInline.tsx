import { usePickingNotes } from '../hooks/usePickingNotes';
import { isHumanNote } from '../../../utils/systemNotes';
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
  combinedNumbers?: string[];
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
  combinedNumbers,
  className,
}) => {
  const { notes } = usePickingNotes(listId);
  const { open } = useModal();

  const isCombined = Array.isArray(listId) && listId.length > 1;
  // One rule for the preview: a person's note beats anything PickD wrote itself.
  // System notes are bookkeeping — "[Waiting]: waiting for james", "[Parked]: 14D",
  // "[Daylight]: Texted Luis" — and letting the newest one win meant an order whose
  // real instruction says "DO NOT SHIP BEFORE 8/25" previewed as something else.
  // They all stay in the drill-down history.
  const previewableNotes = notes.filter(isHumanNote);
  const mostRecentUserNote =
    previewableNotes.length > 0 ? previewableNotes[previewableNotes.length - 1] : null;
  const rawText = mostRecentUserNote?.message ?? watcherNote ?? null;
  if (!rawText) return null;

  const orderBadge =
    isCombined && mostRecentUserNote?.order_number ? `[#${mostRecentUserNote.order_number}] ` : '';
  const previewText = `${orderBadge}${rawText}`;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        open({ type: 'order-notes', listId, watcherNote, combinedNumbers });
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
