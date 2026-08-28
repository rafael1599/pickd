import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { ShipScreenFallback } from './components/layout/ShipScreenFallback.tsx';
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
const RegistrarContainerScreen = lazyWithRetry(() =>
  import('./features/registrar-container/RegistrarContainerScreen.tsx').then((m) => ({
    default: m.RegistrarContainerScreen,
  }))
);
const Settings = lazyWithRetry(() => import('./features/settings/Settings.tsx'));
const ExportScreen = lazyWithRetry(() =>
  import('./features/reports/ExportScreen.tsx').then((m) => ({ default: m.ExportScreen }))
);
const LoginScreen = lazyWithRetry(() =>
  import('./features/auth/LoginScreen.tsx').then((m) => ({ default: m.LoginScreen }))
);
const ShipScreen = lazyWithRetry(() =>
  import('./features/picking/ShipScreen.tsx').then((m) => ({ default: m.ShipScreen }))
);
const SnapshotViewer = lazyWithRetry(() =>
  import('./features/inventory/SnapshotViewer.tsx').then((m) => ({ default: m.SnapshotViewer }))
);
const WhatsNewViewer = lazyWithRetry(() =>
  import('./features/reports/WhatsNewViewer.tsx').then((m) => ({ default: m.WhatsNewViewer }))
);
const PickdReportViewer = lazyWithRetry(() =>
  import('./features/reports/PickdReportViewer.tsx').then((m) => ({ default: m.PickdReportViewer }))
);
const PublicTagView = lazyWithRetry(() =>
  import('./features/labels/PublicTagView.tsx').then((m) => ({ default: m.PublicTagView }))
);
const PublicOrderView = lazyWithRetry(() =>
  import('./features/orders/PublicOrderView.tsx').then((m) => ({ default: m.PublicOrderView }))
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
const ConsolidationScreen = lazyWithRetry(() =>
  import('./features/consolidation/ConsolidationScreen.tsx').then((m) => ({
    default: m.ConsolidationScreen,
  }))
);

const ManualsScreen = lazyWithRetry(() =>
  import('./features/manuals/ManualsScreen.tsx').then((m) => ({ default: m.ManualsScreen }))
);
const ManualDetailScreen = lazyWithRetry(() =>
  import('./features/manuals/ManualDetailScreen.tsx').then((m) => ({
    default: m.ManualDetailScreen,
  }))
);

const WarehouseMapScreen = lazyWithRetry(() =>
  import('./features/warehouse-map/WarehouseMapScreen.tsx').then((m) => ({
    default: m.WarehouseMapScreen,
  }))
);

import { ViewModeProvider } from './context/ViewModeContext.tsx';
import { PickingProvider } from './context/PickingContext.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { Suspense } from 'react';
import { StagingBanner } from './components/layout/StagingBanner.tsx';

// Backward-compat for already-printed labels whose QR still encodes the old
// bare /<orderNumber> URL (single order numbers only — a combined order's
// " / " broke this route entirely and fell through to Stock, which is the
// bug this whole redirect exists to stop happening again). New prints go
// straight to /order/:orderNumber (printOrderDetail.ts).
const OrderParamRedirect = () => {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  if (!orderNumber) return <Navigate to="/ship" replace />;
  const decoded = decodeURIComponent(orderNumber).trim();
  // Order numbers in Pickd contain digits (e.g. 880984, 0386a7a3, etc.).
  // Route typos (e.g., /shipp, /inventry, /settingss) contain NO digits
  // and must redirect to /ship instead of triggering a false 404.
  const looksLikeOrderNumber = /\d/.test(decoded);
  if (!looksLikeOrderNumber) {
    return <Navigate to="/ship" replace />;
  }
  return <Navigate to={`/order/${encodeURIComponent(decoded)}`} replace />;
};

// Content accessible only after login
const AuthenticatedContent = () => {
  const { isAdmin } = useAuth();
  const location = useLocation();
  const isShipRoute = location.pathname.startsWith('/ship');

  return (
    <ViewModeProvider>
      <LayoutMain>
        <ErrorBoundary>
          <Suspense
            fallback={
              isShipRoute ? (
                <ShipScreenFallback />
              ) : (
                <div className="min-h-[50vh] flex items-center justify-center">
                  <Loader2 className="animate-spin text-accent w-8 h-8 opacity-20" />
                </div>
              )
            }
          >
            <Routes>
              <Route path="/" element={<InventoryScreen />} />
              <Route path="/history" element={<HistoryScreen />} />
              <Route path="/orders" element={<Navigate to="/ship" replace />} />
              <Route path="/orders/*" element={<Navigate to="/ship" replace />} />
              <Route path="/order" element={<Navigate to="/ship" replace />} />
              <Route path="/ship" element={<ShipScreen />} />
              <Route
                path="/settings"
                element={isAdmin ? <Settings /> : <Navigate to="/" replace />}
              />
              <Route
                path="/export"
                element={isAdmin ? <ExportScreen /> : <Navigate to="/" replace />}
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
              <Route
                path="/consolidation"
                element={isAdmin ? <ConsolidationScreen /> : <Navigate to="/" replace />}
              />
              <Route
                path="/registrar-container"
                element={isAdmin ? <RegistrarContainerScreen /> : <Navigate to="/" replace />}
              />
              <Route path="/manuals" element={<ManualsScreen />} />
              <Route path="/manuals/:slug" element={<ManualDetailScreen />} />
              <Route path="/warehouse-map" element={<WarehouseMapScreen />} />
              <Route path="/:orderNumber" element={<OrderParamRedirect />} />
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
  const { error, clearError } = useError();
  const { confirmationState } = useConfirmation();
  const location = useLocation();
  const isShipRoute = location.pathname.startsWith('/ship');
  const isPublicWarehouseMap = location.pathname === '/public-warehouse-map';

  // Initialize presence tracking
  usePresence();

  if (loading && !isPublicWarehouseMap) {
    if (isShipRoute) {
      return <ShipScreenFallback />;
    }
    return (
      <div className="min-h-screen bg-main flex items-center justify-center">
        <Loader2 className="animate-spin text-accent w-10 h-10" />
      </div>
    );
  }

  if (!user && !isPublicWarehouseMap) {
    return (
      <ErrorBoundary>
        <Suspense
          fallback={
            isShipRoute ? (
              <ShipScreenFallback />
            ) : (
              <div className="min-h-screen bg-main flex items-center justify-center">
                <Loader2 className="animate-spin text-accent w-10 h-10 opacity-20" />
              </div>
            )
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

                {/* SKU-only tag page — the printed-label QR points here (/s/<sku>). */}
                <Route
                  path="/s/:sku"
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

                {/* Public order detail — the printed packing-slip QR (printOrderDetail.ts) points here. */}
                <Route
                  path="/order/:orderNumber"
                  element={
                    <ErrorBoundary>
                      <Suspense
                        fallback={
                          <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                            <Loader2 className="animate-spin text-gray-400 w-8 h-8" />
                          </div>
                        }
                      >
                        <PublicOrderView />
                      </Suspense>
                    </ErrorBoundary>
                  }
                />

                <Route
                  path="/whats-new"
                  element={
                    <ErrorBoundary>
                      <Suspense
                        fallback={
                          <div className="min-h-screen bg-[#f5f7fa] flex items-center justify-center">
                            <Loader2 className="animate-spin text-gray-400 w-8 h-8" />
                          </div>
                        }
                      >
                        <WhatsNewViewer />
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

                <Route
                  path="/public-warehouse-map"
                  element={
                    <ErrorBoundary>
                      <Suspense
                        fallback={
                          <div className="min-h-screen bg-white flex items-center justify-center">
                            <Loader2 className="animate-spin text-gray-400 w-8 h-8" />
                          </div>
                        }
                      >
                        <WarehouseMapScreen />
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
