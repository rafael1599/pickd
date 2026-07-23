import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Box from 'lucide-react/dist/esm/icons/box';
import Printer from 'lucide-react/dist/esm/icons/printer';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check';
import { useLocation, useNavigate } from 'react-router-dom';
import { useViewMode } from '../../context/ViewModeContext';
import { useDoubleCheckList } from '../../features/picking/hooks/useDoubleCheckList';
import { useScrollLock } from '../../hooks/useScrollLock';
import { VerificationBoard } from '../../features/picking/components/VerificationBoard';

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  onClick: () => void;
  isCompact?: boolean;
  badge?: number;
}

const NavItem = ({ icon: Icon, label, isActive, onClick, isCompact, badge }: NavItemProps) => (
  <button
    onClick={onClick}
    aria-label={label}
    className={`flex flex-col md:flex-row items-center justify-center flex-1 md:flex-none h-full md:h-auto md:px-3.5 md:py-1.5 md:rounded-full transition-all duration-300 active:scale-95 md:gap-2 ${
      isActive
        ? 'text-accent md:bg-accent/15 md:border md:border-accent/30'
        : 'text-muted hover:text-content'
    } ${isCompact ? 'px-1' : ''}`}
  >
    <div
      className={`relative rounded-xl md:rounded-none transition-all duration-300 ${
        isActive ? 'bg-accent/10 md:bg-transparent shadow-lg md:shadow-none shadow-accent/5' : ''
      } ${isCompact ? 'p-1' : 'p-1.5 md:p-0'}`}
    >
      <Icon size={isCompact ? 18 : 20} strokeWidth={isActive ? 2.5 : 2} />
      {badge != null && badge > 0 && (
        <span className="absolute -top-2 -right-2.5 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-card animate-bounce">
          {badge}
        </span>
      )}
    </div>
    <span
      className={`text-[10px] md:text-xs font-extrabold uppercase tracking-wider mt-1 md:mt-0 transition-all duration-300 ${
        isActive
          ? 'opacity-100 translate-y-0'
          : 'opacity-60 md:opacity-75 translate-y-0.5 md:translate-y-0'
      }`}
      style={{ fontFamily: 'var(--font-heading)' }}
    >
      {label}
    </span>
  </button>
);

const NAV_AUTO_HIDE_DELAY_MS = 3000;

export const BottomNavigation = () => {
  const { viewMode, isNavHidden, isSearching, requestStockView } = useViewMode();
  const navigate = useNavigate();
  const location = useLocation();
  const { readyCount, correctionCount, waitingCount, refresh } = useDoubleCheckList();
  const [isBoardOpen, setIsBoardOpen] = useState(false);
  const [isAutoHidden, setIsAutoHidden] = useState(false);
  const isHoveredRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useScrollLock(isBoardOpen, () => setIsBoardOpen(false));

  // Close board on route change or viewMode change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isBoardOpen) setIsBoardOpen(false);
  }, [location.pathname, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    if (isHoveredRef.current) return;
    hideTimerRef.current = setTimeout(() => setIsAutoHidden(true), NAV_AUTO_HIDE_DELAY_MS);
  }, []);

  // Auto-hide after a few seconds without scrolling; only scrolling up brings it back.
  // Hovering the bar pauses the auto-hide entirely.
  useEffect(() => {
    let lastScrollY = window.scrollY;

    const handleScroll = () => {
      const currentY = window.scrollY;
      if (currentY < lastScrollY - 5) {
        setIsAutoHidden(false);
      }
      lastScrollY = currentY;
      scheduleHide();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    scheduleHide();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(hideTimerRef.current);
    };
  }, [scheduleHide]);

  const handleNavMouseEnter = () => {
    isHoveredRef.current = true;
    clearTimeout(hideTimerRef.current);
    setIsAutoHidden(false);
  };

  const handleNavMouseLeave = () => {
    isHoveredRef.current = false;
    scheduleHide();
  };

  if (isNavHidden) return null;

  const handleStockClick = () => {
    // Explicit signal (idea-129): also closes an open double-check drawer like
    // the X would, instead of leaving it floating over the stock view.
    requestStockView();
    if (location.pathname !== '/') navigate('/');
  };

  const totalActions = readyCount + correctionCount + waitingCount;

  return (
    <>
      {!isBoardOpen && (
        <div
          className={`fixed bottom-0 left-0 right-0 md:top-2.5 md:bottom-auto md:left-1/2 md:-translate-x-1/2 pointer-events-none flex justify-center md:w-auto md:h-auto z-[150] p-4 md:p-0 transition-all duration-300 ${
            isSearching ? 'h-16 md:h-auto' : 'h-24 md:h-auto'
          }`}
        >
          <div
            onMouseEnter={handleNavMouseEnter}
            onMouseLeave={handleNavMouseLeave}
            className={`
            w-full max-w-sm md:w-auto md:h-11 ios-glass frost-grain rounded-[2rem] md:rounded-full flex items-center md:flex-row md:gap-1.5 justify-around h-full
            transition-all duration-500 ease-in-out md:border md:border-subtle/50 md:bg-card/90 md:backdrop-blur-xl md:shadow-xl
            ${isSearching ? 'px-2 md:px-2 md:py-1' : 'px-4 md:px-2 md:py-1'}
            ${
              isAutoHidden
                ? 'translate-y-[150%] md:translate-y-0 md:-translate-y-16 opacity-0 pointer-events-none'
                : 'translate-y-0 opacity-100 pointer-events-auto'
            }
          `}
          >
            <NavItem
              icon={Box}
              label="STOCK"
              isActive={location.pathname === '/' && viewMode === 'stock'}
              onClick={handleStockClick}
              isCompact={isSearching}
            />
            <NavItem
              icon={Printer}
              label="SHIP"
              isActive={location.pathname === '/ship'}
              onClick={() => navigate('/ship')}
              isCompact={isSearching}
            />
            <NavItem
              icon={ClipboardCheck}
              label="BOARD"
              isActive={isBoardOpen}
              onClick={() => {
                const next = !isBoardOpen;
                setIsBoardOpen(next);
                if (next) refresh();
              }}
              isCompact={isSearching}
              badge={totalActions}
            />
          </div>
        </div>
      )}
      {isBoardOpen &&
        createPortal(<VerificationBoard onClose={() => setIsBoardOpen(false)} />, document.body)}
    </>
  );
};
