/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { queryClient, persister } from '../lib/query-client';
import { withAuthRefreshRetry } from '../lib/authRefreshRetry';
import { isAuthError } from '../lib/supabaseRetry';
import { reportClockSkew } from '../lib/clockSkew';
import { type User } from '@supabase/supabase-js';

export interface AuthProfile {
  role: 'admin' | 'staff' | string;
  full_name: string | null;
  last_seen_at?: string | null;
}

/**
 * How long the initial profile load may hold the app's loading gate before
 * the UI renders anyway. This is a UI deadline, not a fetch deadline — the
 * request outlives it.
 */
const PROFILE_UI_RELEASE_MS = 3000;
/** Attempts before giving up on the profile row (exponential backoff). */
const PROFILE_MAX_ATTEMPTS = 5;

interface AuthContextType {
  user: User | null;
  role: string | null;
  profile: AuthProfile | null;
  isAdmin: boolean;
  loading: boolean;
  /**
   * Signed in, but the profile row never loaded — the state where the UI
   * shows "Unknown" instead of a name and the role is indeterminate. Callers
   * use this to surface the problem instead of rendering a half-broken app.
   */
  isDegraded: boolean;
  /** Retry the profile load (refreshing the session first if needed). */
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfileName: (newName: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null); // 'admin' | 'staff'
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  // Distinct from `!profile`: true only once loadProfile has exhausted its
  // retries. The UI gate releases at 3s while retries continue in the
  // background, so `!profile` alone would flash a scary banner during a
  // recovery that is about to succeed.
  const [profileFailed, setProfileFailed] = useState(false);
  const mountedRef = useRef(true);

  // Cleanup legacy view_as_user storage
  useEffect(() => {
    localStorage.removeItem('view_as_user');
  }, []);

  // Diagnostic only: a device clock far enough off makes supabase-js trust a
  // token the server already rejects, which presents as a silently dead
  // session. Nothing branches on this — it's here so the next occurrence
  // leaves evidence in the console instead of being unexplainable.
  useEffect(() => {
    const controller = new AbortController();
    reportClockSkew(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let mounted = true;
    // Reset on every run: StrictMode's dev double-mount would otherwise leave
    // this false from the first pass's cleanup and mute the real mount.
    mountedRef.current = true;

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
            loadProfile(session.user.id, { blocking: false });
          } else {
            await loadProfile(session.user.id, { blocking: true });
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

            loadProfile(session.user.id, { blocking: false });

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
            await loadProfile(session.user.id, { blocking: true });

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
          setProfileFailed(false);
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
      setProfileFailed(false);

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
      mountedRef.current = false;
      subscription?.unsubscribe();
      window.removeEventListener('auth-error-401', handleAuthError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadProfile is a stable useCallback([]); this effect must run exactly once
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

  /**
   * Load the profile row, retrying transient failures.
   *
   * Replaces a `Promise.race(fetch, sleep(3000))` that conflated two
   * unrelated deadlines: "stop blocking the UI" and "give up on the profile".
   * Losing that race discarded the in-flight fetch, so a single slow response
   * on warehouse wifi left `profile = null` — the UI reading "Unknown" — for
   * the entire session, with nothing that would ever try again. Here the 3s
   * timer only releases the loading gate; the fetch keeps going and fills in
   * whenever it lands.
   *
   * It also no longer swallows auth errors. This is the app's first
   * authenticated request, so it's the earliest possible detector of a dead
   * session — `withAuthRefreshRetry` refreshes and replays, and escalates to
   * a real sign-out only if the refresh fails.
   */
  const loadProfile = useCallback(async (userId: string, opts: { blocking: boolean }) => {
    setProfileFailed(false);
    let released = !opts.blocking;
    const release = () => {
      if (released) return;
      released = true;
      setLoading(false);
    };
    const releaseTimer = opts.blocking ? setTimeout(release, PROFILE_UI_RELEASE_MS) : undefined;

    try {
      for (let attempt = 0; attempt < PROFILE_MAX_ATTEMPTS; attempt++) {
        const { data, error } = await withAuthRefreshRetry(
          () =>
            supabase
              .from('profiles')
              .select('role, full_name, last_seen_at')
              .eq('id', userId)
              .single(),
          { label: 'AuthContext.loadProfile' }
        );

        if (!mountedRef.current) return;

        if (data) {
          const profileData = data as AuthProfile;
          setRole(profileData.role);
          setProfile(profileData);
          localStorage.setItem(`role_${userId}`, profileData.role);
          return;
        }

        // Session is genuinely gone — withAuthRefreshRetry already dispatched
        // auth-error-401 and the redirect to /login is underway. Retrying
        // would just race the teardown.
        if (isAuthError(error)) return;

        // No profile row for this user: a deterministic answer, not a blip.
        if (error?.code === 'PGRST116') {
          console.error(`[AuthContext] No profile row for user ${userId}`);
          setProfileFailed(true);
          return;
        }

        if (attempt < PROFILE_MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15_000)));
        }
      }

      // Deliberately leave `role` as-is rather than asserting 'staff'. The
      // old code defaulted to staff on any failure, which silently stripped
      // an admin of every admin control for the whole session on nothing more
      // than a slow response — a wrong answer presented as a real one. An
      // indeterminate role is honest, gates the same way (isAdmin === false),
      // and lets `isDegraded` surface it.
      console.warn(
        `[AuthContext] Profile unavailable after ${PROFILE_MAX_ATTEMPTS} attempts — role left indeterminate.`
      );
      setProfileFailed(true);
    } catch (e) {
      console.error('Profile fetch exception:', e);
      setProfileFailed(true);
    } finally {
      clearTimeout(releaseTimer);
      release();
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) {
      window.dispatchEvent(new CustomEvent('auth-error-401'));
      return;
    }
    await loadProfile(userId, { blocking: false });
  }, [loadProfile]);

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
    setProfileFailed(false);
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
      // Signed in, but the profile load ran out of retries. Not merely
      // `!profile` — that is also true mid-recovery.
      isDegraded: !!user && !profile && profileFailed,
      refreshProfile,
      signOut,
      updateProfileName,
    }),
    [user, role, profile, profileFailed, loading, refreshProfile, signOut, updateProfileName]
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
