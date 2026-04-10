import SettingsIcon from 'lucide-react/dist/esm/icons/settings';
import { IntegratedMapManager } from '../warehouse-management/components/IntegratedMapManager';
import { useTheme } from '../../context/ThemeContext';

export default function Settings() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="min-h-screen bg-main p-3 sm:p-6 pb-20">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-8">
          <SettingsIcon className="text-accent flex-shrink-0" size={28} />
          <h1 className="text-2xl sm:text-3xl font-bold text-accent">Settings</h1>
        </div>

        {/* Preferences Section */}
        <div className="bg-card border border-subtle rounded-3xl p-6 mb-8 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-content uppercase tracking-tight">App Theme</h2>
              <p className="text-xs text-muted font-medium">
                Switch between light and dark visual modes
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
              </span>
              <button
                onClick={toggleTheme}
                className={`
                                    relative w-14 h-7 rounded-full p-1 transition-all duration-300 focus:outline-none ring-1 
                                    ${theme === 'dark' ? 'bg-accent/20 ring-accent/30' : 'bg-subtle ring-subtle/50'}
                                `}
              >
                <div
                  className={`
                                        w-5 h-5 bg-accent rounded-full shadow-lg transition-all duration-300 transform
                                        ${theme === 'dark' ? 'translate-x-7' : 'translate-x-0'}
                                    `}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Integrated Warehouse Management (Zones, Map, Reports) */}
        <IntegratedMapManager />
      </div>
    </div>
  );
}
