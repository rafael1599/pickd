import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

// ─── Tasks completed on a given date ─────────────────────────────────────────

export interface ReportTask {
  task_id: string;
  title: string;
  note: string | null;
  changed_at?: string;
}

export function useTasksCompletedToday(date: string) {
  return useQuery({
    queryKey: ['tasks-completed', date],
    queryFn: async (): Promise<ReportTask[]> => {
      // date is YYYY-MM-DD — query task_state_changes for that day
      const dayStart = `${date}T00:00:00.000Z`;
      const dayEnd = `${date}T23:59:59.999Z`;

      const { data, error } = await supabase
        .from('task_state_changes')
        .select('task_id, changed_at, project_tasks(title, note)')
        .eq('to_status', 'done')
        .gte('changed_at', dayStart)
        .lte('changed_at', dayEnd)
        .order('changed_at', { ascending: true });

      if (error) throw error;

      // Deduplicate by task_id — if a task was moved to "done" multiple times
      // in the same day (e.g. moved out and back in), keep only the latest entry.
      const byTaskId = new Map<string, ReportTask>();
      for (const row of data ?? []) {
        const taskId = row.task_id as string;
        const proj = row.project_tasks as { title: string; note: string | null } | null;
        byTaskId.set(taskId, {
          task_id: taskId,
          title: proj?.title ?? 'Unknown',
          note: proj?.note ?? null,
          changed_at: row.changed_at as string,
        });
      }
      return Array.from(byTaskId.values());
    },
    enabled: !!date,
  });
}

// ─── Tasks currently in progress ─────────────────────────────────────────────
// Filtered by `created_at <= end of selected date` so tasks created after the
// reporting day don't leak into past reports.

export function useTasksInProgress(date: string) {
  return useQuery({
    queryKey: ['tasks-in-progress', date],
    queryFn: async (): Promise<ReportTask[]> => {
      const dayEnd = `${date}T23:59:59.999Z`;
      const { data, error } = await supabase
        .from('project_tasks')
        .select('id, title, note')
        .eq('status', 'in_progress')
        .lte('created_at', dayEnd)
        .order('position', { ascending: true });

      if (error) throw error;
      return (data ?? []).map((row) => ({
        task_id: row.id as string,
        title: row.title as string,
        note: (row.note as string | null) ?? null,
      }));
    },
    enabled: !!date,
  });
}

// ─── Tasks planned (future) ─────────────────────────────────────────────────

export function useTasksFuture(date: string) {
  return useQuery({
    queryKey: ['tasks-future', date],
    queryFn: async (): Promise<ReportTask[]> => {
      const dayEnd = `${date}T23:59:59.999Z`;
      const { data, error } = await supabase
        .from('project_tasks')
        .select('id, title, note')
        .eq('status', 'future')
        .lte('created_at', dayEnd)
        .order('position', { ascending: true });

      if (error) throw error;
      return (data ?? []).map((row) => ({
        task_id: row.id as string,
        title: row.title as string,
        note: (row.note as string | null) ?? null,
      }));
    },
    enabled: !!date,
  });
}
