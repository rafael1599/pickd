import React, { useState } from 'react';
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
import Download from 'lucide-react/dist/esm/icons/download';
import Kanban from 'lucide-react/dist/esm/icons/kanban';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import Printer from 'lucide-react/dist/esm/icons/printer';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart';
import PackageOpen from 'lucide-react/dist/esm/icons/package-open';
import Boxes from 'lucide-react/dist/esm/icons/boxes';
import Container from 'lucide-react/dist/esm/icons/container';
import Scan from 'lucide-react/dist/esm/icons/scan';
import Map from 'lucide-react/dist/esm/icons/map';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import { MANUALS } from '../../content/manuals';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useModal } from '../../context/ModalContext';
import { useViewMode } from '../../context/ViewModeContext';
import { useMenuUsage, type MenuItemSpec } from '../../hooks/useMenuUsage';

interface UserMenuProps {
  isOpen: boolean;
  onClose: () => void;
  navigate: (path: string) => void;
}

export const UserMenu = ({ isOpen, onClose, navigate }: UserMenuProps) => {
  const { open: openModal } = useModal();
  const { profile, signOut, updateProfileName, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { setViewMode } = useViewMode();
  const { mostUsedItems, recordUsage } = useMenuUsage();

  const [newName, setNewName] = useState(profile?.full_name || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  useScrollLock(isOpen, onClose);

  // Reset profile panel when menu closes — derive from isOpen to avoid setState in effect
  const effectiveShowProfile = isOpen ? showProfile : false;

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!newName.trim()) return;
    setIsSaving(true);
    const { success } = await updateProfileName(newName);
    if (success) setIsEditing(false);
    setIsSaving(false);
  };

  const navTo = (path: string, itemId?: string) => {
    if (itemId) recordUsage(itemId);
    setShowProfile(false);
    navigate(path);
    onClose();
  };

  // Picking is a view mode on the home screen, not a route: switch the mode and land on Home.
  const startPicking = () => {
    recordUsage('picking');
    setViewMode('picking');
    navTo('/', 'picking');
  };

  const handleShortcutClick = (item: MenuItemSpec) => {
    recordUsage(item.id);
    if (item.action === 'picking') {
      startPicking();
    } else if (item.path) {
      navTo(item.path);
    }
  };

  const versionLabel = import.meta.env.PROD
    ? window.location.hostname === 'pickd.pages.dev'
      ? 'stable'
      : 'latest'
    : 'dev';

  // ─── Profile Sub-Panel ───
  if (effectiveShowProfile) {
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
                      className="flex-1 px-4 py-2.5 bg-surface border border-subtle rounded-xl text-sm font-semibold text-content focus:outline-none focus:border-accent"
                      placeholder="Your name"
                    />
                    <button
                      disabled={isSaving}
                      onClick={handleSave}
                      className="px-4 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center gap-1 shrink-0"
                    >
                      <Check size={16} />
                      {isSaving ? '...' : 'Save'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-content">
                      {profile?.full_name || 'Not set'}
                    </span>
                    <button
                      onClick={() => {
                        setNewName(profile?.full_name || '');
                        setIsEditing(true);
                      }}
                      className="text-xs font-bold text-accent hover:underline uppercase tracking-wider"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>

              {/* Appearance / Theme Toggle */}
              <div className="p-4 bg-card border border-subtle rounded-2xl">
                <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-3 block">
                  Appearance
                </label>
                <button
                  onClick={toggleTheme}
                  className="flex items-center justify-between w-full p-3 bg-surface border border-subtle rounded-xl text-content font-bold text-xs uppercase tracking-wider hover:border-accent/40 transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    {theme === 'dark' ? (
                      <Moon size={16} className="text-accent" />
                    ) : (
                      <Sun size={16} className="text-amber-500" />
                    )}
                    {theme === 'dark' ? 'Dark Theme' : 'Light Theme'}
                  </span>
                  <span className="text-[10px] font-black text-accent uppercase tracking-widest bg-accent/10 px-2 py-1 rounded-md">
                    Switch
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ─── Main Menu Portal ───
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-main/60 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-sm max-h-[85vh] flex flex-col bg-surface border border-subtle rounded-[2.5rem] overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-6 pb-2 flex justify-between items-center shrink-0">
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

        {/* Scrollable Body */}
        <div className="p-6 pt-2 overflow-y-auto space-y-4 flex-1">
          {/* ⭐️ Dynamic Smart Shortcuts Grid (Top 6 Most Used) */}
          <div className="p-3 bg-card border border-subtle rounded-2xl">
            <div className="flex items-center justify-between mb-2.5 px-1">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest flex items-center gap-1">
                <Sparkles size={12} className="text-accent" />
                MOST USED
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {mostUsedItems.map((item) => {
                const IconComponent = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleShortcutClick(item)}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-surface border border-subtle hover:border-accent/40 active:scale-95 transition-all text-center group"
                  >
                    <div
                      className={`p-2 rounded-lg ${item.colorBg} ${item.colorText} mb-1 group-hover:scale-110 transition-transform`}
                    >
                      <IconComponent size={18} />
                    </div>
                    <span className="text-[10px] font-extrabold uppercase text-content tracking-tight">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Operations & Logistics */}
          <div className="p-4 bg-card border border-subtle rounded-2xl">
            <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-3 block">
              Operations &amp; Logistics
            </label>

            <button
              onClick={() => navTo('/warehouse-map', 'map')}
              className="flex items-center justify-between w-full group text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-surface border border-subtle rounded-xl text-blue-500">
                  <Map size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold text-content uppercase tracking-tight">
                    Warehouse Map
                  </p>
                  <p className="text-[9px] text-muted font-bold uppercase">
                    Top view &amp; overstock plan
                  </p>
                </div>
              </div>
              <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
            </button>

            <div className="h-px bg-subtle my-2" />

            <button
              onClick={startPicking}
              className="flex items-center justify-between w-full group text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-surface border border-subtle rounded-xl text-sky-500">
                  <Scan size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold text-content uppercase tracking-tight">Picking</p>
                  <p className="text-[9px] text-muted font-bold uppercase">
                    Pick &amp; fulfill orders
                  </p>
                </div>
              </div>
              <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
            </button>

            <div className="h-px bg-subtle my-2" />

            <button
              onClick={() => navTo('/stock-count', 'count')}
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
              onClick={() => navTo('/shopping-list', 'shopping')}
              className="flex items-center justify-between w-full group text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-surface border border-subtle rounded-xl text-orange-500">
                  <ShoppingCart size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold text-content uppercase tracking-tight">
                    Shopping List
                  </p>
                  <p className="text-[9px] text-muted font-bold uppercase">
                    Supplies &amp; materials
                  </p>
                </div>
              </div>
              <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
            </button>

            <div className="h-px bg-subtle my-2" />

            <button
              onClick={() => navTo('/fedex-returns', 'returns')}
              className="flex items-center justify-between w-full group text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-surface border border-subtle rounded-xl text-purple-400">
                  <PackageOpen size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold text-content uppercase tracking-tight">
                    FedEx Returns
                  </p>
                  <p className="text-[9px] text-muted font-bold uppercase">
                    Intake &amp; process returns
                  </p>
                </div>
              </div>
              <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
            </button>
          </div>

          {/* Manuals — the index, then a row per procedure that has been written.
              Each row renders only once its manual exists, so writing one is
              what puts it here; no code change, no deploy. */}
          <div className="p-4 bg-card border border-subtle rounded-2xl">
            <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-3 block">
              Manuals
            </label>

            <button
              onClick={() => navTo('/manuals', 'manuals')}
              className="flex items-center justify-between w-full group text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-surface border border-subtle rounded-xl text-sky-500">
                  <BookOpen size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold text-content uppercase tracking-tight">
                    All Manuals
                  </p>
                  <p className="text-[9px] text-muted font-bold uppercase">Warehouse procedures</p>
                </div>
              </div>
              <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
            </button>

            {/* One row per manual that exists, straight off the static library —
                no curated list to keep in step. Writing a manual is what puts
                it here, and its own title and summary are what it says, so the
                row can't promise something the page doesn't. */}
            {MANUALS.map((manual) => (
              <React.Fragment key={manual.slug}>
                <div className="h-px bg-subtle my-2" />
                <button
                  onClick={() => navTo(`/manuals/${manual.slug}`)}
                  className="flex items-center justify-between w-full group text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-surface border border-subtle rounded-xl text-amber-500">
                      <FileText size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-content uppercase tracking-tight">
                        {manual.title}
                      </p>
                      <p className="text-[9px] text-muted font-bold uppercase line-clamp-2">
                        {manual.summary}
                      </p>
                    </div>
                  </div>
                  <div className="text-accent group-hover:translate-x-1 transition-transform">
                    →
                  </div>
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Admin & Management Tools */}
          {isAdmin && (
            <div className="p-4 bg-card border border-subtle rounded-2xl">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-3 block">
                Admin &amp; Management
              </label>

              <button
                onClick={() => navTo('/consolidation', 'slotting')}
                className="flex items-center justify-between w-full group text-left mb-3"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface border border-subtle rounded-xl text-orange-500">
                    <Boxes size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      Consolidation
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">Slow-mover slotting</p>
                  </div>
                </div>
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>

              <button
                onClick={() => navTo('/registrar-container', 'container')}
                className="flex items-center justify-between w-full group text-left mb-3"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface border border-subtle rounded-xl text-blue-500">
                    <Container size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      Register Container
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">Intake from Excel</p>
                  </div>
                </div>
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>

              <button
                onClick={() => navTo('/labels')}
                className="flex items-center justify-between w-full group text-left mb-3"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface border border-subtle rounded-xl text-accent">
                    <Printer size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      Label Studio
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">QR asset tags</p>
                  </div>
                </div>
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>

              <div className="h-px bg-subtle my-2" />

              <button
                onClick={() => navTo('/activity-report', 'reports')}
                className="flex items-center justify-between w-full group text-left mb-3"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface border border-subtle rounded-xl text-teal-500">
                    <FileSearch size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      Activity Report
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">Daily team summary</p>
                  </div>
                </div>
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>

              <button
                onClick={() => navTo('/export', 'export')}
                className="flex items-center justify-between w-full group text-left mb-3"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface border border-subtle rounded-xl text-violet-500">
                    <Download size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase tracking-tight">
                      Export
                    </p>
                    <p className="text-[9px] text-muted font-bold uppercase">FedEx dimensions</p>
                  </div>
                </div>
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>

              <button
                onClick={() => navTo('/projects', 'projects')}
                className="flex items-center justify-between w-full group text-left mb-3"
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
                <div className="text-accent group-hover:translate-x-1 transition-transform">→</div>
              </button>

              <button
                onClick={() => navTo('/history', 'history')}
                className="flex items-center justify-between w-full group text-left mb-3"
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

              <div className="h-px bg-subtle my-2" />

              <button
                onClick={() => {
                  onClose();
                  openModal({ type: 'inventory-snapshot' });
                }}
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

        {/* Footer — Profile + Settings + Logout */}
        <div className="px-6 py-4 bg-card border-t border-subtle flex items-center gap-3 shrink-0">
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
    </div>,
    document.body
  );
};
