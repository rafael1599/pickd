import { useState } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Bell from 'lucide-react/dist/esm/icons/bell';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Info from 'lucide-react/dist/esm/icons/info';
import {
  useNotifications,
  clearNotifications,
  type NotificationKind,
} from '../../lib/notificationHistory';

interface NotificationHistoryModalProps {
  onClose: () => void;
}

function relativeTime(at: number): string {
  const diff = Date.now() - at;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

const KIND_META: Record<NotificationKind, { Icon: typeof Info; color: string; ring: string }> = {
  success: { Icon: CheckCircle2, color: 'text-emerald-500', ring: 'bg-emerald-500/10' },
  error: { Icon: AlertCircle, color: 'text-red-500', ring: 'bg-red-500/10' },
  info: { Icon: Info, color: 'text-sky-500', ring: 'bg-sky-500/10' },
};

export const NotificationHistoryModal = ({ onClose }: NotificationHistoryModalProps) => {
  const all = useNotifications();
  const [errorsOnly, setErrorsOnly] = useState(false);

  const entries = errorsOnly ? all.filter((e) => e.kind === 'error') : all;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-main/60 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-md max-h-[85vh] flex flex-col bg-surface border border-subtle rounded-[2.5rem] overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-card border border-subtle rounded-xl text-accent">
              <Bell size={18} />
            </div>
            <div>
              <h2 className="text-lg font-black uppercase tracking-tight text-content">
                Notifications
              </h2>
              <p className="text-[10px] text-muted font-bold uppercase tracking-widest">
                Recent alerts &amp; messages
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

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 pb-3">
          <button
            onClick={() => setErrorsOnly((v) => !v)}
            className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border transition-colors ${
              errorsOnly
                ? 'bg-red-500/10 border-red-500/30 text-red-500'
                : 'bg-card border-subtle text-muted hover:text-content'
            }`}
          >
            {errorsOnly ? 'Errors only' : 'All'}
          </button>
          <button
            onClick={clearNotifications}
            disabled={all.length === 0}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted hover:text-red-500 disabled:opacity-30 transition-colors"
          >
            <Trash2 size={13} />
            Clear
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 bg-card border border-subtle rounded-2xl text-muted mb-3">
                <Bell size={24} />
              </div>
              <p className="text-sm font-bold text-content">Nothing here yet</p>
              <p className="text-xs text-muted mt-1">
                {errorsOnly ? 'No errors recorded.' : 'Notifications will show up here.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => {
                const { Icon, color, ring } = KIND_META[e.kind];
                return (
                  <li
                    key={e.id}
                    className="flex items-start gap-3 p-3 bg-card border border-subtle rounded-2xl"
                  >
                    <div className={`p-1.5 rounded-lg shrink-0 ${ring} ${color}`}>
                      <Icon size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-content font-medium break-words">{e.message}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-0.5">
                        {relativeTime(e.at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
