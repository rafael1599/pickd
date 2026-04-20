import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { InventoryProvider } from './features/inventory/hooks/InventoryProvider.tsx';
import { LayoutMain } from './components/layout/LayoutMain.tsx';
import { ErrorProvider, useError } from './context/ErrorContext.tsx'; // Import ErrorProvider and useError
import { ConfirmationProvider, useConfirmation } from './context/ConfirmationContext.tsx'; // Import ConfirmationProvider and useConfirmation
import { ErrorModal } from './components/ui/ErrorModal.tsx'; // Import ErrorModal
import { ConfirmationModal } from './components/ui/ConfirmationModal.tsx'; // Import ConfirmationModal
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { lazyWithRetry } from './utils/lazyWithRetry.ts';
const InventoryScreen = lazyWithRetry(() =>
  import('./features/inventory/InventoryScreen.tsx').then((m) => ({ default: m.InventoryScreen }))
);
const HistoryScreen = lazyWithRetry(() =>
  import('./features/inventory/HistoryScreen.tsx').then((m) => ({ default: m.HistoryScreen }))
);
const Settings = lazyWithRetry(() => import('./features/settings/Settings.tsx'));
const LoginScreen = lazyWithRetry(() =>
  import('./features/auth/LoginScreen.tsx').then((m) => ({ default: m.LoginScreen }))
);
const OrdersScreen = lazyWithRetry(() =>
  import('./features/picking/OrdersScreen.tsx').then((m) => ({ default: m.OrdersScreen }))
);
const SnapshotViewer = lazyWithRetry(() =>
  import('./features/inventory/SnapshotViewer.tsx').then((m) => ({ default: m.SnapshotViewer }))
);
const PickdReportViewer = lazyWithRetry(() =>
  import('./features/reports/PickdReportViewer.tsx').then((m) => ({ default: m.PickdReportViewer }))
);
const PublicTagView = lazyWithRetry(() =>
  import('./features/labels/PublicTagView.tsx').then((m) => ({ default: m.PublicTagView }))
);
const StockCountScreen = lazyWithRetry(() =>
  import('./features/inventory/StockCountScreen.tsx').then((m) => ({ default: m.StockCountScreen }))
);
const CycleCountHistoryScreen = lazyWithRetry(() =>
  import('./features/inventory/CycleCountHistoryScreen.tsx').then((m) => ({
    default: m.CycleCountHistoryScreen,
  }))
);
const ActivityReportScreen = lazyWithRetry(() =>
  import('./features/reports/ActivityReportScreen.tsx').then((m) => ({
    default: m.ActivityReportScreen,
  }))
);
const ProjectsScreen = lazyWithRetry(() =>
  import('./features/projects/ProjectsScreen.tsx').then((m) => ({ default: m.ProjectsScreen }))
);
const LabelStudioScreen = lazyWithRetry(() =>
  import('./features/labels/LabelStudioScreen').then((m) => ({ default: m.LabelStudioScreen }))
);
const ShoppingListScreen = lazyWithRetry(() =>
  import('./features/shopping-list/ShoppingListScreen.tsx').then((m) => ({
    default: m.ShoppingListScreen,
  }))
);
const FedExReturnsScreen = lazyWithRetry(() =>
  import('./features/fedex-returns/FedExReturnsScreen.tsx').then((m) => ({
    default: m.FedExReturnsScreen,
  }))
);
const FedExReturnDetailScreen = lazyWithRetry(() =>
  import('./features/fedex-returns/FedExReturnDetailScreen.tsx').then((m) => ({
    default: m.FedExReturnDetailScreen,
  }))
);

import { ViewModeProvider } from './context/ViewModeContext.tsx';
import { PickingProvider } from './context/PickingContext.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { Suspense } from 'react';
import { StagingBanner } from './components/layout/StagingBanner.tsx';

// Content accessible only after login
const AuthenticatedContent = () => {
  const { isAdmin } = useAuth();

  return (
    <ViewModeProvider>
      <LayoutMain>
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="min-h-[50vh] flex items-center justify-center">
                <Loader2 className="animate-spin text-accent w-8 h-8 opacity-20" />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<InventoryScreen />} />
              <Route path="/history" element={<HistoryScreen />} />
              <Route path="/orders" element={<OrdersScreen />} />
              <Route
                path="/settings"
                element={isAdmin ? <Settings /> : <Navigate to="/" replace />}
              />
              <Route path="/stock-count" element={<StockCountScreen />} />
              <Route path="/shopping-list" element={<ShoppingListScreen />} />
              <Route path="/fedex-returns" element={<FedExReturnsScreen />} />
              <Route path="/fedex-returns/:id" element={<FedExReturnDetailScreen />} />
              <Route path="/cycle-count-history" element={<CycleCountHistoryScreen />} />
              <Route
                path="/activity-report"
                element={isAdmin ? <ActivityReportScreen /> : <Navigate to="/" replace />}
              />
              <Route
                path="/projects"
                element={isAdmin ? <ProjectsScreen /> : <Navigate to="/" replace />}
              />
              <Route
                path="/labels"
                element={isAdmin ? <LabelStudioScreen /> : <Navigate to="/" replace />}
              />
              {/* Catch-all for unknown routes */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </LayoutMain>
    </ViewModeProvider>
  );
};

// Handles session state and loader
import { usePresence } from './hooks/usePresence.ts';

const AuthGuard = () => {
  const { user, loading } = useAuth();
  const { error, clearError } = useError(); // Use the error context
  const { confirmationState } = useConfirmation(); // Use the confirmation context state

  // Initialize presence tracking
  usePresence();

  if (loading) {
    return (
      <div className="min-h-screen bg-main flex items-center justify-center">
        <Loader2 className="animate-spin text-accent w-10 h-10" />
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="min-h-screen bg-main flex items-center justify-center">
              <Loader2 className="animate-spin text-accent w-10 h-10 opa-20" />
            </div>
          }
        >
          <LoginScreen />
        </Suspense>
      </ErrorBoundary>
    );
  }

  // Only load data if user is authenticated
  return (
    <>
      <InventoryProvider>
        <PickingProvider>
          <AuthenticatedContent />
        </PickingProvider>
      </InventoryProvider>
      <ErrorModal
        isOpen={error.isOpen}
        title={error.title}
        message={error.message}
        details={error.details}
        onClose={clearError}
      />
      {confirmationState.isOpen && (
        <ConfirmationModal
          isOpen={confirmationState.isOpen}
          title={confirmationState.title}
          message={confirmationState.message}
          onConfirm={confirmationState.onConfirm}
          onClose={confirmationState.onClose}
          confirmText={confirmationState.confirmText}
          cancelText={confirmationState.cancelText}
          variant={confirmationState.variant}
        />
      )}
    </>
  );
};

import { cleanupCorruptedMutations } from './lib/query-client.ts';

function App() {
  React.useEffect(() => {
    // Self-healing: Remove stuck mutations on app boot
    cleanupCorruptedMutations();
  }, []);

  return (
    <ThemeProvider>
      <StagingBanner />
      <AuthProvider>
        <BrowserRouter>
          <ErrorProvider>
            <ConfirmationProvider>
              <Routes>
                {/* Public routes - No Layout, No Auth */}
                <Route
                  path="/snapshot/:fileName"
                  element={
                    <ErrorBoundary>
                      <Suspense
                        fallback={
                          <div className="min-h-screen bg-main flex items-center justify-center">
                            <Loader2 className="animate-spin text-accent w-10 h-10" />
                          </div>
                        }
                      >
                        <SnapshotViewer />
                      </Suspense>
                    </ErrorBoundary>
                  }
                />
                <Route
                  path="/tag/:shortCode/:token"
                  element={
                    <ErrorBoundary>
                      <Suspense
                        fallback={
                          <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                            <Loader2 className="animate-spin text-gray-400 w-8 h-8" />
                          </div>
                        }
                      >
                        <PublicTagView />
                      </Suspense>
                    </ErrorBoundary>
                  }
                />

                <Route
                  path="/pickd-report"
                  element={
                    <ErrorBoundary>
                      <Suspense
                        fallback={
                          <div className="min-h-screen bg-[#f5f7fa] flex items-center justify-center">
                            <Loader2 className="animate-spin text-gray-400 w-8 h-8" />
                          </div>
                        }
                      >
                        <PickdReportViewer />
                      </Suspense>
                    </ErrorBoundary>
                  }
                />

                {/* All other routes protected by AuthGuard */}
                <Route path="*" element={<AuthGuard />} />
              </Routes>
            </ConfirmationProvider>
          </ErrorProvider>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
