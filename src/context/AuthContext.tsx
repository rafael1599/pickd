/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { queryClient, persister } from '../lib/query-client';
import { type User } from '@supabase/supabase-js';

export interface AuthProfile {
  role: 'admin' | 'staff' | string;
  full_name: string | null;
  last_seen_at?: string | null;
}

interface AuthContextType {
  user: User | null;
  role: string | null;
  profile: AuthProfile | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  updateProfileName: (newName: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null); // 'admin' | 'staff'
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<AuthProfile | null>(null);

  // Cleanup legacy view_as_user storage
  useEffect(() => {
    localStorage.removeItem('view_as_user');
  }, []);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) throw error;

        if (session?.user) {
          if (mounted) setUser(session.user);

          const cachedRole = localStorage.getItem(`role_${session.user.id}`);
          if (cachedRole && mounted) {
            setRole(cachedRole);
            setLoading(false);
            fetchProfileWithTimeout(session.user.id, true);
          } else {
            await fetchProfileWithTimeout(session.user.id, false);
          }
        } else {
          if (mounted) setLoading(false);
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
        if (mounted) setLoading(false);
      }
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        if (mounted) setUser(session.user);

        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          const cachedRole = localStorage.getItem(`role_${session.user.id}`);
          if (cachedRole && mounted) {
            setRole(cachedRole);
            setLoading(false);

            fetchProfileWithTimeout(session.user.id, true);

            // Kickstart: Clean and Resume to prevent 'Zombie Orders'
            import('../lib/query-client').then(({ cleanupCorruptedMutations }) => {
              cleanupCorruptedMutations().then(() => {
                queryClient.resumePausedMutations().then(() => {
                  // Mutations resumed post-login
                  // If no mutations are running, force absolute truth from server now
                  if (queryClient.isMutating() === 0) {
                    queryClient.invalidateQueries();
                  }
                });
              });
            });
          } else {
            await fetchProfileWithTimeout(session.user.id, false);

            import('../lib/query-client').then(({ cleanupCorruptedMutations }) => {
              cleanupCorruptedMutations().then(() => {
                queryClient.resumePausedMutations().then(() => {
                  if (queryClient.isMutating() === 0) {
                    queryClient.invalidateQueries();
                  }
                });
              });
            });
          }
        }
      } else if (event === 'SIGNED_OUT') {
        if (mounted) {
          // On generalized SIGNED_OUT event (could be session expiry or other tab logout)
          // we play it safe and only remove sensitive queries, preserving the mutation queue.
          queryClient.removeQueries();
          // Also drop the on-disk IndexedDB snapshot — otherwise the next
          // load can restore query data built against the session that
          // just ended, before a fresh sign-in has a chance to overwrite it.
          Promise.resolve(persister.removeClient()).catch(() => {});

          setUser(null);
          setRole(null);
          setProfile(null);
          setLoading(false);

          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
      }
    });

    // Listen for global 401 auth errors from QueryClient
    const handleAuthError = () => {
      console.warn(
        '[AuthContext] 401 detected. Session expired. Preserving mutations, clearing queries and stale session.'
      );
      // 401 is involuntary logout: remove queries only, preserve the
      // mutation queue so in-flight offline work isn't discarded.
      queryClient.removeQueries();

      // Clear app state
      setUser(null);
      setRole(null);
      setProfile(null);

      // The dead session token (localStorage) and the on-disk IndexedDB
      // query snapshot both survive a plain redirect — removeQueries() only
      // clears in-memory state, and PersistQueryClientProvider's auto-persist
      // is debounced, so it rarely gets a chance to run before
      // window.location.href unloads the page. Left alone, the next load
      // restores the same dead session + stale cache from storage and
      // immediately 401s again — this is why only a full manual browser
      // data wipe used to actually fix it. Explicitly clear both, in
      // parallel, before navigating away.
      Promise.allSettled([supabase.auth.signOut(), persister.removeClient()]).finally(() => {
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      });
    };

    window.addEventListener('auth-error-401', handleAuthError);

    return () => {
      mounted = false;
      subscription?.unsubscribe();
      window.removeEventListener('auth-error-401', handleAuthError);
    };
  }, []);

  // Update last seen
  useEffect(() => {
    if (user) {
      const updateLastSeen = async () => {
        await supabase
          .from('profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', user.id);
      };
      updateLastSeen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depends on user.id only to avoid re-running on every user object change
  }, [user?.id]);

  const fetchProfileWithTimeout = async (userId: string, isBackground = false) => {
    const timeoutMs = 3000;
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));

    const fetchProfile = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, full_name, last_seen_at')
        .eq('id', userId)
        .single();
      return { data, error };
    };

    const profilePromise = fetchProfile();

    // A cold connection (fresh local Docker/OrbStack stack, or an occasional
    // latency spike in prod) can take longer than timeoutMs even though the
    // query eventually succeeds. Promise.race below abandons that result if
    // the timeout wins, which used to leave `profile` stuck at null for the
    // rest of the session (UserMenu then shows the 'Unknown' fallback
    // forever). Keep listening independently so a late success still lands.
    profilePromise
      .then(({ data, error }) => {
        if (!error && data) {
          const profileData = data as AuthProfile;
          setRole(profileData.role);
          setProfile(profileData);
          localStorage.setItem(`role_${userId}`, profileData.role);
        }
      })
      .catch(() => {});

    try {
      const result = await Promise.race([profilePromise, timeout]);

      if (result === 'timeout') {
        if (!isBackground) setRole('staff');
      } else if (
        typeof result === 'object' &&
        result !== null &&
        'error' in result &&
        result.error
      ) {
        if (!isBackground) setRole('staff');
      } else if (typeof result === 'object' && result !== null && 'data' in result && result.data) {
        const profileData = result.data as AuthProfile;
        setRole(profileData.role);
        setProfile(profileData);
        localStorage.setItem(`role_${userId}`, profileData.role);
      } else {
        if (!isBackground) setRole('staff');
      }
    } catch (e) {
      console.error('Profile fetch exception:', e);
      if (!isBackground) setRole('staff');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  const updateProfileName = useCallback(
    async (newName: string) => {
      if (!user) return { success: false, error: 'No user session' };

      try {
        const { error } = await supabase
          .from('profiles')
          .update({ full_name: newName })
          .eq('id', user.id);

        if (error) throw error;

        setProfile((prev) => (prev ? { ...prev, full_name: newName } : null));
        return { success: true };
      } catch (err) {
        console.error('Update profile error:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [user]
  );

  const signOut = useCallback(async () => {
    setLoading(true);

    // Voluntary Logout: Clear EVERYTHING (Queries + Mutations)
    // This prevents data leakage between different users on the same device.
    queryClient.clear();

    await supabase.auth.signOut();

    // Clear picking-related localStorage on Logout
    localStorage.removeItem('picking_cart_items');
    localStorage.removeItem('picking_order_number');
    localStorage.removeItem('active_picking_list_id');
    localStorage.removeItem('picking_session_mode');
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('double_check_progress_')) {
        localStorage.removeItem(key);
      }
    });

    setRole(null);
    setProfile(null);
    setUser(null);
    setLoading(false);
  }, []);

  const value = useMemo(
    () => ({
      user,
      role,
      profile,
      isAdmin: role === 'admin',
      loading,
      signOut,
      updateProfileName,
    }),
    [user, role, profile, loading, signOut, updateProfileName]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
