import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Send from 'lucide-react/dist/esm/icons/send';
import toast from 'react-hot-toast';
import { usePickingNotes } from '../hooks/usePickingNotes';
import { useAuth } from '../../../context/AuthContext';
import { getUserColor } from '../../../utils/userUtils';

interface OrderNotesModalProps {
  listId: string | string[];
  autoFocusComposer?: boolean;
  /** The AS400/watcher import note — rendered as the earliest entry in the
   *  history, ahead of every user note, labeled distinctly since it has no
   *  author. */
  watcherNote?: string | null;
  onClose: () => void;
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
 * Full note-history drill-down for an order — every note, author-colored
 * (getUserColor, same palette as HistoryScreen), with time + name, plus a
 * composer to add a new one. Opened via the Modal Manager (`type: 'order-notes'`)
 * so it survives the opener (the compact inline preview) unmounting.
 */
export const OrderNotesModal: React.FC<OrderNotesModalProps> = ({
  listId,
  autoFocusComposer,
  watcherNote,
  onClose,
}) => {
  const { notes, isLoading, addNote } = usePickingNotes(listId);
  const totalCount = notes.length + (watcherNote ? 1 : 0);
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocusComposer) textareaRef.current?.focus();
  }, [autoFocusComposer]);

  const handleSend = async () => {
    if (!message.trim() || !user) return;
    setIsSending(true);
    try {
      await addNote(user.id, message);
      setMessage('');
    } catch (err) {
      console.error('Failed to add note:', err);
      toast.error('Failed to add note');
    } finally {
      setIsSending(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-main/60 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-md max-h-[85vh] flex flex-col bg-surface border border-subtle rounded-[2.5rem] overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-6 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-card border border-subtle rounded-xl text-accent">
              <MessageSquare size={18} />
            </div>
            <div>
              <h2 className="text-lg font-black uppercase tracking-tight text-content">Notes</h2>
              <p className="text-[10px] text-muted font-bold uppercase tracking-widest">
                {totalCount} {totalCount === 1 ? 'note' : 'notes'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-card rounded-full text-muted transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          {isLoading && totalCount === 0 ? (
            <div className="flex items-center justify-center py-16 opacity-50">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-accent border-t-transparent" />
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 bg-card border border-subtle rounded-2xl text-muted mb-3">
                <MessageSquare size={24} />
              </div>
              <p className="text-sm font-bold text-content">No notes yet</p>
              <p className="text-xs text-muted mt-1">Add the first one below.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {watcherNote && (
                <li className="p-3 bg-red-500/5 border border-red-500/20 rounded-2xl">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] font-black uppercase tracking-widest truncate text-red-400">
                      System (AS400)
                    </span>
                  </div>
                  <p className="text-sm text-content whitespace-pre-wrap break-words">
                    {watcherNote}
                  </p>
                </li>
              )}
              {notes.map((note) => (
                <li key={note.id} className="p-3 bg-card border border-subtle rounded-2xl">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="text-[10px] font-black uppercase tracking-widest truncate"
                      style={{ color: getUserColor(note.user_display_name ?? null) }}
                    >
                      {note.user_display_name || 'Unknown'}
                    </span>
                    <span className="text-[9px] text-muted font-bold uppercase tracking-widest shrink-0">
                      {formatNoteTime(note.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-content whitespace-pre-wrap break-words">
                    {note.message}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0 p-4 border-t border-subtle flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Add a note…"
            rows={1}
            className="flex-1 resize-none bg-card border border-subtle rounded-2xl px-3.5 py-2.5 text-sm text-content placeholder:text-muted focus:outline-none focus:border-accent/50 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || isSending}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-accent text-white disabled:opacity-30 disabled:cursor-not-allowed active:scale-90 transition-all"
            title="Send note"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
