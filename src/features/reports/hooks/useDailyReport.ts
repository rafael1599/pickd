// Phase 2.3 — fetches the persistent activity report snapshot row.
//
// One row per NY date in public.daily_reports. Returns null when the row
// does not exist (e.g., pre-launch days, or post-launch days where the
// nightly cron has not yet run). The screen falls back to live compute
// (useActivityReport) in those cases.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import type { UserActivity, VerifiedSkusBreakdown } from './useActivityReport';

export interface DailyReportComputed {
  warehouse_totals: {
    orders_completed: number;
    total_items: number;
  };
  accuracy: {
    pct: number;
    verified_skus_2m: number;
    total_skus: number;
  };
  /**
   * Optional breakdown of `verified_skus_2m` by source category (idea-094).
   * Older snapshots written before this column was emitted will not include
   * this field; consumers must treat it as nullable.
   */
  verified_skus_breakdown?: VerifiedSkusBreakdown;
  correction_count: number;
  users: UserActivity[];
  schema_version?: number;
}

export interface DailyReportManual {
  win_of_the_day?: string;
  pickd_updates?: string[];
  routine_checklist?: string[];
  user_notes?: { id: string; full_name: string; text: string }[];
  schema_version?: number;
}

export interface DailyReportRow {
  report_date: string;
  data_computed: DailyReportComputed | Record<string, never>;
  data_manual: DailyReportManual | Record<string, never>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

/**
 * True when the row's data_computed has been populated by the cron
 * (or by an admin-triggered recovery). An empty `{}` means the row
 * exists because data_manual was saved before the cron ran for that day.
 */
export function hasComputedData(row: DailyReportRow | null | undefined): boolean {
  if (!row || !row.data_computed) return false;
  return 'warehouse_totals' in row.data_computed;
}

export function useDailyReport(date: string) {
  return useQuery({
    queryKey: ['daily-report', date],
    queryFn: async (): Promise<DailyReportRow | null> => {
      const { data, error } = await supabase
        .from('daily_reports')
        .select('*')
        .eq('report_date', date)
        .maybeSingle();

      if (error) {
        console.error('useDailyReport error:', error);
        throw error;
      }

      // The DB row's JSONB columns are typed as Json in the generated
      // types; we narrow them to the snapshot interfaces here. The fields
      // could be empty objects ({}) when only one half (cron vs manual)
      // has been written, so callers must check via hasComputedData().
      return (data as DailyReportRow | null) ?? null;
    },
    enabled: !!date,
    staleTime: 30 * 1000,
    retry: 1,
  });
}
