import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { withAuthRefreshRetry } from '../lib/authRefreshRetry';

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const MIN_HEARTBEAT_GAP = 5000; // 5s — prevents duplicate calls from StrictMode / visibility race

/**
 * Presence heartbeat — and the app's session watchdog.
 *
 * The watchdog role is the important one. Pickd is offline-first
 * (`networkMode: 'offlineFirst'`, 5-minute `staleTime`, query cache persisted
 * to IndexedDB, role cached in localStorage), so it renders a complete,
 * convincing UI without issuing a single request. That's the point — but it
 * also means the app cannot tell "no network" from "the server is rejecting
 * me", and a dead session produces no visible symptom beyond the profile
 * name quietly reading "Unknown". The only escape used to be a manual sign
 * out and back in.
 *
 * This heartbeat is the one thing that talks to the server unconditionally,
 * every 30s and on every tab-visible event — so it is exactly the right
 * probe, and it costs no extra requests. Routing its error through
 * `withAuthRefreshRetry` means an expired token gets refreshed and the call
 * replayed; only if the refresh itself fails does the session get torn down
 * and the user sent to /login.
 *
 * The `visibilitychange` firing matters most: it runs when the PWA is
 * resumed from suspension, which is when the token is most likely stale, and
 * it refreshes *before* the operator taps anything.
 */
export const usePresence = () => {
  const { user } = useAuth();
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!user) return;

    const sendHeartbeat = async () => {
      try {
        if (document.visibilityState !== 'visible') return;

        const now = Date.now();
        if (now - lastSentRef.current < MIN_HEARTBEAT_GAP) return;
        lastSentRef.current = now;

        const { error } = await withAuthRefreshRetry(
          () => supabase.rpc('update_user_presence', { p_user_id: user.id }),
          { label: 'usePresence.heartbeat' }
        );

        if (error) {
          // Auth failures are already handled by withAuthRefreshRetry (refresh
          // + replay, then escalate). Anything left here is a transient
          // network/server blip, and a missed heartbeat is genuinely harmless
          // — the next tick is 30s away.
          console.debug('[Presence] Heartbeat error:', error.message);
        }
      } catch (err) {
        console.debug('[Presence] Failed to send heartbeat:', err);
      }
    };

    sendHeartbeat();

    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user]);
};
