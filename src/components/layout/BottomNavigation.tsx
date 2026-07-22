import Box from 'lucide-react/dist/esm/icons/box';
import Printer from 'lucide-react/dist/esm/icons/printer';
import { useLocation, useNavigate } from 'react-router-dom';
import { useViewMode } from '../../context/ViewModeContext';

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  onClick: () => void;
  isCompact?: boolean;
}

const NavItem = ({ icon: Icon, label, isActive, onClick, isCompact }: NavItemProps) => (
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
      className={`rounded-xl md:rounded-none transition-all duration-300 ${
        isActive ? 'bg-accent/10 md:bg-transparent shadow-lg md:shadow-none shadow-accent/5' : ''
      } ${isCompact ? 'p-1' : 'p-1.5 md:p-0'}`}
    >
      <Icon size={isCompact ? 18 : 20} strokeWidth={isActive ? 2.5 : 2} />
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
  const { viewMode, isNavHidden, isSearching, requestStockView } = useViewMode();
  const navigate = useNavigate();
  const location = useLocation();

  if (isNavHidden) return null;

  const handleStockClick = () => {
    // Explicit signal (idea-129): also closes an open double-check drawer like
    // the X would, instead of leaving it floating over the stock view.
    requestStockView();
    if (location.pathname !== '/') navigate('/');
  };

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 md:top-2.5 md:bottom-auto md:left-1/2 md:-translate-x-1/2 pointer-events-none flex justify-center md:w-auto md:h-auto z-[150] p-4 md:p-0 transition-all duration-300 ${
        isSearching ? 'h-16 md:h-auto' : 'h-24 md:h-auto'
      }`}
    >
      <div
        className={`
        w-full max-w-sm md:w-auto md:h-11 pointer-events-auto ios-glass frost-grain rounded-[2rem] md:rounded-full flex items-center md:flex-row md:gap-1.5 justify-around h-full
        transition-all duration-500 ease-in-out md:border md:border-subtle/50 md:bg-card/90 md:backdrop-blur-xl md:shadow-xl
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
      </div>
    </div>
  );
};
