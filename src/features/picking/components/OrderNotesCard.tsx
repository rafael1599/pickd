import React from 'react';
import { usePickingNotes } from '../hooks/usePickingNotes';
import { getUserColor } from '../../../utils/userUtils';

interface OrderNotesCardProps {
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
 * Full in-app note history for the selected order — no cap, every note the
 * team left. Author names are colored via `getUserColor`, the same
 * consistent per-user palette used in HistoryScreen. Renders nothing when
 * there are no notes.
 */
export const OrderNotesCard: React.FC<OrderNotesCardProps> = ({ listId }) => {
  const { notes } = usePickingNotes(listId);

  if (notes.length === 0) return null;

  return (
    <div className="w-full max-w-md bg-surface rounded-2xl border border-subtle overflow-hidden">
      <div className="px-4 py-3 border-b border-subtle">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">
          Notes ({notes.length})
        </h3>
      </div>
      <div className="divide-y divide-subtle">
        {notes.map((note) => (
          <div key={note.id} className="px-4 py-3 text-xs text-content/90">
            <span
              className="font-bold"
              style={{ color: getUserColor(note.user_display_name ?? null) }}
            >
              {note.user_display_name || 'Unknown'}
            </span>
            <span className="text-muted"> · {formatNoteTime(note.created_at)}</span>
            <p className="mt-0.5 whitespace-pre-wrap">{note.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
