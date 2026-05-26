import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Save from 'lucide-react/dist/esm/icons/save';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

/**
 * Per-user toggle for the "Ship-Out SMS" feature.
 *
 * When enabled, the slide-to-complete flow on DoubleCheckView surfaces a
 * toast offering to open Messages with a prefilled "READY TO SHIP" body.
 * NO recipient is ever pre-filled — the operator picks the destination
 * conversation (e.g. their existing shipping group thread) on their
 * phone. We tried pre-filling numbers and it consistently spawned brand
 * new threads instead of matching the existing group.
 *
 * Pattern: a thin parent waits for the profile row to load, then mounts
 * the editable body with the profile as its initial-state seed. After a
 * save we invalidate the query → fresh profile → remount via the
 * profile-snapshot key. This avoids setState-in-effect without losing
 * the "form-driven-by-server-state" UX.
 */
export const ShipSmsSettings: React.FC = () => {
  const { user } = useAuth();
  const profileKey = ['profile-ship-sms', user?.id];

  const {
    data: profile,
    isLoading,
    error,
  } = useQuery({
    queryKey: profileKey,
    enabled: !!user?.id,
    queryFn: async () => {
      // maybeSingle so a missing profile row doesn't blow up the query —
      // we just fall back to defaults and the first save will populate
      // the row.
      const { data, error } = await supabase
        .from('profiles')
        .select('shipping_sms_enabled')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? { shipping_sms_enabled: false };
    },
  });

  if (!user) return null;
  if (isLoading) {
    return (
      <div className="bg-card border border-subtle rounded-3xl p-6 mb-8 backdrop-blur-sm">
        <div className="text-xs text-muted font-medium">Loading Ship-Out SMS settings…</div>
      </div>
    );
  }
  if (error || !profile) {
    return (
      <div className="bg-card border border-red-500/40 rounded-3xl p-6 mb-8 backdrop-blur-sm">
        <h2 className="text-lg font-bold text-content uppercase tracking-tight mb-2">
          Ship-Out SMS
        </h2>
        <div className="text-xs text-red-400 font-mono whitespace-pre-wrap break-words">
          {error instanceof Error ? error.message : 'No profile data returned.'}
        </div>
      </div>
    );
  }

  // Remount whenever the persisted snapshot changes, so the form's
  // initial state always matches what's saved.
  const snapshotKey = profile.shipping_sms_enabled ? '1' : '0';

  return (
    <ShipSmsSettingsBody
      key={snapshotKey}
      userId={user.id}
      initialEnabled={profile.shipping_sms_enabled ?? false}
      profileKey={profileKey}
    />
  );
};

interface BodyProps {
  userId: string;
  initialEnabled: boolean;
  profileKey: readonly unknown[];
}

const ShipSmsSettingsBody: React.FC<BodyProps> = ({ userId, initialEnabled, profileKey }) => {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(initialEnabled);

  const dirty = enabled !== initialEnabled;

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ shipping_sms_enabled: enabled })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Ship-Out SMS settings saved');
      queryClient.invalidateQueries({ queryKey: profileKey });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to save settings'),
  });

  return (
    <div className="bg-card border border-subtle rounded-3xl p-6 mb-8 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="text-accent flex-shrink-0" size={20} />
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-content uppercase tracking-tight">
              Ship-Out SMS
            </h2>
            <p className="text-xs text-muted font-medium">
              After slide-to-complete, open Messages with a prefilled "READY TO SHIP" body. You pick
              the destination thread (e.g. your existing shipping group) on your phone — no
              recipient is ever pre-filled.
            </p>
          </div>
        </div>
        <button
          onClick={() => setEnabled((v) => !v)}
          aria-label="Toggle Ship-Out SMS"
          className={`relative w-14 h-7 rounded-full p-1 transition-all duration-300 focus:outline-none ring-1 shrink-0 ${
            enabled ? 'bg-accent/20 ring-accent/30' : 'bg-subtle ring-subtle/50'
          }`}
        >
          <div
            className={`w-5 h-5 bg-accent rounded-full shadow-lg transition-all duration-300 transform ${
              enabled ? 'translate-x-7' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-main font-black uppercase tracking-widest text-[10px] disabled:opacity-30 active:scale-95 transition-all"
        >
          <Save size={12} />
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
};
