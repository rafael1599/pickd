// Phase 2.3 — manual Save button mutation.
//
// Calls the SECURITY INVOKER RPC `save_daily_report_manual(date, jsonb)`.
// RLS enforces admins-only and today-only at the DB level, so this hook
// does not duplicate that check. The screen hides the Save button for
// non-admins / past dates as a UX courtesy, not as the security boundary.
//
// On success, invalidates the daily-report query so the cache is refreshed
// from the server. The screen sets a local "savedManual" baseline in its
// own onSuccess callback to clear the dirty flag instantly.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import type { DailyReportManual } from './useDailyReport';

export interface SaveDailyReportManualVars {
  date: string;
  manual: DailyReportManual;
}

export function useSaveDailyReportManual() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['daily-report', 'save-manual'],
    mutationFn: async (vars: SaveDailyReportManualVars) => {
      // RPC not in generated types yet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('save_daily_report_manual', {
        p_report_date: vars.date,
        p_manual: vars.manual,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['daily-report', vars.date] });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Could not save report: ${message}`);
    },
  });
}
