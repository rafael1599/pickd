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

  // `role` is cached under `role_${userId}` already; `profile` (full_name)
  // never was. On a cold PWA restart / after the OS suspends the tab for
  // hours, `profile` starts at `null` and stays that way until the network
  // fetch below resolves — UserMenu shows "Unknown" the whole time even
  // though we already know the name from last session. Read it eagerly.
  const loadCachedProfile = (userId: string) => {
    const cached = localStorage.getItem(`profile_${userId}`);
    if (!cached) return;
    try {
      setProfile(JSON.parse(cached) as AuthProfile);
    } catch {
      // Corrupt cache — ignore, fetchProfileWithTimeout will overwrite it.
    }
  };

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
          if (mounted) loadCachedProfile(session.user.id);

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
          if (mounted) loadCachedProfile(session.user.id);
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
        } else if (event === 'TOKEN_REFRESHED') {
          // Supabase renewing the JWT hours after mount never re-runs
          // fetchProfileWithTimeout otherwise — a profile stuck at null
          // from a slow/failed initial fetch stays "Unknown" for the rest
          // of the tab's life even after the token is healthy again.
          fetchProfileWithTimeout(session.user.id, true);
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

  // A phone that comes back from being locked/backgrounded for hours fires
  // no auth event by itself — TOKEN_REFRESHED only covers the case where
  // Supabase's own timer was still running. Re-check on every return to the
  // tab so a profile that never loaded (or a token that's since died) gets
  // caught instead of sitting on "Unknown" until a manual reload.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          fetchProfileWithTimeout(session.user.id, true);
        }
      });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
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
    // Must exceed authLock's own 5s timeout (src/lib/supabase.ts) — a mobile
    // browser waking from suspend can spend 3-5s just re-acquiring that lock
    // before the profile query even starts. At 3000ms this race always lost
    // and aborted before the token finished refreshing, landing on "Unknown".
    const timeoutMs = 7000;
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
          localStorage.setItem(`profile_${userId}`, JSON.stringify(profileData));
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
        localStorage.setItem(`profile_${userId}`, JSON.stringify(profileData));
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

        // `prev` can be null here — a profile stuck at "Unknown" from a
        // failed/slow fetch used to make this update vanish into thin air
        // even though the write above succeeded. Build a full profile from
        // whatever we know instead of requiring `prev` to already exist.
        setProfile((prev) => {
          const next: AuthProfile = {
            role: prev?.role ?? role ?? 'staff',
            full_name: newName,
            last_seen_at: prev?.last_seen_at ?? null,
          };
          localStorage.setItem(`profile_${user.id}`, JSON.stringify(next));
          return next;
        });
        return { success: true };
      } catch (err) {
        console.error('Update profile error:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [user, role]
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
      if (key.startsWith('double_check_progress_') || key.startsWith('profile_')) {
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
