import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  isResetEpochNeeded,
  getStoredResetEpoch,
  performAppReset,
  stampFreshInstall,
} from '../utils/resetEpoch';

interface AppResetGuardProps {
  children: React.ReactNode;
}

export const AppResetGuard: React.FC<AppResetGuardProps> = ({ children }) => {
  const [resetEpochTarget, setResetEpochTarget] = useState<number | null>(() => {
    const runningEpoch = typeof __RESET_EPOCH__ === 'number' ? __RESET_EPOCH__ : 0;
    stampFreshInstall(runningEpoch);
    const stored = getStoredResetEpoch();
    return isResetEpochNeeded(runningEpoch, stored) ? runningEpoch : null;
  });
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    const checkServerEpoch = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const serverEpoch = typeof data?.reset_epoch === 'number' ? data.reset_epoch : 0;
        const stored = getStoredResetEpoch();
        if (isResetEpochNeeded(serverEpoch, stored)) {
          setResetEpochTarget(serverEpoch);
        }
      } catch {
        // Offline or server temporarily unavailable
      }
    };

    void checkServerEpoch();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkServerEpoch();
      }
    };

    const interval = window.setInterval(checkServerEpoch, 5 * 60_000);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const handleReset = async () => {
    if (isResetting || resetEpochTarget === null) return;
    setIsResetting(true);
    try {
      await performAppReset(resetEpochTarget, { reload: true });
    } catch (e) {
      console.error('[AppResetGuard] Reset error:', e);
      setIsResetting(false);
    }
  };

  if (resetEpochTarget !== null) {
    return (
      <div className="fixed inset-0 z-[99999] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center border border-slate-100 flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mb-5 ring-8 ring-amber-50/50">
            <RefreshCw className={`w-8 h-8 ${isResetting ? 'animate-spin' : ''}`} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Update to continue</h2>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            A new update is available. PickD needs to refresh local data to continue. Your session
            will remain active.
          </p>
          <button
            type="button"
            onClick={handleReset}
            disabled={isResetting}
            className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 text-base cursor-pointer"
          >
            {isResetting ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Updating...</span>
              </>
            ) : (
              <span>Update now</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
