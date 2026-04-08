import { useState, useEffect, FormEvent } from 'react';
import { supabase } from '../../../lib/supabase';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus';
import UserRoundPen from 'lucide-react/dist/esm/icons/user-round-pen';
import Mail from 'lucide-react/dist/esm/icons/mail';
import Shield from 'lucide-react/dist/esm/icons/shield';
import UserIcon from 'lucide-react/dist/esm/icons/user';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Key from 'lucide-react/dist/esm/icons/key';
import Save from 'lucide-react/dist/esm/icons/save';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';
import ShieldOff from 'lucide-react/dist/esm/icons/shield-off';
import toast from 'react-hot-toast';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { useScrollLock } from '../../../hooks/useScrollLock';

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  is_active: boolean | null;
  last_seen_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
}

const formatRelativeTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  return `${Math.floor(diffInSeconds / 86400)}d ago`;
};

export const UserManagement = () => {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const { showConfirmation } = useConfirmation();
  useScrollLock(isModalOpen, () => setIsModalOpen(false));

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const toggleUserStatus = async (user: Profile) => {
    const newStatus = !user.is_active;
    showConfirmation(
      newStatus ? 'Activate User' : 'Deactivate User',
      `Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} ${user.full_name}?`,
      async () => {
        try {
          const { error } = await supabase.functions.invoke('manage-users', {
            body: { action: 'updateUser', userId: user.id, is_active: newStatus },
          });

          if (error) throw error;
          toast.success(`User ${newStatus ? 'activated' : 'deactivated'} successfully`);
          fetchUsers();
        } catch (err) {
          console.error('Status toggle error:', err);
          toast.error('Failed to change user status');
        }
      },
      undefined,
      newStatus ? 'Activate' : 'Deactivate'
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-card border border-subtle p-4 rounded-2xl">
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest text-content">
            System Users
          </h3>
          <p className="text-[10px] text-muted font-bold uppercase mt-1">
            Manage staff access and permissions
          </p>
        </div>
        <button
          onClick={() => {
            setSelectedUser(null);
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-main rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-accent/20 active:scale-95 transition-all"
        >
          <UserPlus size={16} />
          Add New User
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="animate-spin text-accent" size={32} />
          <p className="text-xs text-muted font-bold uppercase tracking-widest">
            Loading user accounts...
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map((u) => (
            <div
              key={u.id}
              className="bg-card border border-subtle p-5 rounded-2xl hover:border-accent/30 transition-all group relative"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-3 rounded-2xl ${!u.is_active ? 'bg-red-500/10 text-red-500' : u.role === 'admin' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}
                  >
                    <Shield size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4
                        className={`font-bold text-content leading-tight uppercase tracking-tight ${!u.is_active ? 'opacity-40' : ''}`}
                      >
                        {u.full_name}
                      </h4>
                      {!u.is_active && (
                        <span className="text-[8px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded uppercase">
                          Inactive
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border mt-1 inline-block ${u.role === 'admin' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'}`}
                    >
                      {u.role}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 mt-4">
                <div className="flex items-center gap-2 text-muted">
                  <Mail size={14} className="opacity-40" />
                  <span className="text-xs font-medium truncate opacity-60">
                    {u.email || 'No email set'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <UserIcon size={14} className="opacity-40" />
                  <span className="text-[10px] font-mono opacity-40 uppercase truncate">
                    ID: ...{u.id.slice(-8)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted mt-1">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${u.last_seen_at && new Date().getTime() - new Date(u.last_seen_at).getTime() < 300000 ? 'bg-emerald-500 animate-pulse' : 'bg-subtle'}`}
                  />
                  <span className="text-[9px] font-black uppercase tracking-widest opacity-60">
                    {u.last_seen_at
                      ? `Last seen: ${formatRelativeTime(u.last_seen_at)}`
                      : 'Never seen'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 mt-6 pt-4 border-t border-subtle">
                <button
                  onClick={() => {
                    setSelectedUser(u);
                    setIsModalOpen(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-surface hover:bg-subtle text-muted hover:text-content rounded-xl transition-all"
                >
                  <UserRoundPen size={14} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Edit</span>
                </button>
                <button
                  onClick={() => toggleUserStatus(u)}
                  className={`px-3 flex items-center justify-center rounded-xl transition-all ${
                    u.is_active
                      ? 'bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white'
                      : 'bg-emerald-500/10 hover:bg-emerald-500 text-emerald-500 hover:text-white'
                  }`}
                  title={u.is_active ? 'Deactivate User' : 'Activate User'}
                >
                  {u.is_active ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <UserModal
          user={selectedUser}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false);
            fetchUsers();
          }}
        />
      )}
    </div>
  );
};

interface UserModalProps {
  user: Profile | null;
  onClose: () => void;
  onSuccess: () => void;
}

const UserModal = ({ user, onClose, onSuccess }: UserModalProps) => {
  const isEditing = !!user;
  const [formData, setFormData] = useState({
    full_name: user?.full_name || '',
    email: user?.email || '',
    password: '',
    role: user?.role || 'staff',
    is_active: user?.is_active !== false,
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const endpoint = isEditing ? 'updateUser' : 'createUser';
      const body = {
        action: endpoint,
        ...formData,
        userId: user?.id,
      };

      const { error } = await supabase.functions.invoke('manage-users', {
        body,
      });

      if (error) throw error;

      toast.success(isEditing ? 'User updated successfully' : 'User created successfully');
      onSuccess();
    } catch (err: unknown) {
      console.error('Submit error:', err);
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md bg-card border border-subtle rounded-[2rem] overflow-hidden shadow-2xl animate-in zoom-in slide-in-from-bottom-8 duration-500">
        <div className="p-8">
          <div className="mb-8">
            <div className="flex items-center gap-4 mb-2">
              <div className="p-3 bg-accent/10 rounded-2xl text-accent">
                {isEditing ? <UserRoundPen size={24} /> : <UserPlus size={24} />}
              </div>
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tight text-content">
                  {isEditing ? 'Edit Account' : 'New Account'}
                </h2>
                <p className="text-xs text-muted font-medium uppercase tracking-widest">
                  {isEditing ? 'Update Profile Details' : 'Create Staff Credentials'}
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted ml-1">
                Full Name
              </label>
              <div className="relative">
                <UserIcon
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-muted/40"
                  size={18}
                />
                <input
                  required
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData((p) => ({ ...p, full_name: e.target.value }))}
                  className="w-full bg-main border border-subtle rounded-2xl pl-12 pr-4 py-4 text-content focus:outline-none focus:border-accent focus:ring-4 ring-accent/5 transition-all text-sm font-medium"
                  placeholder="e.g. Rafael Lopez"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted ml-1">
                Email Address
              </label>
              <div className="relative">
                <Mail
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-muted/40"
                  size={18}
                />
                <input
                  required
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                  className="w-full bg-main border border-subtle rounded-2xl pl-12 pr-4 py-4 text-content focus:outline-none focus:border-accent focus:ring-4 ring-accent/5 transition-all text-sm font-medium"
                  placeholder="user@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted ml-1">
                {isEditing ? 'New Password (Optional)' : 'Access Password'}
              </label>
              <div className="relative">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-muted/40" size={18} />
                <input
                  required={!isEditing}
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                  className="w-full bg-main border border-subtle rounded-2xl pl-12 pr-4 py-4 text-content focus:outline-none focus:border-accent focus:ring-4 ring-accent/5 transition-all text-sm font-medium"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted ml-1">
                System Role
              </label>
              <div className="grid grid-cols-2 gap-3">
                {['staff', 'admin'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setFormData((p) => ({ ...p, role: r }))}
                    className={`py-4 rounded-2xl border-2 font-black uppercase tracking-widest text-[10px] transition-all ${
                      formData.role === r
                        ? 'bg-accent/10 border-accent text-accent'
                        : 'bg-main border-subtle text-muted hover:border-muted'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted ml-1">
                Account Controls
              </label>

              <div className="flex items-center justify-between p-4 bg-main border border-subtle rounded-2xl">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-lg ${formData.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}
                  >
                    {formData.is_active ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-content uppercase">Active Status</p>
                    <p className="text-[9px] text-muted font-medium uppercase">
                      {formData.is_active ? 'Account is operational' : 'Account is disabled'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, is_active: !p.is_active }))}
                  className={`w-12 h-6 rounded-full p-1 transition-all flex ${formData.is_active ? 'bg-emerald-500 justify-end' : 'bg-subtle justify-start'}`}
                >
                  <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-6">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-4 bg-surface text-content font-black uppercase tracking-widest text-[10px] rounded-2xl hover:brightness-95 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-4 bg-accent text-main font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-xl shadow-accent/20 hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                {isEditing ? 'Update User' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
