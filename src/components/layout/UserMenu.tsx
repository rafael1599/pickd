import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createPortal } from 'react-dom';
import { useTheme } from '../../context/ThemeContext';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import X from 'lucide-react/dist/esm/icons/x';
import Check from 'lucide-react/dist/esm/icons/check';
import Sun from 'lucide-react/dist/esm/icons/sun';
import Moon from 'lucide-react/dist/esm/icons/moon';
import Settings from 'lucide-react/dist/esm/icons/settings';
import History from 'lucide-react/dist/esm/icons/history';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list';
import FileSearch from 'lucide-react/dist/esm/icons/file-search';
import Kanban from 'lucide-react/dist/esm/icons/kanban';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import Printer from 'lucide-react/dist/esm/icons/printer';
import { InventorySnapshotModal } from '../../features/inventory/components/InventorySnapshotModal';
import { useScrollLock } from '../../hooks/useScrollLock';

interface UserMenuProps {
  isOpen: boolean;
  onClose: () => void;
  navigate: (path: string) => void;
}

export const UserMenu = ({ isOpen, onClose, navigate }: UserMenuProps) => {
  const {
    profile,
    signOut,
    updateProfileName,
    isAdmin,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [newName, setNewName] = useState(profile?.full_name || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  useScrollLock(isOpen, onClose);

  // Reset profile panel when menu closes
  useEffect(() => {
    if (!isOpen) setShowProfile(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!newName.trim()) return;
    setIsSaving(true);
    const { success } = await updateProfileName(newName);
    if (success) setIsEditing(false);
    setIsSaving(false);
  };

  const navTo = (path: string) => {
    setShowProfile(false);
    navigate(path);
    onClose();
  };

  const versionLabel = import.meta.env.PROD
    ? window.location.hostname === 'roman-app.vercel.app'
      ? 'stable'
      : 'latest'
    : 'dev';

  // ─── Profile Sub-Panel ───
  if (showProfile) {
    return createPortal(
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-main/60 backdrop-blur-md" onClick={onClose} />
        <div className="relative w-full max-w-sm bg-surface border border-subtle rounded-[2.5rem] overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
          <div className="p-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setShowProfile(false)}
                className="p-2 hover:bg-card rounded-full text-muted transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
              <h2 className="text-xl font-black uppercase tracking-tight text-content">Profile</h2>
            </div>

            <div className="space-y-4">
              {/* Avatar + Role */}
              <div className="flex items-center gap-4 p-4 bg-card border border-subtle rounded-2xl">
                <div className="w-14 h-14 rounded-full bg-accent/10 border-2 border-accent/20 flex items-center justify-center text-accent text-xl font-black uppercase">
                  {profile?.full_name?.charAt(0) || 'U'}
                </div>
                <div>
                  <p className="text-lg font-bold text-content tracking-tight">
                    {profile?.full_name || 'Unknown'}
                  </p>
                  <p className="text-[10px] text-muted font-black uppercase tracking-widest">
                    {profile?.role?.toUpperCase()} ACCOUNT · {versionLabel}
                  </p>
                </div>
              </div>

              {/* Edit Name */}
              <div className="p-4 bg-card border border-subtle rounded-2xl">
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
                      onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                      className="flex-1 bg-surface border border-subtle rounded-xl px-4 py-2 text-sm text-content focus:outline-none focus:border-accent/50"
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
                    <span className="text-sm font-bold text-content tracking-tight">
                      {profile?.full_name || 'Set Name'}
                    </span>
                    <button className="text-[10px] text-accent font-black uppercase tracking-[0.2em] group-hover:underline transition-all">
                      Edit
                    </button>
                  </div>
                )}
              </div>

              {/* Theme toggle */}
              <div className="p-4 bg-card border border-subtle rounded-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-surface border border-subtle rounded-xl text-content">
                      {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-content uppercase tracking-tight">
                        {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={toggleTheme}
                    className={`relative w-14 h-7 rounded-full p-1 transition-all duration-300 focus:outline-none ring-1
                      ${theme === 'dark' ? 'bg-accent/20 ring-accent/30' : 'bg-subtle ring-subtle/50'}`}
                    aria-label="Toggle Theme"
                  >
                    <div
                      className={`w-5 h-5 bg-accent rounded-full shadow-lg transition-all duration-300 transform
                        ${theme === 'dark' ? 'translate-x-7 rotate-0' : 'translate-x-0 rotate-180'}`}
                    />
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ─── Main Menu ───
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-main/60 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-surface border border-subtle rounded-[2.5rem] overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <img src="/PickD.png" alt="PickD" className="w-7 h-7" />
              <h2 className="text-xl font-black uppercase tracking-tight text-content">Menu</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-card rounded-full text-muted transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="space-y-4">
            {/* Warehouse Activities */}
            <div className="p-4 bg-card border border-subtle rounded-2xl">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-3 block">
                Warehouse Activities
              </label>

              <button
                onClick={() => navTo('/stock-count')}
                className="flex items-center justify-between w-full group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface border border-subtle rounded-xl text-emerald-500">
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
                onClick={() => navTo('/history')}
                className="flex items-center justify-between w-full group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface border border-subtle rounded-xl text-muted">
                    <History size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      History
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">Activity log</p>
                  </div>
                </div>
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>

              {isAdmin && (
                <>
                  <div className="h-px bg-subtle my-2" />
                  <button
                    onClick={() => navTo('/activity-report')}
                    className="flex items-center justify-between w-full group text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-surface border border-subtle rounded-xl text-teal-500">
                        <FileSearch size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-content uppercase tracking-tight">
                          Activity Report
                        </p>
                        <p className="text-[9px] text-muted font-bold uppercase">
                          Daily team summary
                        </p>
                      </div>
                    </div>
                    <div className="text-accent group-hover:translate-x-1 transition-transform">
                      →
                    </div>
                  </button>

                  <div className="h-px bg-subtle my-2" />

                  <button
                    onClick={() => navTo('/projects')}
                    className="flex items-center justify-between w-full group text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-surface border border-subtle rounded-xl text-indigo-500">
                        <Kanban size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-content uppercase tracking-tight">
                          Projects
                        </p>
                        <p className="text-[9px] text-muted font-bold uppercase">Task board</p>
                      </div>
                    </div>
                    <div className="text-accent group-hover:translate-x-1 transition-transform">
                      →
                    </div>
                  </button>
                </>
              )}
            </div>

            {/* Admin Tools */}
            {isAdmin && (
              <div className="p-4 bg-card border border-subtle rounded-2xl">
                <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-3 block">
                  Admin Tools
                </label>

                <button
                  onClick={() => navTo('/labels')}
                  className="flex items-center justify-between w-full group text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-surface border border-subtle rounded-xl text-accent">
                      <Printer size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-content uppercase tracking-tight">Bike Labels</p>
                      <p className="text-[9px] text-muted font-bold uppercase">QR asset tags</p>
                    </div>
                  </div>
                  <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
                </button>

                <div className="h-px bg-subtle my-2" />

                <button
                  onClick={() => setIsSnapshotOpen(true)}
                  className="flex items-center gap-3 w-full text-left"
                >
                  <div className="p-2 bg-surface border border-subtle rounded-xl text-purple-400">
                    <History size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      Inventory Time Travel
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">View past snapshots</p>
                  </div>
                </button>

              </div>
            )}
          </div>
        </div>

        {/* Footer — Profile + Settings + Logout */}
        <div className="px-6 py-4 bg-card border-t border-subtle flex items-center gap-3">
          <button
            onClick={() => setShowProfile(true)}
            className="flex items-center gap-3 flex-1 min-w-0 text-left group"
          >
            <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent text-sm font-black uppercase shrink-0">
              {profile?.full_name?.charAt(0) || 'U'}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-content truncate">
                {profile?.full_name || 'Unknown'}
              </p>
              <p className="text-[9px] text-muted font-bold uppercase tracking-widest">
                {profile?.role?.toUpperCase()} · {versionLabel}
              </p>
            </div>
          </button>

          <button
            onClick={() => setShowProfile(true)}
            className="p-2 hover:bg-surface rounded-xl text-muted hover:text-content transition-colors"
            title="Settings"
          >
            <Settings size={18} />
          </button>

          <button
            onClick={signOut}
            className="p-2 hover:bg-red-500/10 rounded-xl text-muted hover:text-red-500 transition-colors"
            title="Log Out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <InventorySnapshotModal isOpen={isSnapshotOpen} onClose={() => setIsSnapshotOpen(false)} />
    </div>,
    document.body
  );
};
