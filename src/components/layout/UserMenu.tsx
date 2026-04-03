import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createPortal } from 'react-dom';
import { useTheme } from '../../context/ThemeContext';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import X from 'lucide-react/dist/esm/icons/x';
import Check from 'lucide-react/dist/esm/icons/check';
import Sun from 'lucide-react/dist/esm/icons/sun';
import Moon from 'lucide-react/dist/esm/icons/moon';
import Save from 'lucide-react/dist/esm/icons/save';
import Eye from 'lucide-react/dist/esm/icons/eye';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';
import History from 'lucide-react/dist/esm/icons/history';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list';
import FileSearch from 'lucide-react/dist/esm/icons/file-search';
import { InventorySnapshotModal } from '../../features/inventory/components/InventorySnapshotModal';
import { useScrollLock } from '../../hooks/useScrollLock';

interface UserMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onExport?: () => void;
  navigate: (path: string) => void;
}

export const UserMenu = ({ isOpen, onClose, onExport, navigate }: UserMenuProps) => {
  const {
    profile,
    signOut,
    updateProfileName,
    isAdmin,
    isSystemAdmin,
    viewAsUser,
    toggleAdminView,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [newName, setNewName] = useState(profile?.full_name || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);
  useScrollLock(isOpen, onClose);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!newName.trim()) return;
    setIsSaving(true);
    const { success } = await updateProfileName(newName);
    if (success) {
      setIsEditing(false);
    }
    setIsSaving(false);
  };

  const handleSyncRepair = async () => {
    if (window.confirm('Are you sure? This will remove all pending offline actions.')) {
      console.log('🟡 PROCEEDING WITH SYNC REPAIR...');
      const dbs = ['query-cache', 'REACT_QUERY_OFFLINE_CACHE'];
      dbs.forEach((dbName) => {
        try {
          indexedDB.deleteDatabase(dbName);
          console.log(`🗑️ Database Deleted: ${dbName}`);
        } catch (e) {
          console.error(`Failed to delete ${dbName}`, e);
        }
      });
      localStorage.removeItem('tanstack-query-persist-client-v5');
      window.location.reload();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-main/60 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-surface border border-subtle rounded-[2.5rem] overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight text-content">
                User Account
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[10px] text-muted font-bold uppercase tracking-widest leading-none">
                  {profile?.full_name || 'Personalize Profile'}
                </p>
                <span className="text-muted/30">•</span>
                <button
                  onClick={handleSyncRepair}
                  className="text-[9px] text-yellow-500 hover:text-yellow-600 font-black uppercase tracking-widest transition-colors flex items-center gap-1"
                >
                  <RefreshCw size={10} />
                  Sync Repair
                </button>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface rounded-full text-muted transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="space-y-6">
            {/* Visual Preferences Section */}
            <div className="p-4 bg-surface rounded-2xl border border-subtle">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-4 block">
                Visual Preferences
              </label>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-card border border-subtle rounded-xl text-content">
                    {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">
                      Smooth UI Appearance
                    </p>
                  </div>
                </div>
                <button
                  onClick={toggleTheme}
                  className={`
                    relative w-14 h-7 rounded-full p-1 transition-all duration-300 focus:outline-none ring-1 
                    ${theme === 'dark' ? 'bg-accent/20 ring-accent/30' : 'bg-subtle ring-subtle/50'}
                  `}
                  aria-label="Toggle Theme"
                >
                  <div
                    className={`
                      w-5 h-5 bg-accent rounded-full shadow-lg transition-all duration-300 transform
                      ${theme === 'dark' ? 'translate-x-7 rotate-0' : 'translate-x-0 rotate-180'}
                    `}
                  />
                </button>
              </div>
            </div>

            {/* Name Section */}
            <div className="p-4 bg-surface rounded-2xl border border-subtle">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-3 block">
                Full Name
              </label>

              {isEditing ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="flex-1 bg-card border border-subtle rounded-xl px-4 py-2 text-sm text-content focus:outline-none focus:border-accent/50"
                  />
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="ios-btn items-center justify-center h-10 w-12 bg-accent text-white shadow-lg active:scale-90 disabled:opacity-50 transition-all"
                  >
                    {isSaving ? (
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white animate-spin rounded-full" />
                    ) : (
                      <Check size={20} />
                    )}
                  </button>
                </div>
              ) : (
                <div
                  className="flex justify-between items-center group cursor-pointer"
                  onClick={() => setIsEditing(true)}
                >
                  <span className="text-lg font-bold text-content tracking-tight">
                    {profile?.full_name || 'Set Name'}
                  </span>
                  <button className="text-[10px] text-accent font-black uppercase tracking-[0.2em] group-hover:underline transition-all">
                    Edit
                  </button>
                </div>
              )}
            </div>

            {/* Orders Section */}
            <div className="p-4 bg-surface rounded-2xl border border-subtle">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-3 block">
                Warehouse Activities
              </label>
              <button
                onClick={() => {
                  navigate('/orders');
                  onClose();
                }}
                className="flex items-center justify-between w-full group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-card border border-subtle rounded-xl text-accent">
                    <History size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      Orders
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">
                      View and Print labels
                    </p>
                  </div>
                </div>
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>

              <div className="h-px bg-subtle my-2" />

              <button
                onClick={() => {
                  navigate('/stock-count');
                  onClose();
                }}
                className="flex items-center justify-between w-full group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-card border border-subtle rounded-xl text-emerald-500">
                    <ClipboardList size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      Stock Count
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">
                      Physical inventory check
                    </p>
                  </div>
                </div>
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>

              <div className="h-px bg-subtle my-2" />

              <button
                onClick={() => {
                  navigate('/cycle-count-history');
                  onClose();
                }}
                className="flex items-center justify-between w-full group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-card border border-subtle rounded-xl text-purple-400">
                    <FileSearch size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      Cycle Count History
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">
                      Past audits & reports
                    </p>
                  </div>
                </div>
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>

              <div className="h-px bg-subtle my-2" />

              <button
                onClick={() => {
                  navigate('/history');
                  onClose();
                }}
                className="flex items-center justify-between w-full group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-card border border-subtle rounded-xl text-amber-500">
                    <History size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      History
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">
                      Activity log
                    </p>
                  </div>
                </div>
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              {onExport && isAdmin && (
                <button
                  onClick={() => {
                    onExport();
                    onClose();
                  }}
                  className="ios-btn w-full h-14 bg-accent/10 hover:bg-accent/20 border border-accent/10 text-accent transition-all font-black uppercase tracking-[0.2em] text-[10px]"
                >
                  <Save size={16} />
                  Export Inventory (CSV)
                </button>
              )}

              {isAdmin && (
                <button
                  onClick={() => setIsSnapshotOpen(true)}
                  className="ios-btn w-full h-14 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/10 text-purple-500 transition-all font-black uppercase tracking-[0.2em] text-[10px]"
                >
                  <History size={16} />
                  Inventory Time Travel
                </button>
              )}

              {isSystemAdmin && (
                <button
                  onClick={() => {
                    toggleAdminView();
                    onClose();
                  }}
                  className={`ios-btn w-full h-14 border transition-all font-black uppercase tracking-[0.2em] text-[10px] ${
                    viewAsUser
                      ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/10 text-emerald-500'
                      : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/10 text-amber-500'
                  }`}
                >
                  {viewAsUser ? <ShieldCheck size={16} /> : <Eye size={16} />}
                  {viewAsUser ? 'Switch to Admin View' : 'View as Normal User'}
                </button>
              )}

              <button
                onClick={signOut}
                className="ios-btn w-full h-14 bg-red-500/10 hover:bg-red-500/20 border border-red-500/10 text-red-500 transition-all font-black uppercase tracking-[0.2em] text-[10px]"
              >
                <LogOut size={16} />
                Log Out
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-surface border-t border-subtle flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-card border border-subtle flex items-center justify-center text-muted uppercase font-bold">
            {profile?.full_name?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-muted truncate">
              {profile?.role?.toUpperCase()} ACCOUNT
            </p>
            <p className="text-[9px] text-muted/50 font-mono truncate mt-0.5">
              {import.meta.env.PROD
                ? window.location.hostname === 'roman-app.vercel.app'
                  ? 'stable'
                  : 'latest'
                : 'dev'}
            </p>
          </div>
          <img
            src="/PickD.png"
            alt="PickD"
            className="w-6 h-6 grayscale opacity-30 hover:grayscale-0 hover:opacity-100 transition-all"
          />
        </div>
      </div>

      <InventorySnapshotModal isOpen={isSnapshotOpen} onClose={() => setIsSnapshotOpen(false)} />
    </div>,
    document.body
  );
};
