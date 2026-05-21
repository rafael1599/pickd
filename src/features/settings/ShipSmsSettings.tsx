import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Save from 'lucide-react/dist/esm/icons/save';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { normalizeRecipients } from '../../utils/shipOutSms';

/**
 * Per-user settings for the "Ship-Out SMS" feature.
 *
 * Pattern: a thin parent waits for the profile row to load, then mounts
 * the editable body with the profile as its initial-state seed. After a
 * save we invalidate the query → fresh profile → remount via the
 * profile-snapshot key. This avoids setState-in-effect (which the lint
 * rule rightly flags as an anti-pattern) without losing the
 * "form-driven-by-server-state" UX.
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
      // the row (or the upsert path below if you prefer that flow).
      const { data, error } = await supabase
        .from('profiles')
        .select('shipping_sms_enabled, shipping_sms_recipients')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return (
        data ?? {
          shipping_sms_enabled: false,
          shipping_sms_recipients: [] as string[],
        }
      );
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
  const snapshotKey = `${profile.shipping_sms_enabled ? '1' : '0'}|${(
    profile.shipping_sms_recipients ?? []
  ).join(',')}`;

  return (
    <ShipSmsSettingsBody
      key={snapshotKey}
      userId={user.id}
      initialEnabled={profile.shipping_sms_enabled ?? false}
      initialRecipients={(profile.shipping_sms_recipients ?? []).join('\n')}
      profileKey={profileKey}
    />
  );
};

interface BodyProps {
  userId: string;
  initialEnabled: boolean;
  initialRecipients: string;
  profileKey: readonly unknown[];
}

const ShipSmsSettingsBody: React.FC<BodyProps> = ({
  userId,
  initialEnabled,
  initialRecipients,
  profileKey,
}) => {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [recipientsText, setRecipientsText] = useState(initialRecipients);

  const normalized = normalizeRecipients(recipientsText);
  const dirty =
    enabled !== initialEnabled || normalized.join('|') !== initialRecipients.split('\n').join('|');

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({
          shipping_sms_enabled: enabled,
          shipping_sms_recipients: normalized,
        })
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
              After slide-to-complete in Double-Check, open Messages with a prefilled "READY TO
              SHIP" body addressed to your group.
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

      <label className="block text-[10px] font-black uppercase tracking-widest text-muted mb-2">
        Recipient phone numbers (one per line, E.164 preferred)
      </label>
      <textarea
        value={recipientsText}
        onChange={(e) => setRecipientsText(e.target.value)}
        placeholder={'+19144268047\n+13055551212'}
        rows={4}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="w-full bg-surface border border-subtle rounded-xl px-3 py-2 text-sm font-mono text-content placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-muted">
          {normalized.length} valid recipient{normalized.length === 1 ? '' : 's'}
          {recipientsText.trim() && normalized.length === 0 && (
            <span className="text-amber-400 ml-2">⚠ no usable numbers</span>
          )}
        </span>
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
