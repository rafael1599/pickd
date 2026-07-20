import Expand from 'lucide-react/dist/esm/icons/expand';
import Plus from 'lucide-react/dist/esm/icons/plus';
import { usePickingNotes } from '../hooks/usePickingNotes';
import { useModal } from '../../../context/ModalContext';
import { getUserColor } from '../../../utils/userUtils';

interface OrderNotesInlineProps {
  listId: string;
}

/**
 * Compact preview for the order header — last 2 notes as author-colored text
 * (no name, no timestamp; that detail lives in the drill-down modal). The
 * expand button is always present as the persistent entry point into the
 * full note history + composer (`OrderNotesModal`, via the Modal Manager).
 */
export const OrderNotesInline: React.FC<OrderNotesInlineProps> = ({ listId }) => {
  const { notes } = usePickingNotes(listId);
  const { open } = useModal();

  const preview = notes.slice(-2);

  return (
    <div className="flex items-end gap-1.5">
      {preview.length > 0 && (
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
      )}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => open({ type: 'order-notes', listId })}
          title="View all notes"
          className="w-5 h-5 flex items-center justify-center rounded-full text-muted hover:text-accent hover:bg-accent/10 transition-colors"
        >
          <Expand size={11} />
        </button>
        <button
          onClick={() => open({ type: 'order-notes', listId, autoFocusComposer: true })}
          title="Add note"
          className="w-5 h-5 flex items-center justify-center rounded-full text-muted hover:text-accent hover:bg-accent/10 transition-colors"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
};
