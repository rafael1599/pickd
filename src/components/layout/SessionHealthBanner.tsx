import { useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * Visible warning for a half-loaded session.
 *
 * Until now the only trace of "signed in but the profile never loaded" was
 * the word "Unknown" inside the user menu — a screen nobody opens unless
 * something already looks wrong. Meanwhile the role is indeterminate, so
 * admin controls are missing and the operator has no way to connect that to
 * a session problem. The observed outcome was people working in a degraded
 * app until something failed outright, then guessing at a manual sign
 * out/in.
 *
 * This makes the state impossible to miss and gives it a one-tap fix.
 */
export const SessionHealthBanner = () => {
  const { isDegraded, refreshProfile, signOut } = useAuth();
  const [retrying, setRetrying] = useState(false);

  if (!isDegraded) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await refreshProfile();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-amber-500 backdrop-blur"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-xs font-semibold">
        Session incomplete — your profile didn&apos;t load, so your name and permissions may be
        missing.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition hover:bg-amber-500/25 disabled:opacity-50"
        >
          {retrying ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
          )}
          {retrying ? 'Reconnecting' : 'Reconnect'}
        </button>
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide underline-offset-2 transition hover:underline"
        >
          <LogOut className="h-3 w-3" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  );
};
