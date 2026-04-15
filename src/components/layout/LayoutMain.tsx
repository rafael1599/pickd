import { ReactNode, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BottomNavigation } from './BottomNavigation';
import Settings from 'lucide-react/dist/esm/icons/settings';
import Menu from 'lucide-react/dist/esm/icons/menu';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';
import { ModalProvider } from '../../context/ModalContext';
import { UserMenu } from './UserMenu';
import { DoubleCheckHeader } from '../../features/picking/components/DoubleCheckHeader';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { PickingCartDrawer } from '../../features/picking/components/PickingCartDrawer';
import { PullToRefresh } from '../ui/PullToRefresh';

interface LayoutMainProps {
  children: ReactNode;
}

export const LayoutMain = ({ children }: LayoutMainProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isOrdersPage = location.pathname === '/orders';
  const isStockCountPage = location.pathname === '/stock-count';
  const { isAdmin } = useAuth();
  const { isSearching } = useViewMode();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const currentY = window.scrollY;
        if (currentY < 80) {
          setIsHeaderHidden(false);
        } else if (currentY < lastScrollY - 5) {
          // Scrolling up (5px threshold to avoid noise)
          setIsHeaderHidden(false);
        } else if (currentY > lastScrollY + 5) {
          // Scrolling down
          setIsHeaderHidden(true);
        }
        lastScrollY = currentY;
        ticking = false;
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const pbClass = isOrdersPage || isStockCountPage ? 'pb-0' : isSearching ? 'pb-12' : 'pb-20';

  return (
    <ModalProvider>
      <div
        className={`flex flex-col min-h-screen bg-main transition-all duration-700 ease-in-out relative overflow-x-hidden ${pbClass}`}
      >
        {/* Decorative Atmospheric Backdrop */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-accent/10 blur-[120px] animate-pulse transition-colors duration-1000" />
          <div
            className="absolute top-[20%] -right-[5%] w-[35%] h-[35%] rounded-full bg-accent-blue/5 blur-[100px] animate-pulse transition-colors duration-1000"
            style={{ animationDelay: '2s' }}
          />
          <div
            className="absolute -bottom-[10%] left-[20%] w-[50%] h-[50%] rounded-full bg-accent/5 blur-[150px] animate-pulse transition-colors duration-1000"
            style={{ animationDelay: '4s' }}
          />
        </div>

        {/* Header / Brand (Scrolls with the page) */}
        {!isOrdersPage && !isStockCountPage && (
          <>
            <header
              className={`
                    fixed top-0 left-0 right-0 bg-card border-b border-subtle z-50 transition-transform duration-200
                    ${isHeaderHidden || isSearching ? '-translate-y-full' : 'translate-y-0'}
                `}
            >
              <div className="flex justify-between items-center px-4 py-3">
                <div className="flex items-center gap-3">
                  {isAdmin && (
                    <button
                      onClick={() => navigate('/settings')}
                      className="w-10 h-10 ios-btn-surface text-muted hover:text-accent transition-colors"
                      aria-label="Settings"
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                  )}
                  <div
                    className="flex items-center gap-1.5 cursor-pointer group"
                    onClick={() => navigate('/')}
                  >
                    <h1
                      className="text-2xl font-extrabold tracking-tighter flex items-center gap-0.5"
                      style={{ fontFamily: 'var(--font-heading)' }}
                    >
                      <span className="text-accent">P</span>
                      <span className="text-content">ICK</span>
                      <span className="text-accent">D</span>
                    </h1>
                    <div className="w-8 h-8 relative group">
                      <div className="absolute inset-0 bg-accent/10 blur-lg rounded-full animate-pulse group-hover:bg-accent/20 transition-all opacity-0 group-hover:opacity-100" />
                      <img
                        src="/PickD.png"
                        alt="Logo"
                        className="w-full h-full relative z-10 object-contain animate-pickd-check"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <DoubleCheckHeader />

                  <SyncStatusIndicator />

                  <button
                    onClick={() => setIsUserMenuOpen(true)}
                    className="p-2 bg-surface border border-subtle rounded-xl hover:border-accent transition-all active:scale-95"
                  >
                    <Menu size={20} className="text-muted" />
                  </button>
                </div>
              </div>
            </header>
            {/* Spacer for fixed header */}
            <div className="h-[60px]" />
          </>
        )}

        <UserMenu
          isOpen={isUserMenuOpen}
          onClose={() => setIsUserMenuOpen(false)}
          navigate={navigate}
        />

        {/* Content */}
        <main className="flex-1 w-full relative flex flex-col">
          <PullToRefresh onRefresh={() => window.location.reload()}>{children}</PullToRefresh>
        </main>

        {!isOrdersPage && !isStockCountPage && <BottomNavigation />}
        <PickingCartDrawer />
      </div>
    </ModalProvider>
  );
};
