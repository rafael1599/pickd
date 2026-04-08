import { createPortal } from 'react-dom';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import { useScrollLock } from '../../hooks/useScrollLock';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
}: ConfirmationModalProps) {
  useScrollLock(isOpen, onClose);
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-subtle rounded-xl max-w-sm w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                variant === 'danger'
                  ? 'bg-red-500/20'
                  : variant === 'warning'
                    ? 'bg-amber-500/20'
                    : 'bg-blue-500/20'
              }`}
            >
              <AlertTriangle
                className={`w-5 h-5 ${
                  variant === 'danger'
                    ? 'text-red-500'
                    : variant === 'warning'
                      ? 'text-amber-500'
                      : 'text-blue-500'
                }`}
              />
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-content mb-2">{title}</h3>
            <p className="text-muted text-sm">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface text-muted rounded-lg hover:bg-subtle transition-colors font-semibold"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-white rounded-lg transition-colors font-semibold ${
              variant === 'danger'
                ? 'bg-red-500 hover:bg-red-600'
                : variant === 'warning'
                  ? 'bg-amber-500 hover:bg-amber-600 text-main'
                  : 'bg-blue-500 hover:bg-blue-600'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
