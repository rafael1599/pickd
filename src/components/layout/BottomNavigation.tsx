import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Box from 'lucide-react/dist/esm/icons/box';
import Printer from 'lucide-react/dist/esm/icons/printer';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check';
import Map from 'lucide-react/dist/esm/icons/map';
import { useLocation, useNavigate } from 'react-router-dom';
import { useViewMode } from '../../context/ViewModeContext';
import { useDoubleCheckList } from '../../features/picking/hooks/useDoubleCheckList';
import { useOverlayOpen, useScrollLock } from '../../hooks/useScrollLock';
import { VerificationBoard } from '../../features/picking/components/VerificationBoard';

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  onClick: () => void;
  isCompact?: boolean;
  badge?: number;
  /** On a phone the bar holds three; a fourth is only for the desktop pill. */
  desktopOnly?: boolean;
}

const NavItem = ({
  icon: Icon,
  label,
  isActive,
  onClick,
  isCompact,
  badge,
  desktopOnly,
}: NavItemProps) => (
  <button
    onClick={onClick}
    aria-label={label}
    className={`${desktopOnly ? 'hidden md:flex' : 'flex'} flex-col md:flex-row items-center justify-center flex-1 md:flex-none h-full md:h-auto md:px-3.5 md:py-1.5 md:rounded-full transition-all duration-300 active:scale-95 md:gap-2 ${
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

export const BottomNavigation = () => {
  const { viewMode, isSearching, requestStockView } = useViewMode();
  const navigate = useNavigate();
  const location = useLocation();
  const { readyCount, correctionCount, waitingCount, refresh } = useDoubleCheckList();
  const [isBoardOpen, setIsBoardOpen] = useState(false);
  useScrollLock(isBoardOpen, () => setIsBoardOpen(false));
  // Any modal/sheet/menu over the view (anything holding a scroll lock) slides
  // the nav out of the way. CSS-hide, not unmount: the board renders from here.
  const isOverlayUp = useOverlayOpen();

  // Close board on route change or viewMode change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isBoardOpen) setIsBoardOpen(false);
  }, [location.pathname, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
          className={`fixed bottom-0 left-0 right-0 md:top-2.5 md:bottom-auto md:left-1/2 md:-translate-x-1/2 pointer-events-none flex justify-center md:w-auto md:h-auto z-[150] p-4 md:p-0 transition-all duration-300 print:hidden ${
            isSearching ? 'h-16 md:h-auto' : 'h-24 md:h-auto'
          }`}
        >
          <div
            className={`
            w-full max-w-sm md:w-auto md:h-11 ios-glass frost-grain rounded-[2rem] md:rounded-full flex items-center md:flex-row md:gap-1.5 justify-around h-full
            transition-all duration-300 ease-in-out md:border md:border-subtle/50 md:bg-card/90 md:backdrop-blur-xl md:shadow-xl
            ${
              isOverlayUp
                ? 'translate-y-[150%] md:translate-y-0 md:scale-95 opacity-0 pointer-events-none'
                : 'translate-y-0 opacity-100 pointer-events-auto'
            }
            ${isSearching ? 'px-2 md:px-2 md:py-1' : 'px-4 md:px-2 md:py-1'}
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
            {/* The map earns a place in the bar on a desktop (Rafael, 31 Aug
                2026); on a phone the three that fit stay, and it is still one
                tap away in the menu. */}
            <NavItem
              icon={Map}
              label="MAP"
              isActive={location.pathname === '/warehouse-map'}
              onClick={() => navigate('/warehouse-map')}
              isCompact={isSearching}
              desktopOnly
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
