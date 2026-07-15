/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ConfirmationState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onClose: () => void;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

interface ConfirmationContextType {
  confirmationState: ConfirmationState;
  showConfirmation: (
    title: string,
    message: string,
    onConfirm: () => void,
    onClose?: () => void,
    confirmText?: string,
    cancelText?: string,
    variant?: 'danger' | 'warning' | 'info'
  ) => void;
  hideConfirmation: () => void;
}

const ConfirmationContext = createContext<ConfirmationContextType | undefined>(undefined);

export const ConfirmationProvider = ({ children }: { children: ReactNode }) => {
  const [confirmationState, setConfirmationState] = useState<ConfirmationState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onClose: () => {},
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'danger',
  });

  const showConfirmation = useCallback(
    (
      title: string,
      message: string,
      onConfirm: () => void,
      onClose?: () => void,
      confirmText?: string,
      cancelText?: string,
      variant?: 'danger' | 'warning' | 'info'
    ) => {
      setConfirmationState({
        isOpen: true,
        title,
        message,
        onConfirm: () => {
          onConfirm();
          setConfirmationState((prev) => ({ ...prev, isOpen: false }));
        },
        onClose: () => {
          onClose?.();
          setConfirmationState((prev) => ({ ...prev, isOpen: false }));
        },
        confirmText,
        cancelText,
        variant: variant || 'danger',
      });
    },
    []
  );

  const hideConfirmation = useCallback(() => {
    setConfirmationState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return (
    <ConfirmationContext.Provider value={{ confirmationState, showConfirmation, hideConfirmation }}>
      {children}
    </ConfirmationContext.Provider>
  );
};

export const useConfirmation = () => {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error('useConfirmation must be used within a ConfirmationProvider');
  }
  return context;
};
