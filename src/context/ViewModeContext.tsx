import { createContext, useContext, useState, useMemo, useCallback, ReactNode } from 'react';

type ViewMode = 'stock' | 'picking' | 'double_checking';

interface ViewModeContextType {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  externalDoubleCheckId: string | number | null;
  setExternalDoubleCheckId: (id: string | number | null) => void;
  externalOrderId: string | number | null;
  setExternalOrderId: (id: string | number | null) => void;
  isNavHidden: boolean;
  setIsNavHidden: (hidden: boolean) => void;
  isSearching: boolean;
  setIsSearching: (searching: boolean) => void;
  /** Monotonic counter bumped by the bottom-nav STOCK button (idea-129).
   *  An EXPLICIT user request to see stock must close the double-check drawer
   *  like the X would — even when the order was opened externally (Verification
   *  Board), where the drawer otherwise keeps itself alive across view changes. */
  stockNavSignal: number;
  requestStockView: () => void;
}

const ViewModeContext = createContext<ViewModeContextType | undefined>(undefined);

export const ViewModeProvider = ({ children }: { children: ReactNode }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('stock');
  const [externalDoubleCheckId, setExternalDoubleCheckId] = useState<string | number | null>(null);
  const [externalOrderId, setExternalOrderId] = useState<string | number | null>(null);
  const [isNavHidden, setIsNavHidden] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [stockNavSignal, setStockNavSignal] = useState(0);

  const requestStockView = useCallback(() => {
    setViewMode('stock');
    setStockNavSignal((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({
      viewMode,
      setViewMode,
      externalDoubleCheckId,
      setExternalDoubleCheckId,
      externalOrderId,
      setExternalOrderId,
      isNavHidden,
      setIsNavHidden,
      isSearching,
      setIsSearching,
      stockNavSignal,
      requestStockView,
    }),
    [
      viewMode,
      externalDoubleCheckId,
      externalOrderId,
      isNavHidden,
      isSearching,
      stockNavSignal,
      requestStockView,
    ]
  );

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
};

export const useViewMode = () => {
  const context = useContext(ViewModeContext);
  if (!context) {
    throw new Error('useViewMode must be used within a ViewModeProvider');
  }
  return context;
};
