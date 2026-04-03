import { createContext, useContext, useState, useMemo, ReactNode } from 'react';

type ViewMode = 'stock' | 'picking' | 'double_checking';

interface ViewModeContextType {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  externalDoubleCheckId: string | number | null;
  setExternalDoubleCheckId: (id: string | number | null) => void;
  externalOrderId: string | number | null;
  setExternalOrderId: (id: string | number | null) => void;
  externalShowPickingSummary: boolean;
  setExternalShowPickingSummary: (show: boolean) => void;
  isNavHidden: boolean;
  setIsNavHidden: (hidden: boolean) => void;
  isSearching: boolean;
  setIsSearching: (searching: boolean) => void;
}

const ViewModeContext = createContext<ViewModeContextType | undefined>(undefined);

export const ViewModeProvider = ({ children }: { children: ReactNode }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('stock');
  const [externalDoubleCheckId, setExternalDoubleCheckId] = useState<string | number | null>(null);
  const [externalOrderId, setExternalOrderId] = useState<string | number | null>(null);
  const [externalShowPickingSummary, setExternalShowPickingSummary] = useState(false);
  const [isNavHidden, setIsNavHidden] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const value = useMemo(() => ({
    viewMode,
    setViewMode,
    externalDoubleCheckId,
    setExternalDoubleCheckId,
    externalOrderId,
    setExternalOrderId,
    externalShowPickingSummary,
    setExternalShowPickingSummary,
    isNavHidden,
    setIsNavHidden,
    isSearching,
    setIsSearching,
  }), [viewMode, externalDoubleCheckId, externalOrderId, externalShowPickingSummary, isNavHidden, isSearching]);

  return (
    <ViewModeContext.Provider value={value}>
      {children}
    </ViewModeContext.Provider>
  );
};

export const useViewMode = () => {
  const context = useContext(ViewModeContext);
  if (!context) {
    throw new Error('useViewMode must be used within a ViewModeProvider');
  }
  return context;
};
