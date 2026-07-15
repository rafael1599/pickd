/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, ReactNode } from 'react';
import { useErrorHandler } from '../hooks/useErrorHandler';

interface ErrorContextType {
  error: {
    isOpen: boolean;
    title: string;
    message: string;
    details?: string;
  };
  showError: (message: string, details?: string, title?: string) => void;
  clearError: () => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export const ErrorProvider = ({ children }: { children: ReactNode }) => {
  const { error, showError, clearError } = useErrorHandler();

  return (
    <ErrorContext.Provider value={{ error, showError, clearError }}>
      {children}
    </ErrorContext.Provider>
  );
};

export const useError = () => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useError must be used within an ErrorProvider');
  }
  return context;
};
