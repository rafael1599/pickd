import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

// ─── Tasks completed on a given date ─────────────────────────────────────────

interface CompletedTask {
  title: string;
  changed_at: string;
}

export function useTasksCompletedToday(date: string) {
  return useQuery({
    queryKey: ['tasks-completed', date],
    queryFn: async (): Promise<CompletedTask[]> => {
      // date is YYYY-MM-DD — query task_state_changes for that day
      const dayStart = `${date}T00:00:00.000Z`;
      const dayEnd = `${date}T23:59:59.999Z`;

      const { data, error } = await supabase
        .from('task_state_changes')
        .select('changed_at, project_tasks(title)')
        .eq('to_status', 'done')
        .gte('changed_at', dayStart)
        .lte('changed_at', dayEnd)
        .order('changed_at', { ascending: true });

      if (error) throw error;

      return (data ?? []).map((row) => ({
        title: (row.project_tasks as { title: string } | null)?.title ?? 'Unknown',
        changed_at: row.changed_at as string,
      }));
    },
    enabled: !!date,
  });
}

// ─── Tasks currently in progress ─────────────────────────────────────────────

interface TaskTitle {
  title: string;
}

export function useTasksInProgress() {
  return useQuery({
    queryKey: ['tasks-in-progress'],
    queryFn: async (): Promise<TaskTitle[]> => {
      const { data, error } = await supabase
        .from('project_tasks')
        .select('title')
        .eq('status', 'in_progress')
        .order('position', { ascending: true });

      if (error) throw error;
      return (data ?? []).map((row) => ({ title: row.title as string }));
    },
  });
}

// ─── Tasks planned (future) ─────────────────────────────────────────────────

export function useTasksFuture() {
  return useQuery({
    queryKey: ['tasks-future'],
    queryFn: async (): Promise<TaskTitle[]> => {
      const { data, error } = await supabase
        .from('project_tasks')
        .select('title')
        .eq('status', 'future')
        .order('position', { ascending: true });

      if (error) throw error;
      return (data ?? []).map((row) => ({ title: row.title as string }));
    },
  });
}
