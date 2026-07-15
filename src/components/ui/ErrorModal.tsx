import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import { ModalOverlay } from './ModalOverlay';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  details?: string;
}

/**
 * Modal for displaying validation and system errors
 * Shows user-friendly message + technical details in console
 */
export function ErrorModal({
  isOpen,
  onClose,
  title = 'Error',
  message,
  details,
}: ErrorModalProps) {
  if (!isOpen) return null;

  // Log technical details to console
  if (details) {
    console.error('🔴 Error Details:', details);
  }

  return (
    <ModalOverlay onClose={onClose} maxWidth="md" zIndex={999} cardBg="bg-surface" className="p-6">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-primary mb-2">{title}</h3>
          <p className="text-secondary text-sm">{message}</p>
          {details && (
            <p className="text-tertiary text-xs mt-2">
              Technical details have been logged to the console.
            </p>
          )}
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
        >
          Close
        </button>
      </div>
    </ModalOverlay>
  );
}
