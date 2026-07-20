import { usePickingNotes } from '../hooks/usePickingNotes';
import { useModal } from '../../../context/ModalContext';
import { getUserColor } from '../../../utils/userUtils';

interface OrderNotesInlineProps {
  listId: string;
}

/**
 * Compact preview for the order header — last 2 notes as author-colored text
 * (no name, no timestamp; that detail lives in the drill-down modal).
 * Clicking it opens the same modal as "View All Notes" / "Add Note" in the
 * order's kebab menu, which is the persistent entry point for both actions.
 * Renders nothing when there are no notes.
 */
export const OrderNotesInline: React.FC<OrderNotesInlineProps> = ({ listId }) => {
  const { notes } = usePickingNotes(listId);
  const { open } = useModal();

  const preview = notes.slice(-2);
  if (preview.length === 0) return null;

  return (
    <button
      onClick={() => open({ type: 'order-notes', listId })}
      title="View all notes"
      className="flex flex-col items-end gap-0.5 min-w-0"
    >
      {preview.map((note) => (
        <p
          key={note.id}
          className="text-xs font-bold truncate max-w-[180px] hover:opacity-70 transition-opacity"
          style={{ color: getUserColor(note.user_display_name ?? null) }}
        >
          {note.message}
        </p>
      ))}
    </button>
  );
};
