import { useState } from 'react';
import { useWarehouseZones } from '../../inventory/hooks/useWarehouseZones';
import { useOptimizationReports } from '../../inventory/hooks/useOptimizationReports';
import { OptimizationReportCard } from './OptimizationReportCard';
import { LocationList } from './LocationList';
import { UserManagement } from './UserManagement';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import Users from 'lucide-react/dist/esm/icons/users';
import { useAuth } from '../../../context/AuthContext';

type TabType = 'locations' | 'reports' | 'users';

export const IntegratedMapManager = () => {
  const { isAdmin } = useAuth();
  const { loading: zonesLoading } = useWarehouseZones();
  const { latestReport, generateReport } = useOptimizationReports();

  const [activeTab, setActiveTab] = useState<TabType>('locations');

  if (zonesLoading) {
    return (
      <div className="p-12 text-center text-muted animate-pulse">Loading Warehouse Data...</div>
    );
  }

  return (
    <div className="bg-card border border-subtle rounded-3xl overflow-hidden backdrop-blur-sm">
      {/* Header Tabs */}
      <div className="flex border-b border-subtle bg-main/20 overflow-x-auto no-scrollbar">
        <TabButton
          active={activeTab === 'locations'}
          onClick={() => setActiveTab('locations')}
          icon={MapPin}
          label="Edit Locations"
        />
        <TabButton
          active={activeTab === 'reports'}
          onClick={() => setActiveTab('reports')}
          icon={BarChart3}
          label="Reports"
        />
        {isAdmin && (
          <TabButton
            active={activeTab === 'users'}
            onClick={() => setActiveTab('users')}
            icon={Users}
            label="Users"
          />
        )}
      </div>

      {/* Content Area */}
      <div className="p-4 sm:p-6">
        {activeTab === 'locations' && <LocationList />}

        {activeTab === 'reports' && (
          <div className="max-w-4xl mx-auto">
            <OptimizationReportCard report={latestReport} onGenerateNew={generateReport} />
          </div>
        )}

        {activeTab === 'users' && isAdmin && <UserManagement />}
      </div>
    </div>
  );
};

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  badge?: string | number;
}

const TabButton = ({ active, onClick, icon: Icon, label, badge }: TabButtonProps) => (
  <button
    onClick={onClick}
    className={`
            flex-1 py-4 px-2 flex flex-col items-center justify-center gap-1.5
            font-black uppercase tracking-[0.15em] text-[10px] transition-all duration-300 relative
            ${active ? 'text-accent' : 'text-muted hover:text-content'}
        `}
  >
    <div
      className={`p-2 rounded-xl transition-all duration-300 ${active ? 'bg-accent/10 shadow-sm' : ''}`}
    >
      <Icon size={18} className={active ? 'text-accent' : 'opacity-40'} />
    </div>
    <span className="hidden sm:inline">{label}</span>
    {badge && (
      <span className="absolute top-3 right-4 text-orange-400 text-lg animate-pulse">{badge}</span>
    )}
    {active && (
      <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-accent rounded-full" />
    )}
  </button>
);
