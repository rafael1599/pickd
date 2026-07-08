import React from 'react';
import { usePickingNotes } from '../../picking/hooks/usePickingNotes';

interface OrderNotesProps {
  listId: string;
}

/** `Jul 8 · 12:48 PM` short timestamp for a note. */
function formatNoteTime(source: string): string {
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * Renders the in-app picking notes for an order. Mounted ONLY while the parent
 * card is expanded so `usePickingNotes` (which opens a realtime channel) runs
 * for the open card, not every card in the list. Renders nothing when empty.
 */
export const OrderNotes: React.FC<OrderNotesProps> = ({ listId }) => {
  const { notes } = usePickingNotes(listId);

  if (notes.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-muted/50 mb-1">Notes</p>
      <div className="space-y-1.5">
        {notes.map((note) => (
          <div key={note.id} className="text-xs text-content/90">
            <span className="font-bold text-content">{note.user_display_name || 'Unknown'}</span>
            <span className="text-muted"> · {formatNoteTime(note.created_at)} — </span>
            <span className="whitespace-pre-wrap">{note.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
