import React, { useEffect, useState } from 'react';
import { useIsMutating, useIsFetching, useMutationState } from '@tanstack/react-query';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import CloudOff from 'lucide-react/dist/esm/icons/cloud-off';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import toast from 'react-hot-toast';
import { queryClient } from '../../lib/query-client';

/**
 * SyncStatusIndicator Component
 * Provides real-time visual feedback of the offline-first sync engine.
 * Hierarchy: Error (Red) > Offline/Paused (Orange) > Syncing (Blue) > Ready (Green)
 */
export const SyncStatusIndicator: React.FC = () => {
  const isMutating = useIsMutating();
  const isFetching = useIsFetching();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Monitor mutations in error state
  const errorMutations = useMutationState({
    filters: { status: 'error' },
    select: (mutation) => mutation.state.error,
  });

  // Monitor paused mutations in the cache using the official hook
  const pausedMutations = useMutationState({
    filters: { status: 'pending' },
    select: (mutation) => mutation.state.isPaused,
  });
  const hasPausedMutations = pausedMutations.some((p) => p === true);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isSyncing = isMutating > 0 || isFetching > 0;
  const hasErrors = errorMutations.length > 0;

  const handleShowErrors = () => {
    if (hasErrors) {
      const error = errorMutations[0] as { message?: string };
      const message = error?.message || 'Unknown synchronization error';
      toast.error(`Sync Error: ${message}`, {
        id: 'sync-error-toast',
        duration: 5000,
      });
      console.error('[Sync] Active mutation errors:', errorMutations);
    }
  };

  const handlePurgeErrors = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      window.confirm(
        'Do you want to clear all sync errors? This will remove failed actions from your browser queue.'
      )
    ) {
      const cache = queryClient.getMutationCache();
      const errors = cache.getAll().filter((m) => m.state.status === 'error');
      errors.forEach((m) => cache.remove(m));
      queryClient.invalidateQueries();
      toast.success('Sync queue cleared.');
    }
  };

  // 1. RED STATE: Errors (Server rejection, logic error, etc.)
  if (hasErrors) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={handleShowErrors}
          className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500/20 transition-colors"
          title="Synchronization Error - Click for details"
        >
          <AlertCircle size={16} />
          <span className="text-[10px] font-bold uppercase hidden sm:inline">Error</span>
        </button>
        <button
          onClick={handlePurgeErrors}
          className="p-1 rounded-full bg-red-500/5 hover:bg-red-500/20 text-red-400 border border-red-500/10 transition-colors"
          title="Clear Error Queue"
        >
          <Trash2 size={13} />
        </button>
      </div>
    );
  }

  // 2. AMBER STATE: Offline or Paused (Network wait — warning)
  if (!isOnline || hasPausedMutations) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 animate-pulse"
        title={!isOnline ? 'No connection' : 'Pending synchronization (Paused)'}
      >
        <CloudOff size={16} />
        <span className="text-[10px] font-bold uppercase hidden sm:inline">Paused</span>
      </div>
    );
  }

  // 3. BLUE STATE: Busy (Active transmit)
  if (isSyncing) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-500"
        title="Syncing with server..."
      >
        <RefreshCw size={16} className="animate-spin" />
        <span className="text-[10px] font-bold uppercase hidden sm:inline">Syncing</span>
      </div>
    );
  }

  // 4. GREEN STATE: Perfect (Verified)
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500"
      title="All changes saved and synchronized"
    >
      <CheckCircle2 size={16} />
      <span className="text-[10px] font-bold uppercase hidden sm:inline">Ready</span>
    </div>
  );
};
