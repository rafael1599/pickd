/**
 * Activity report data — historical task status reconstruction.
 *
 * For a given report date D, returns the three buckets the activity report
 * needs (done today / in progress / coming up next), reconstructed to reflect
 * what was *actually* true on that day — not the current state of the board.
 *
 * The reconstruction logic lives in `../utils/historicalTaskStatus.ts` and is
 * unit-tested. The day's NY-correct UTC bounds come from Postgres via
 * `getNYDayBounds()` (see `src/lib/nyDate.ts`). This hook is a thin wrapper
 * that orchestrates the two and delegates the math.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { getNYDayBounds } from '../../../lib/nyDate';
import {
  computeTaskStatusBuckets,
  type TaskRow,
  type StateChangeRow,
  type BucketTask,
} from '../utils/historicalTaskStatus';

// Re-export for ActivityReportView consumers
export type ReportTask = BucketTask;

export interface ReportTaskBuckets {
  doneToday: ReportTask[];
  inProgress: ReportTask[];
  comingUpNext: ReportTask[];
}

const COMING_UP_LIMIT = 3;

export function useReportTasks(date: string) {
  return useQuery({
    queryKey: ['report-tasks', date],
    queryFn: async (): Promise<ReportTaskBuckets> => {
      // 1. Get the UTC bounds for this NY calendar day from Postgres.
      //    This is the only place tz logic happens — the rest of the function
      //    works in UTC ISO strings.
      const { startsAt, endsAt } = await getNYDayBounds(date);

      // 2. All tasks that existed on or before the end of the report day.
      const { data: tasksData, error: tasksErr } = await supabase
        .from('project_tasks')
        .select('id, title, note, status, created_at, position')
        .lte('created_at', endsAt)
        .order('position', { ascending: true });

      if (tasksErr) throw tasksErr;
      const tasks = (tasksData ?? []) as TaskRow[];

      if (tasks.length === 0) {
        return { doneToday: [], inProgress: [], comingUpNext: [] };
      }

      // 3. Every state change ever recorded for those tasks (no date filter —
      //    we need entries on BOTH sides of the report day to derive the
      //    initial status correctly when there are zero changes ≤ dayEnd).
      const taskIds = tasks.map((t) => t.id);
      const { data: changesData, error: changesErr } = await supabase
        .from('task_state_changes')
        .select('task_id, from_status, to_status, changed_at')
        .in('task_id', taskIds);

      if (changesErr) throw changesErr;
      const changes = (changesData ?? []) as StateChangeRow[];

      // 4. Reconstruct historical buckets in JS (pure, tested).
      const buckets = computeTaskStatusBuckets(startsAt, endsAt, tasks, changes);

      return {
        doneToday: buckets.done,
        inProgress: buckets.inProgress,
        comingUpNext: buckets.future.slice(0, COMING_UP_LIMIT),
      };
    },
    enabled: !!date,
  });
}
