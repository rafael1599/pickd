import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const MIN_HEARTBEAT_GAP = 5000; // 5s — prevents duplicate calls from StrictMode / visibility race

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

                const { error } = await supabase.rpc('update_user_presence', {
                    p_user_id: user.id
                });

                if (error) {
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
